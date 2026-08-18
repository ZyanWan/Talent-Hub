"""电话确认文本的整理、校验、复核与渲染。"""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..call_repository import CallRepository
from ..config import AppSettings, SettingsStore
from ..llm import LLMError, LLMRequestError, OpenAICompatibleClient
from ..models import (
    CallSummary,
    SoftSkillObservation,
)
from . import call_state


CALL_FIELDS = [
    ("employment_status", "职业状态"),
    ("resignation_reason", "离职原因"),
    ("expected_salary", "期望薪资"),
    ("start_date", "到岗时间"),
    ("current_city", "现居城市"),
    ("work_city", "工作城市/可接受工作城市"),
    ("resume_clarification", "简历疑点澄清"),
]

# 预设软性素质维度：前端提交 key，后端映射为中文规范名注入 prompt 与观察输出。
SOFT_SKILL_DIMENSIONS = {
    "passion": "热爱",
    "self_drive": "自驱",
    "resilience": "韧性",
    "logic": "逻辑",
    "learning": "学习能力",
    "openness": "开放性",
    "pragmatism": "务实",
    "collaboration": "协作",
}

# 火山引擎「大模型录音文件识别（极速版）」正式版默认 5 并发；固定并发处理多个录音条目。
# 超过该额度会触发服务端限流（错误码 55000031 服务器繁忙）。
ITEM_CONCURRENCY = 5


def read_reference(name: str) -> str:
    """读取 app/resources/references 下的参考文件；打包运行时回退到 _MEIPASS 资源目录。"""
    root = getattr(sys, "_MEIPASS", None)
    path = Path(root) / "app" / "resources" / "references" / name if root else \
        Path(__file__).resolve().parents[2] / "app" / "resources" / "references" / name
    return path.read_text(encoding="utf-8") if path.exists() else ""


def summarize_system_prompt(include_qa_records: bool = True) -> str:
    """构建信息整理的 system prompt：基于输入转写文本整理成结构化 HR Remark。"""
    framework = read_reference("soft-skill-framework.md")
    qa_section = QA_RECORDS_PROMPT if include_qa_records else ""
    return BASE_SUMMARIZE_PROMPT.replace("{qa_records_prompt}", qa_section).replace("{soft_skill_framework}", framework)


BASE_SUMMARIZE_PROMPT = """你是资深招聘 HR 助理。输入是 HR 与候选人的电话沟通转写文本（可能含说话人归属错误、断句混乱、错字、同音词、数字误识）。
直接基于输入转写文本整理成一份站在招聘 HR 工作视角、专业、客观、可直接提供给用人部门阅读的候选人 Remark，并输出 JSON。不润色、不脱离原文创造新事实；不确定内容保留原文表达。

Remark 写作要求：
- 按主题组织，不按对话时间顺序逐句复述；语气中性、表述准确，像资深 HR 手写的内部记录；不强调"HR/我/AI"等身份。
- 业务章节（remark_sections）根据本次通话实际内容自由生成，不固定章节名称、数量或每章条数；对话没有对应内容时不得强行生成章节。
- 只写通话中实际出现或有转写原文支持的信息；含糊说法（"大概""可能"等）保留不确定性，不得擅自改成确定事实；同一信息不跨章重复。
- 不输出任何推进决策性附加项：不得出现"建议推进/补充确认/建议暂缓"、风险与待确认清单、建议下一步、推荐等级或 A/B/C 分类。
- 所有字段文本（含 title、bullets、observation、quote、soft_skill_summary、note、content 等）使用纯中文表述，严禁出现 #、*、**、_、`、~~、-（作为列表或强调标记时）等任何 Markdown 标记或强调符号；标题、章节名、观察项名称直接写文字本身，列表项由程序侧统一渲染。

软性素质两层表达（如果输出软性素质）：
- 先形成 soft_skill_observations 详细观察（每项必须有三要素：触发问题 question（HR 当时的提问原文）、
  候选人回答逐字原文 quote、观察结论 observation），再从这些有效观察中提炼 soft_skill_summary 概述；
  概述只概括详细观察中已有证据支持的结论。
- 观察结论必须客观、有限克制：基于问题与回答的具体证据，推导候选人性格特征与未来工作表现，
  既要指出积极信号也要明确指出风险信号，不得只报喜不报忧；不得使用"情商很高""人品可靠"等无行为依据的绝对人格标签。
- dimension 必须使用参考框架中的规范维度名（热爱/自驱/韧性/逻辑/学习能力/开放性/务实/协作），
  不属于任何预设维度时才使用自定义名称；signal 只取「积极信号」或「风险信号」。
- 依据必须是候选人回答的逐字原文，不得改写或拼接；HR 的提问不能单独作为软性素质证据。
- 不使用姓名、性别、年龄、民族、籍贯、婚育等受保护个人属性形成观察或结论。
- 没有充分原文证据时，不强行生成观察项，soft_skill_observations 与 soft_skill_summary 可以留空。

{qa_records_prompt}
软性素质参考框架：
{soft_skill_framework}

内部字段速览（fields/facts）用于覆盖性检查：维度未问到则 status 填"通话未提及"，问到了但含糊不清则填"含糊"。
每个内部字段和事实可附一条"依据转写原文原句"的短线索（ref）：必须逐字引用输入转写文本中的连续原句片段
（含 ASR 原文错字，不得修正、不得改写、不得概括）；程序以输入转写文本为基准核对该线索，只用于程序侧核对，不得出现在说明文字里。
不要输出思维过程，只输出符合要求的 JSON 对象。所有字段使用简体中文。"""


