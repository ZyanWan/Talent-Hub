"""项目级系统提示词 A/B 评测工具。

用法：
    python eval_prompt.py --case call-summary --version old
    python eval_prompt.py --case call-summary --version current
    python eval_prompt.py --case call-summary --version both
    python eval_prompt.py --case call-summary --save-current-system baseline_system.txt
    python eval_prompt.py --case call-summary --compare-system baseline_system.txt --a-name before --b-name after

产出：<out>_result.json（守卫后 CallSummary）、<out>_result.md（Markdown 档案）、控制台质量报告。
模型配置读取本机 SettingsStore（不打印任何密钥）。
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from app.config import SettingsStore  # noqa: E402
from app.llm import OpenAICompatibleClient  # noqa: E402
from app.models import CallSummary  # noqa: E402
from app.runtime.phone_screening import (  # noqa: E402
    CALL_FIELDS,
    apply_call_guard,
    apply_soft_skill_guard,
    render_call_summary_markdown,
    render_remark_narrative,
    summarize_system_prompt as new_system_prompt,
    summarize_user_prompt as new_user_prompt,
    validate_call_structure,
)

OUT_DIR = Path(__file__).resolve().parent


@dataclass(frozen=True)
class PromptVariant:
    name: str
    build: Callable[[str, str, bool], tuple[str, str]]


@dataclass(frozen=True)
class PromptCase:
    name: str
    default_input: Path
    default_candidate: str
    current_system: Callable[[], str]
    build_current: Callable[[str, str, bool], tuple[str, str]]
    build_system_file: Callable[[Path], Callable[[str, str, bool], tuple[str, str]]]
    run_variant: Callable[[PromptVariant, Path, str, bool, Path], int]

# ---------------------------------------------------------------- 旧版 prompt（改动前快照，完整内嵌）

OLD_BASE_SUMMARIZE_PROMPT = """你是资深招聘 HR 助理。输入是 HR 与候选人的电话沟通转写文本（可能含说话人归属错误、断句混乱、错字、同音词、数字误识）。
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

OLD_QA_RECORDS_PROMPT = """快筛详情（qa_records）：
- 把整通电话中 HR 提出的每个关键问题与候选人的回答逐条记录，作为整理记录最后的问答原文部分。
- question 保留 HR 提问的原文表达；answer 保留候选人的回答转写原文（逐字保留原话，不得改写、概括或拼接）。
- 问题即使没有有效回答也应保留，answer 留空即可。

"""


def _read_reference(name: str) -> str:
    path = PROJECT_ROOT / "app" / "resources" / "references" / name
    return path.read_text(encoding="utf-8") if path.exists() else ""


def old_system_prompt(include_qa_records: bool = True) -> str:
    framework = _read_reference("soft-skill-framework.md")
    qa_section = OLD_QA_RECORDS_PROMPT if include_qa_records else ""
    return OLD_BASE_SUMMARIZE_PROMPT.replace(
        "{qa_records_prompt}", qa_section
    ).replace("{soft_skill_framework}", framework)


def old_user_prompt(
    transcript: str, candidate_name: str = "", soft_skill_focus: str = "",
    soft_skill_dimensions: list[str] | tuple[str, ...] = (),
    include_qa_records: bool = True,
) -> str:
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
    focus = f"\n本次关注的软性素质：{soft_skill_focus}\n" if soft_skill_focus else ""
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


# ---------------------------------------------------------------- 质量指标

SPECTATOR_PATTERNS = [
    "HR 询问", "HR 问", "候选人表示", "候选人说", "双方沟通", "双方交流",
    "通话中", "对话中", "HR 问道", "在电话中", "通话过程中", "HR 提到",
]
MEETING_STYLE_KEYS = ["通话", "对话", "交流", "沟通内容", "问答记录", "访谈"]
MD_PATTERN = re.compile(r"[#*`~]|(?<![\u4e00-\u9fff])_(?![\u4e00-\u9fff])")
TS_PATTERN = re.compile(r"\d{3}\.\d{3}|\[\d|\d{2}:\d{2}")
SPEAKER_PATTERN = re.compile(r"说话人\s*[0-9０-９]")


def quality_report(summary: CallSummary, transcript: str, elapsed: float) -> dict:
    narrative = summary.narrative or ""
    spectator_hits = [p for p in SPECTATOR_PATTERNS if p in narrative]
    meeting_titles = [
        t for t in (s.title for s in summary.remark_sections)
        if any(k in t for k in MEETING_STYLE_KEYS)
    ]
    md_hits = MD_PATTERN.findall(narrative)
    ts_hits = TS_PATTERN.findall(narrative)
    speaker_hits = SPEAKER_PATTERN.findall(narrative)
    field_status: dict[str, int] = {}
    for f in summary.fields:
        field_status[f.status] = field_status.get(f.status, 0) + 1
    bullets_total = sum(len(s.bullets) for s in summary.remark_sections)
    # 守卫剔除的观察数（对比原始输出与守卫后）
    return {
        "elapsed_sec": round(elapsed, 1),
        "remark_sections": len(summary.remark_sections),
        "section_titles": [s.title for s in summary.remark_sections],
        "meeting_style_titles": meeting_titles,
        "bullets_total": bullets_total,
        "field_status": field_status,
        "facts": len(summary.facts),
        "observations_kept": len(summary.soft_skill_observations),
        "guard_warnings": summary.guard_warnings,
        "spectator_phrases": spectator_hits,
        "speaker_leak": speaker_hits,
        "timestamp_leak": len(ts_hits),
        "markdown_leak": len(md_hits),
        "narrative_len": len(narrative),
        "doubts": summary.doubts,
    }