QA_RECORDS_PROMPT = """快筛详情（qa_records）：
- 把整通电话中 HR 提出的每个关键问题与候选人的回答逐条记录，作为整理记录最后的问答原文部分。
- question 保留 HR 提问的原文表达；answer 保留候选人的回答转写原文（逐字保留原话，不得改写、概括或拼接）。
- 问题即使没有有效回答也应保留，answer 留空即可。

"""


def _build_soft_skill_focus(dimensions: list[str], custom_focus: str) -> str:
    """把选中的预设维度与自定义关注文本合并成 focus 提示；两者皆空时返回空串。"""
    parts: list[str] = []
    selected = [SOFT_SKILL_DIMENSIONS[key] for key in dimensions if key in SOFT_SKILL_DIMENSIONS]
    if selected:
        parts.append("、".join(selected))
    if custom_focus.strip():
        parts.append(custom_focus.strip())
    return "；".join(parts)


def summarize_user_prompt(
    transcript: str, candidate_name: str = "", soft_skill_focus: str = "",
    soft_skill_dimensions: list[str] | tuple[str, ...] = (),
    include_qa_records: bool = True,
) -> str:
    """构建信息整理的 user prompt，内嵌输出 schema、可选软性关注项与转写原文。

    include_qa_records=False 时不在 schema 中要求 qa_records，减少一个全文级输出，
    显著缩短整理耗时；关闭后即使模型自行输出 qa_records，也会在 _validated_summarize 解析后强制清空。
    """
    schema: dict[str, object] = {
        "candidate_name": "候选人姓名（本次输出保持原样；留空则由 HR 或调用方填写）",
        "call_date": "通话日期，留空字符串，由 HR 或调用方填写",
        "remark_sections": [
            {
                "id": "S1、S2……",
                "title": "动态业务章节标题（按实际通话生成）",
                "bullets": ["按主题组织要点，每条完整具体（含关键事实、具体数字、候选人原话）；数量不设上限，以完整覆盖该主题为原则，宁多勿漏"],
            }
        ],
        "soft_skill_summary_title": "软性概述章节标题（可选，如「软性表现概述」；留空程序使用默认标题）",
        "soft_skill_summary": "几句话的软性表现概述，只能来自下方 soft_skill_observations 已支持的结论；无可靠观察则留空",
        "soft_skill_observations": [
            {
                "id": "O1、O2……",
                "name": "观察项名称",
                "dimension": "所属维度（规范名或自定义）",
                "signal": "积极信号 / 风险信号",
                "question": "触发该观察的 HR 提问原文",
                "observation": "客观的软性素质判断：基于问答证据推导性格特征与未来工作表现，明确指出风险信号，不只报喜不报忧",
                "quote": "候选人回答逐字原文（必须能在转写原文中找到）",
                "confidence": "高 / 中 / 低",
                "fact_id": "对应候选人事实编号，如 F1",
            }
        ],
        "fields": [
            {
                "key": key,
                "label": label,
                "value": "填写内容",
                "status": "已确认 / 含糊 / 通话未提及",
                "fact_ids": ["对应事实的编号，如 F1"],
                "note": "备注（可选）",
            }
            for key, label in CALL_FIELDS
        ],
        "facts": [
            {
                "id": "F1、F2……",
                "content": "客观事实陈述（不改写、不推断）",
                "speaker": "HR / 候选人 / 未知",
                "timestamp": "说话时间区间",
                "ref": "支持该事实的转写原文原句短线索（逐字引用输入转写文本中的连续原句，程序以输入文本核对）",
            }
        ],
        "extra_info": ["其他候选人主动透露的重要信息"],
        "doubts": ["需要进一步确认的疑点"],
    }
    if include_qa_records:
        schema["qa_records"] = [
            {
                "question": "HR 提出的问题原文（保留提问的表达）",
                "answer": "候选人的回答原文（转写原文，逐字保留原话，不得改写概括）",
            }
        ]
    schema_text = json.dumps(schema, ensure_ascii=False, indent=2)
    header = f"候选人：{candidate_name}\n\n" if candidate_name else ""
    focus_text = _build_soft_skill_focus(list(soft_skill_dimensions), soft_skill_focus)
    focus = f"\n本次关注的软性素质：{focus_text}\n" if focus_text else ""
    return (
        "请把下面的电话转写文本整理成候选人 Remark，严格按以下 JSON schema 输出"
        "（所有字段使用简体中文）：\n\n"
        f"{schema_text}\n\n"
        "转写文本如下：\n"
        f"{header}"
        f"{focus}"
        "<transcript>\n"
        f"{transcript}\n"
        "</transcript>"
    )


def _normalize_for_match(text: str) -> str:
    """去除全部空白并转小写，用于核对事实线索是否出自转写原文。"""
    return re.sub(r"\s+", "", text).casefold()


# ---- 事实回放时间戳定位 ----
# 时间戳对格式：render_transcript 输出 [sss.mmm-eee.mmm]，模型输出 ref 时可能改写为 mm:ss / hh:mm:ss。
_TS_PAIR_RE = re.compile(r"\[([0-9:.]+)\s*[-–~]\s*([0-9:.]+)\]")
_CN_DIGITS = {"零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
_FULLWIDTH_MAP = {
    ord(full): ord(half)
    for full, half in zip("，。！？；：（）“”‘’、", ",.!?;:()\"\"''、")
}


def _parse_ts_value(value: str) -> float | None:
    """把时间戳片段解析为秒，支持 000.001、00:01.234、00:00:01.234 三种形式。"""
    value = value.strip()
    if not value:
        return None
    if ":" in value:
        try:
            seconds = 0.0
            for part in value.split(":"):
                seconds = seconds * 60 + float(part)
            return seconds
        except ValueError:
            return None
    try:
        return float(value)
    except ValueError:
        return None


def _cn_num_to_arabic(text: str) -> str:
    """把文本中的中文数字序列转为阿拉伯数字：一万五→15000、二零二四→2024、三年→3年。"""
    def digit(ch: str) -> int:
        return _CN_DIGITS.get(ch, 0)

    def block(token: str) -> int:
        # 纯数码读法（无单位）：按位拼接，如 二零二四 → 2024
        if all(ch in _CN_DIGITS for ch in token):
            return int("".join(str(digit(ch)) for ch in token))
        total = 0
        current = 0
        for ch in token:
            if ch in _CN_DIGITS:
                current = digit(ch)
            elif ch in _CN_UNITS:
                total += (current or 1) * _CN_UNITS[ch]
                current = 0
        return total + current

    def convert(match: re.Match) -> str:
        token = match.group(0)
        # 口语省略：X万Y（一万五 → 15000，Y 为单数字）
        omitted = re.fullmatch(r"([零一二两三四五六七八九]+)万([零一二两三四五六七八九])?", token)
        if omitted:
            wan = block(omitted.group(1))
            tail = digit(omitted.group(2)) if omitted.group(2) else 0
            return str(wan * 10000 + tail * 1000)
        return str(block(token))

    return re.sub(r"[零一二两三四五六七八九十百千万]+", convert, text)


def _loose_normalize(text: str) -> str:
    """宽松归一：去空白 + 小写 + 全角/半角标点统一 + 中文数字→阿拉伯。

    用于时间戳兜底匹配，弥合 ASR ITN 数字归一（如一万五→15000）与转写原文的差异。
    """
    text = text.casefold()
    text = text.translate(_FULLWIDTH_MAP)
    text = _cn_num_to_arabic(text)
    return re.sub(r"\s+", "", text)


def _locate_ts_before(text: str, pos: int) -> tuple[float, float] | None:
    """在 text[:pos] 内向前扫描最近的时间戳对 [start-end]，返回（秒, 秒）。"""
    head = text[:pos]
    matches = list(_TS_PAIR_RE.finditer(head))
    if not matches:
        return None
    match = matches[-1]
    start = _parse_ts_value(match.group(1))
    end = _parse_ts_value(match.group(2))
    if start is None or end is None:
        return None
    return start, end


def _locate_ts_for_ref(text: str, ref: str) -> tuple[float, float] | None:
    """在带时间戳标记的文本中为 ref 定位时间区间。

    先逐行匹配（快速路径），再退化为整段字符定位并向前扫描最近时间戳（覆盖模型合并段落）。
    原文未命中时返回 None，由调用方继续尝试原始转写渲染文本与 utterances 兜底。
    """
    if not ref.strip():
        return None
    norm_ref = _normalize_for_match(ref)
    for line in text.splitlines():
        if norm_ref in _normalize_for_match(line):
            found = _locate_ts_before(line, len(line))
            if found:
                return found
    raw_index = text.find(ref)
    if raw_index >= 0:
        return _locate_ts_before(text, raw_index)
    # 原文未命中时不做宽松归一兜底：归一化（去空白/标点/中文数字转换）会丢失字符位置映射，
    # 强行返回全文时间戳会定位到与事实不符的位置；宽松匹配交由 utterances 层精确定位，否则降级为无定位。
    return None


def _find_ts_in_utterances(utterances: list[dict], ref: str) -> tuple[float, float] | None:
    """在原始 ASR utterances 中匹配 ref：单条匹配 + 相邻 2-3 条窗口拼接。

    时间戳缺失、结束时间非法（<=0 或早于开始）的 utterance 视为不可用；
    命中时取首条 start_time、末条 end_time（毫秒转秒）。
    """
    def ts_of(utterance: dict) -> tuple[float, float] | None:
        start = utterance.get("start_time")
        end = utterance.get("end_time")
        if start is None or end is None:
            return None
        try:
            start = float(start) / 1000
            end = float(end) / 1000
        except (TypeError, ValueError):
            return None
        if end < start or end <= 0:
            return None
        return start, end

    loose_ref = _loose_normalize(ref)
    if not loose_ref:
        return None
    normalized = [_loose_normalize(u.get("text", "")) for u in utterances]
    for size in (1, 2, 3):
        for i in range(len(utterances) - size + 1):
            chunk = utterances[i:i + size]
            if loose_ref in "".join(normalized[i:i + size]):
                first = ts_of(chunk[0])
                last = ts_of(chunk[-1])
                if first is not None and last is not None:
                    return first[0], last[1]
    return None


def attach_fact_timestamps(summary: CallSummary, utterances: list[dict], rendered_transcript: str) -> CallSummary:
    """为每个事实关联录音时间区间（秒），供前端点击回放定位。

    定位顺序：转写文本（summary.transcript）时间戳解析 → 原始转写渲染文本逐行解析
    → 原始 utterances 数组宽松匹配（支持窗口拼接）。全部失败保持 None，前端降级为不可点击。
    时间戳由程序计算，不依赖模型输出的 timestamp 字段。
    """
    for fact in summary.facts:
        if not fact.ref.strip():
            continue
        ts = _locate_ts_for_ref(summary.transcript, fact.ref)
        if ts is None:
            ts = _locate_ts_for_ref(rendered_transcript, fact.ref)
        if ts is None:
            ts = _find_ts_in_utterances(utterances, fact.ref)
        if ts is not None:
            fact.start_time, fact.end_time = ts
    return summary


def apply_call_guard(summary: CallSummary, transcript_text: str) -> CallSummary:
    """核对事实线索，并将依据不足的已确认字段降级为含糊。

    使用宽松归一（去空白/小写/全半角标点统一/中文数字转阿拉伯）核对：ref 是"转写原文原句短线索"，
    模型逐字引用输入转写文本原句，程序以同一输入文本为基准核对该线索，口径一致；
    宽松匹配容忍模型去掉口语词、统一标点等格式差异。真正编造的 ref（在输入文本中找不到原句）仍会被拦截。
    """
    normalized_transcript = _loose_normalize(transcript_text)
    doubted_fact_ids: set[str] = set()
    for fact in summary.facts:
        if fact.ref.strip() and _loose_normalize(fact.ref) not in normalized_transcript:
            doubted_fact_ids.add(fact.id)
            summary.guard_warnings.append(f"{fact.id} 的事实线索未在转写原文中核对通过")
    for field in summary.fields:
        if field.status == "已确认" and (
            not field.fact_ids or any(fid in doubted_fact_ids for fid in field.fact_ids)
        ):
            field.status = "含糊"
            summary.guard_warnings.append(
                f"{field.label}（{field.key}）缺少可核对的事实依据，已由已确认降级为含糊"
            )
    return summary


def apply_soft_skill_guard(summary: CallSummary, transcript_text: str) -> CallSummary:
    """软性观察守卫：原文逐字回查 + 指向候选人事实；失败项剔除并写告警，不影响客观 Remark。

    概述必须由通过守卫的详细观察支撑；全部观察被剔除时清空概述。
    """
    normalized_transcript = _normalize_for_match(transcript_text)
    candidate_fact_ids = {
        fact.id for fact in summary.facts if fact.speaker == "候选人" and fact.id
    }
    kept: list[SoftSkillObservation] = []
    for obs in summary.soft_skill_observations:
        problems: list[str] = []
        if not (obs.name.strip() and obs.observation.strip() and obs.quote.strip() and obs.confidence):
            problems.append("字段不完整")
        else:
            if _normalize_for_match(obs.quote) not in normalized_transcript:
                problems.append("原文未在转写中核对通过")
            if obs.fact_id not in candidate_fact_ids:
                problems.append("未指向候选人发言的事实")
        if problems:
            summary.guard_warnings.append(
                f"软性观察「{obs.name or obs.id or '未命名'}」未通过引用守卫（{'；'.join(problems)}），已剔除"
            )
        else:
            kept.append(obs)
    summary.soft_skill_observations = kept
    if summary.soft_skill_summary.strip() and not kept:
        summary.soft_skill_summary = ""
        summary.guard_warnings.append("软性概述缺少通过守卫的详细观察支撑，已清空")
    return summary


def validate_call_structure(summary: CallSummary) -> CallSummary:
    """拒绝缺少动态 Remark 章节或结构化字段的空壳结果。"""
    if not summary.remark_sections:
        raise ValueError("Remark 章节为空")
    for section in summary.remark_sections:
        if not section.title.strip():
            raise ValueError("Remark 章节标题为空")
        if not any(bullet.strip() for bullet in section.bullets):
            raise ValueError(f"章节「{section.title}」缺少要点")
    if not summary.fields:
        raise ValueError("结构化字段为空")
    return summary


def render_remark_narrative(summary: CallSummary) -> str:
    """把结构化 Remark 与软性观察渲染为纯文本 narrative。

    渲染顺序（四层，每层独立可取舍）：① 客观记录章节 → ② 软性表现概述 → ③ 软性素质观察
    （问题 → 回答 → 观察）→ ④ 快筛详情（通篇问答原文）。所有层级使用纯文本表述，
    不使用 #、*、_ 等 Markdown 标记。
    """
    lines = ["整理记录"]
    # ① 客观记录：动态业务章节
    for section in summary.remark_sections:
        if not section.title.strip():
            continue
        lines.append("")
        lines.append(section.title.strip())
        lines.extend(f"- {bullet.strip()}" for bullet in section.bullets if bullet.strip())
    # ② 软性表现概述
    if summary.soft_skill_summary.strip():
        lines.append("")
        title = summary.soft_skill_summary_title.strip() or "软性表现概述"
        lines.append(title)
        lines.append(summary.soft_skill_summary.strip())
    # ③ 软性素质观察：问题 → 回答 → 观察
    if summary.soft_skill_observations:
        lines.append("")
        lines.append("软性素质观察")
        for obs in summary.soft_skill_observations:
            lines.append("")
            lines.append(obs.name.strip())
            if obs.question.strip():
                lines.append(f"我的问题：{obs.question.strip()}")
            lines.append("")
            lines.append("候选人回答：")
            lines.append(f"“{obs.quote.strip()}”")
            lines.append("")
            lines.append(f"观察：{obs.observation.strip()}")
            if obs.dimension.strip():
                lines.append(f"维度：{obs.dimension.strip()}")
            if obs.signal:
                lines.append(f"信号：{obs.signal}")
            if obs.confidence:
                lines.append(f"置信度：{obs.confidence}")
    # ④ 快筛详情：通篇问答原文
    if summary.qa_records:
        lines.append("")
        lines.append("快筛详情")
        for index, qa in enumerate(summary.qa_records, start=1):
            lines.append("")
            lines.append(f"{index}. {qa.question.strip()}")
            if qa.answer.strip():
                lines.append(qa.answer.strip())
    return "\n".join(lines)


def validate_call_summary_complete(summary: CallSummary) -> CallSummary:
    """拒绝缺少整理正文或结构化字段的空壳结果。"""
    if not summary.narrative.strip():
        raise ValueError("整理记录为空")
    if not summary.fields:
        raise ValueError("结构化字段为空")
    return summary


def render_call_summary_markdown(summary: CallSummary, *, include_doubts: bool = False) -> str:
    """把整理结果渲染为 Markdown。"""
    lines = [
        f"# {summary.candidate_name} 电话确认记录",
        f"通话时间：{summary.call_date}",
        "",
        summary.narrative,
    ]
    if include_doubts and summary.doubts:
        lines.extend(["", "## 疑点清单"])
        lines.extend(f"- {doubt}" for doubt in summary.doubts)
    return "\n".join(lines)


def _run_cancellable(task, cancel_event: threading.Event | None) -> Any:
    """在守护线程中执行阻塞任务，主流程轮询取消事件；取消时立即中断，任务结果丢弃。"""
    box: dict[str, object] = {}

    def run() -> None:
        try:
            box["result"] = task()
        except Exception as exc:
            box["error"] = exc

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    while thread.is_alive():
        if cancel_event and cancel_event.is_set():
            raise InterruptedError("用户取消了任务。")
        thread.join(timeout=0.2)
    if "error" in box:
        raise box["error"]  # type: ignore[misc]
    return box["result"]


class CallProcessor:
    """异步调度电话确认任务。"""

    def __init__(self, repository: CallRepository, settings_store: SettingsStore) -> None:
        self.repository = repository
        self.settings_store = settings_store
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="call")
        self._futures: dict[str, Future] = {}
        self._cancel_events: dict[str, threading.Event] = {}
        self._active_clients: dict[OpenAICompatibleClient, threading.Event | None] = {}
        self._lock = threading.Lock()
        self._mark_interrupted_calls()

    def _mark_interrupted_calls(self) -> None:
        """启动时把上次运行中断的任务标为 failed，并把残留的中间态条目收敛为 queued；不动从未处理过的 draft。"""
        for record in self.repository.list_calls(archived=False):
            if record.get("status") in call_state.CALL_RUNNING_STATES:
                items = record.get("items", [])
                call_state.converge_interrupted_items(items)
                self.repository.update(
                    record["id"], status="failed", stage="上次运行被中断",
                    items=items, errors=record.get("errors", []),
                )

    def _transition_item(self, call_id: str, item_id: str, to_state: str, **fields) -> None:
        """按状态机规则转换条目状态：先校验合法性，再在仓储锁内原子写入。"""
        record = self.repository.get(call_id)
        entry = next(
            (e for e in record.get("items", []) if e.get("id") == item_id), None,
        )
        if entry is None:
            raise RuntimeError(f"条目不存在：{item_id}")
        if not call_state.item_transition_allowed(entry.get("status", ""), to_state):
            raise ValueError(
                f"非法状态转换：{entry.get('status')} → {to_state}（条目 {item_id}）"
            )
        self.repository.update_item(
            call_id, item_id, status=to_state, **fields,
        )

    def start(self, call_id: str) -> dict:
        with self._lock:
            existing = self._futures.get(call_id)
            if existing and not existing.done():
                raise RuntimeError("该任务正在处理。")
            call = self.repository.get(call_id)
            if call.get("archived_at"):
                raise RuntimeError("请先将任务恢复到最近任务，再重新开始处理。")
            changes: dict[str, object] = {}
            items = call.get("items", [])
            if call_state.reset_failed_items(items):
                # 重试语义：失败的条目重置为 queued 后重新处理；done 条目永不动
                changes["items"] = items
            if not call_state.has_queued_item(items):
                raise RuntimeError("没有待处理的录音。")
            settings = self.settings_store.load()
            if not settings.is_ready:
                raise RuntimeError("模型配置不完整，请先完成配置并测试连接。")
            if not settings.asr_api_key:
                raise RuntimeError("请先在设置中配置语音转写密钥。")
            call = self.repository.update(
                call_id, status="running", stage="准备处理", errors=[], **changes,
            )
            self._cancel_events[call_id] = threading.Event()
            self._futures[call_id] = self._executor.submit(self._run, call_id, settings)
            return call

    def _validated_summarize(
        self, client: OpenAICompatibleClient, transcript: str, candidate_name: str,
        soft_skill_focus: str, soft_skill_dimensions: list[str] | None = None,
        timeout: float | None = None, include_qa_records: bool = True,
    ) -> tuple[CallSummary, str]:
        """单次调用完成信息整理；结构校验失败时携带错误信息重试一次。

        timeout 为本次整理调用的超时预算（秒）；None 表示沿用客户端默认。
        长转写输出远超普通请求，调用方应传入更大预算以减少无谓超时。
        include_qa_records=False 时解析后强制清空 qa_records（模型即使自行输出也被丢弃），
        保证开关在程序侧强制生效，不依赖模型遵守 prompt。
        返回 (summary, transcript)：transcript 恒为输入转写原文（守卫与时间戳的核对基准）。
        """
        last_error: Exception | None = None
        dimensions = soft_skill_dimensions or []
        prompt = summarize_user_prompt(
            transcript, candidate_name, soft_skill_focus, dimensions, include_qa_records,
        )
        request_kwargs: dict[str, object] = {}
        if timeout is not None:
            request_kwargs["timeout"] = timeout
        for _attempt in range(2):
            try:
                raw = client.chat_json(
                    summarize_system_prompt(include_qa_records), prompt, **request_kwargs, # type: ignore
                )
                summary = validate_call_structure(CallSummary.model_validate(raw))
                if not include_qa_records:
                    summary.qa_records = []
                return summary, transcript
            except LLMRequestError:
                # 超时/网络类错误：chat_json 内部已按 attempts 重试，外层再试只是放大等待时间，直接上抛
                raise
            except (ValidationError, LLMError, ValueError) as exc:
                last_error = exc
                prompt = (
                    summarize_user_prompt(
                        transcript, candidate_name, soft_skill_focus, dimensions, include_qa_records,
                    )
                    + f"\n\n上一次输出未通过结构校验：{str(exc)[:600]}。请修正并重新返回完整 JSON。"
                )
        raise RuntimeError(f"AI 整理结果结构校验失败：{last_error}")

    def _process_item(
        self, call_id: str, item_id: str, settings: AppSettings,
        cancel_event: threading.Event | None,
    ) -> None:
        """串行处理单个录音条目：转写 → 信息整理 → 复核 → 落盘。"""
        call = self.repository.get(call_id)
        item = next((entry for entry in call.get("items", []) if entry.get("id") == item_id), None)
        if item is None:
            raise RuntimeError(f"条目不存在：{item_id}")
        if cancel_event and cancel_event.is_set():
            raise InterruptedError("用户取消了任务。")
        audio_path = self.repository.call_dir(call_id) / "audio" / item["audio_file"]
        if not audio_path.is_file():
            raise FileNotFoundError(f"音频文件不存在：{item['audio_file']}")

        self._transition_item(
            call_id, item_id, call_state.ITEM_TRANSCRIBING, stage="语音转写", progress=20,
        )
        transcript_dir = self.repository.call_dir(call_id) / "transcripts"
        transcript_dir.mkdir(parents=True, exist_ok=True)
        transcript_name = f"{item_id}.txt"
        transcript_file = transcript_dir / transcript_name
        utterance_file = transcript_dir / f"{item_id}.json"
        text = ""
        if transcript_file.is_file() and transcript_file.stat().st_size > 0:
            try:
                text = transcript_file.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                # 半写/损坏的缓存转写：删除后重新转写，避免复用坏文件导致重试必败
                try:
                    transcript_file.unlink()
                    utterance_file.unlink(missing_ok=True)
                except OSError:
                    pass
        if text:
            # 复用已有转写（中断重试 / 追加后重跑）：跳过 ASR 调用，避免重复计费
            result: dict[str, Any] = {"utterances": []}
            try:
                parsed = json.loads(utterance_file.read_text(encoding="utf-8"))
                if isinstance(parsed, dict) and isinstance(parsed.get("utterances"), list):
                    result = parsed
            except (OSError, ValueError):
                pass  # 无 utterances 缓存时时间戳定位退化为文本级
        else:
            from .speech_to_text import render_transcript, transcribe_audio

            result = _run_cancellable(
                lambda: transcribe_audio(audio_path, settings.asr_api_key),
                cancel_event,
            )
            text = render_transcript(result["utterances"])
            if not text.strip():
                raise RuntimeError("语音转写结果为空，请检查音频内容。")
            transcript_file.write_text(text, encoding="utf-8")
            try:
                utterance_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
            except OSError:
                pass  # utterances 缓存非必需：写失败仅时间戳定位退化，不阻塞主流程
        self._transition_item(
            call_id, item_id, call_state.ITEM_SUMMARIZING,
            transcript_file=transcript_name, stage="AI 整理", progress=60,
        )

        candidate_name = item.get("candidate_name") or ""
        soft_skill_focus = call.get("soft_skill_focus") or ""
        soft_skill_dimensions = call.get("soft_skill_dimensions") or []
        if cancel_event and cancel_event.is_set():
            raise InterruptedError("用户取消了任务。")
        client = OpenAICompatibleClient(settings, cancel_event=cancel_event)
        with self._lock:
            self._active_clients[client] = cancel_event
        try:
            # 单次调用完成信息整理（结构化 Remark + 软性观察 + 内部事实）；
            # 长转写输出大，单次调用给足时间预算（至少 300s），减少超时重试
            summary, _ = self._validated_summarize(
                client, text, candidate_name, soft_skill_focus, soft_skill_dimensions,
                timeout=max(settings.request_timeout, 300),
                include_qa_records=settings.call_qa_records,
            )
            summary.transcript = text
            summary.candidate_name = (summary.candidate_name or "").strip() or candidate_name
            # 事实 ref 与软性 quote 均须逐字引用输入转写原文，统一以 ASR 原文核对（口径一致，避免误杀）
            summary = apply_call_guard(summary, text)
            summary = apply_soft_skill_guard(summary, text)
            summary.narrative = render_remark_narrative(summary)
        finally:
            with self._lock:
                self._active_clients.pop(client, None)
            client.close()

        summary_dir = self.repository.call_dir(call_id) / "summaries"
        summary_dir.mkdir(parents=True, exist_ok=True)
        summary = attach_fact_timestamps(summary, result.get("utterances") or [], text)
        (summary_dir / f"{item_id}.json").write_text(
            summary.model_dump_json(indent=2), encoding="utf-8"
        )
        (summary_dir / f"{item_id}.md").write_text(
            render_call_summary_markdown(summary), encoding="utf-8"
        )
        self._transition_item(
            call_id, item_id, call_state.ITEM_DONE,
            stage="已完成", progress=100,
            summary=summary.model_dump(mode="json"),
        )

    def _run(self, call_id: str, settings: AppSettings) -> None:
        cancel_event = self._cancel_events.get(call_id)
        try:
            call = self.repository.get(call_id)
            pending = call_state.pending_item_ids(call.get("items", []))
            if not pending:
                raise RuntimeError("没有待处理的录音。")
            total = len(call.get("items", []))
            errors: list[str] = []
            workers = min(ITEM_CONCURRENCY, len(pending))
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="call-item") as pool:
                futures = {
                    pool.submit(self._process_item, call_id, item_id, settings, cancel_event): item_id
                    for item_id in pending
                }
                for future in as_completed(futures):
                    if cancel_event and cancel_event.is_set():
                        for pending_future in futures:
                            pending_future.cancel()
                        raise InterruptedError("用户取消了任务。")
                    item_id = futures[future]
                    try:
                        future.result()
                    except InterruptedError:
                        raise
                    except Exception as exc:
                        message = f"{type(exc).__name__}: {exc}"
                        errors.append(f"{item_id}：{message}")
                        self._transition_item(
                            call_id, item_id, call_state.ITEM_FAILED,
                            stage="处理失败", error=message,
                        )
                    finally:
                        futures.pop(future, None)
                    call = self.repository.get(call_id)
                    done = call_state.terminal_item_count(call.get("items", []))
                    self.repository.update(
                        call_id, completed=done, total=total,
                        progress=int(100 * done / max(total, 1)),
                        errors=errors, stage=f"处理中 {done}/{total}",
                    )
            final = self.repository.get(call_id)
            if call_state.any_item_failed(final.get("items", [])):
                self.repository.update(call_id, status="failed", stage="任务失败", errors=errors)
            else:
                self.repository.update(
                    call_id, status="done", stage="处理完成", progress=100,
                    completed=total, errors=[],
                )
        except InterruptedError:
            call = self.repository.get(call_id)
            # 收敛未完成的条目为 queued，保证取消后可通过重新整理继续处理
            call_state.converge_interrupted_items(call["items"])
            self.repository.update(
                call_id, status="cancelled", stage="已取消",
                items=call["items"], errors=call.get("errors", []),
            )
        except Exception as exc:
            try:
                call = self.repository.get(call_id)
                errors = list(call.get("errors", []))
                errors.append(f"{type(exc).__name__}: {exc}")
                self.repository.update(call_id, status="failed", stage="任务失败", errors=errors)
            except Exception:
                logging.getLogger(__name__).exception("Failed to persist call failure state")
        finally:
            with self._lock:
                self._cancel_events.pop(call_id, None)
                self._futures.pop(call_id, None)

    def cancel(self, call_id: str) -> dict:
        with self._lock:
            future = self._futures.get(call_id)
            cancel_event = self._cancel_events.get(call_id)
            if not future or future.done() or not cancel_event:
                raise RuntimeError("该任务当前不在处理。")
            cancel_event.set()
            for client, event in list(self._active_clients.items()):
                if event is cancel_event:
                    client.abort()
            return self.repository.update(call_id, stage="正在停止任务")

    def delete(self, call_id: str) -> None:
        with self._lock:
            future = self._futures.get(call_id)
            if future and not future.done():
                raise RuntimeError("任务运行中，不能删除。")
            self.repository.delete(call_id)
            self._futures.pop(call_id, None)
            self._cancel_events.pop(call_id, None)