# ---------------------------------------------------------------- 主流程

def _safe_name(name: str) -> str:
    value = re.sub(r"[^0-9A-Za-z_\-\u4e00-\u9fff]+", "_", name.strip())
    return value.strip("_") or "variant"


def _build_old_prompt(transcript: str, candidate_name: str, include_qa: bool) -> tuple[str, str]:
    return (
        old_system_prompt(include_qa_records=include_qa),
        old_user_prompt(transcript, candidate_name, include_qa_records=include_qa),
    )


def _build_current_call_summary_prompt(
    transcript: str,
    candidate_name: str,
    include_qa: bool,
) -> tuple[str, str]:
    return (
        new_system_prompt(),
        new_user_prompt(transcript, candidate_name, include_qa_records=include_qa),
    )


def _build_call_summary_system_file_prompt(
    path: Path,
) -> Callable[[str, str, bool], tuple[str, str]]:
    def build(transcript: str, candidate_name: str, include_qa: bool) -> tuple[str, str]:
        return (
            path.read_text(encoding="utf-8"),
            new_user_prompt(transcript, candidate_name, include_qa_records=include_qa),
        )
    return build


CALL_SUMMARY_CASE = PromptCase(
    name="call-summary",
    default_input=OUT_DIR / "transcript_mock.txt",
    default_candidate="王晓明",
    current_system=new_system_prompt,
    build_current=_build_current_call_summary_prompt,
    build_system_file=_build_call_summary_system_file_prompt,
    run_variant=lambda variant, input_path, candidate, include_qa, out_dir: run_call_summary_variant(
        variant,
        input_path,
        candidate,
        include_qa,
        out_dir,
    ),
)

PROMPT_CASES = {
    CALL_SUMMARY_CASE.name: CALL_SUMMARY_CASE,
}


def _variant_for_version(case: PromptCase, version: str) -> PromptVariant:
    if version == "old":
        return PromptVariant("old", _build_old_prompt)
    return PromptVariant("current", case.build_current)


def run_call_summary_variant(
    variant: PromptVariant,
    transcript_path: Path,
    candidate_name: str,
    include_qa: bool,
    out_dir: Path,
) -> int:
    settings = SettingsStore().load()
    if not settings.is_ready:
        print("模型配置不完整，无法评测。")
        return 2
    transcript = transcript_path.read_text(encoding="utf-8")
    client = OpenAICompatibleClient(settings)
    try:
        system, user = variant.build(transcript, candidate_name, include_qa)
        print(f"[{variant.name}] system={len(system)} chars, user={len(user)} chars")
        start = time.monotonic()
        raw = client.chat_json(system, user, timeout=600)
        elapsed = time.monotonic() - start
        summary = validate_call_structure(CallSummary.model_validate(raw))
        if not include_qa:
            summary.qa_records = []
        summary.transcript = transcript
        summary.candidate_name = (summary.candidate_name or "").strip() or candidate_name
        summary = apply_call_guard(summary, transcript)
        summary = apply_soft_skill_guard(summary, transcript)
        summary.narrative = render_remark_narrative(summary)
    finally:
        client.close()

    output_name = _safe_name(variant.name)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / f"{output_name}_result.json"
    out_md = out_dir / f"{output_name}_result.md"
    out_json.write_text(summary.model_dump_json(indent=2), encoding="utf-8")
    out_md.write_text(render_call_summary_markdown(summary), encoding="utf-8")

    report = quality_report(summary, transcript, elapsed)
    print(f"[{variant.name}] === 质量报告 ===")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"[{variant.name}] 结果已写入 {out_json.name} / {out_md.name}")
    return 0


def run(version: str, transcript_path: Path, candidate_name: str) -> int:
    return CALL_SUMMARY_CASE.run_variant(
        _variant_for_version(CALL_SUMMARY_CASE, version),
        transcript_path,
        candidate_name,
        False,
        OUT_DIR,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", choices=sorted(PROMPT_CASES), default="call-summary")
    parser.add_argument("--version", choices=["old", "current", "both"], default="both")
    parser.add_argument("--input")
    parser.add_argument("--transcript")
    parser.add_argument("--candidate")
    parser.add_argument("--include-qa-records", action="store_true")
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--save-current-system")
    parser.add_argument("--compare-system")
    parser.add_argument("--a-name", default="before")
    parser.add_argument("--b-name", default="after")
    args = parser.parse_args()
    prompt_case = PROMPT_CASES[args.case]
    input_path = Path(args.input or args.transcript) if (args.input or args.transcript) else prompt_case.default_input
    candidate = args.candidate or prompt_case.default_candidate
    out_dir = Path(args.out_dir)
    if args.save_current_system:
        path = Path(args.save_current_system)
        path.write_text(prompt_case.current_system(), encoding="utf-8")
        print(f"当前 system prompt 已保存到 {path}")
        return 0
    if args.compare_system:
        variants = [
            PromptVariant(args.a_name, prompt_case.build_system_file(Path(args.compare_system))),
            PromptVariant(args.b_name, prompt_case.build_current),
        ]
    elif args.version == "both":
        variants = [_variant_for_version(prompt_case, "old"), _variant_for_version(prompt_case, "current")]
    else:
        variants = [_variant_for_version(prompt_case, args.version)]
    status = 0
    for variant in variants:
        code = prompt_case.run_variant(
            variant,
            input_path,
            candidate,
            args.include_qa_records,
            out_dir,
        )
        status = status or code
    return status


if __name__ == "__main__":
    raise SystemExit(main())
