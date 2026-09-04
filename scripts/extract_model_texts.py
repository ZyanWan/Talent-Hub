"""Generate a complete inventory of text sent to model endpoints."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import compare_system_prompt, compare_user_prompt  # noqa: E402
from app.models import RuleItem, ScreeningCriteria  # noqa: E402
from app.pipeline import (  # noqa: E402
    criteria_system_prompt,
    criteria_user_prompt,
    evaluation_system_prompt,
    evaluation_user_prompt,
)
from app.runtime.phone_screening import (  # noqa: E402
    summarize_system_prompt,
    summarize_user_prompt,
)
from debug.prompt_ab.eval_prompt import (  # noqa: E402
    baseline_system_prompt,
    baseline_user_prompt,
)


def block(title: str, role: str, content: str) -> str:
    fence = "````text" if "```" in content else "```text"
    closing = "````" if fence.startswith("````") else "```"
    return f"### {title}\n\nRole: `{role}`\n\n{fence}\n{content}\n{closing}\n"


def placeholder_criteria() -> ScreeningCriteria:
    return ScreeningCriteria(
        job_title="{{JOB_TITLE}}",
        essence="{{JOB_ESSENCE}}",
        core_outputs=["{{CORE_OUTPUT}}"],
        target_objects=["{{TARGET_OBJECT}}"],
        required_scenarios=["{{REQUIRED_SCENARIO}}"],
        allowed_adjacent=["{{ALLOWED_ADJACENT}}"],
        rejected_adjacent=["{{REJECTED_ADJACENT}}"],
        hard_requirements=[RuleItem(id="H1", rule="{{HARD_REQUIREMENT}}", verification="{{VERIFICATION}}")],
        a_conditions=[RuleItem(id="A1", rule="{{A_CONDITION}}", verification="{{VERIFICATION}}")],
        b_conditions=[RuleItem(id="B1", rule="{{B_CONDITION}}", verification="{{VERIFICATION}}")],
        c_conditions=[RuleItem(id="C1", rule="{{C_CONDITION}}", verification="{{VERIFICATION}}")],
        negative_signals=[RuleItem(id="N1", rule="{{NEGATIVE_SIGNAL}}", verification="{{VERIFICATION}}")],
        similar_wrong_profiles=["{{SIMILAR_WRONG_PROFILE}}"],
        evaluation_notes=["{{EVALUATION_NOTE}}"],
        bonus_signals=["{{BONUS_SIGNAL}}"],
    )


def main() -> None:
    criteria = placeholder_criteria()
    compare_candidates = [{
        "candidate_name": "{{CANDIDATE_NAME}}",
        "source_file": "{{SOURCE_FILE}}",
        "conclusion": "A优先约面",
        "one_line": "{{ONE_LINE}}",
        "evidence_level": "{{EVIDENCE_LEVEL}}",
        "evidence": {
            key: {"status": "{{STATUS}}", "summary": "{{SUMMARY}}", "quote": "{{QUOTE}}"}
            for key in (
                "object_match", "scenario_match", "core_actions", "ownership_depth",
                "closed_loop", "tools_certificates", "scale_results", "stability",
            )
        },
        "hard_gate": [{"id": "H1", "status": "met", "quote": "{{QUOTE}}"}],
        "bonus_signal_hits": [{"signal": "{{BONUS_SIGNAL}}", "evidence": "{{BONUS_EVIDENCE}}"}],
        "strengths": ["{{STRENGTH}}"],
        "blockers": ["{{BLOCKER}}"],
    }]

    sections = [
        "# Talent Hub 模型传输文本清单\n",
        "本文件由 `scripts/extract_model_texts.py` 从当前运行时代码生成。固定文本保持原样；"
        "`{{...}}` 表示请求时替换的业务数据。前端不直接调用模型，火山 ASR 参数不属于自然语言 messages。\n",
        "## 请求封装\n\n所有生产和评测调用都通过 `OpenAICompatibleClient.chat_json()` 发送：\n\n"
        "```json\n{\n  \"model\": \"{{MODEL}}\",\n  \"temperature\": 0,\n"
        "  \"response_format\": {\"type\": \"json_object\"},\n  \"messages\": [\n"
        "    {\"role\": \"system\", \"content\": \"{{SYSTEM_TEXT}}\"},\n"
        "    {\"role\": \"user\", \"content\": \"{{USER_TEXT}}\"}\n  ]\n}\n```\n\n"
        "不支持 `response_format` 的兼容服务会移除该参数重发，messages 不变。\n",
        "## 生产调用\n",
        block("SP-01 模型连接测试", "system", "你是连接测试程序。只返回 JSON。"),
        block("SP-01 模型连接测试", "user", '返回 {"ok": true, "message": "连接成功"}，不要添加其他字段。'),
        block("SP-02 JD 转筛选标准", "system", criteria_system_prompt()),
        block("SP-02 JD 转筛选标准", "user", criteria_user_prompt("{{JD_TEXT}}")),
        block("SP-03 单份简历评估", "system", evaluation_system_prompt()),
        block("SP-03 单份简历评估", "user", evaluation_user_prompt(criteria, "{{RESUME_TEXT}}", "{{SOURCE_FILE}}")),
        block("SP-04 候选人横向对比", "system", compare_system_prompt()),
        block("SP-04 候选人横向对比", "user", compare_user_prompt(criteria.model_dump(mode="json"), compare_candidates)),
        block("SP-05 电话初筛整理", "system", summarize_system_prompt()),
        block(
            "SP-05 电话初筛整理（生成快筛问答）",
            "user",
            summarize_user_prompt(
                "{{TRANSCRIPT}}", "{{CANDIDATE_NAME}}", "{{CUSTOM_FOCUS}}",
                ["logic", "collaboration"], True,
            ),
        ),
        block(
            "SP-05 电话初筛整理（不生成快筛问答）",
            "user",
            summarize_user_prompt(
                "{{TRANSCRIPT}}", "{{CANDIDATE_NAME}}", "{{CUSTOM_FOCUS}}",
                ["logic", "collaboration"], False,
            ),
        ),
        "## 结构纠正追加文本\n",
        block("筛选标准与简历评估", "user suffix", "上一次输出未通过结构校验。请按既定 schema 重新返回完整 JSON。"),
        block("候选人横向对比", "user suffix", "上一次输出未通过结构或业务校验。请覆盖全部候选人并重新返回完整 JSON。"),
        block("电话初筛整理", "user suffix", "上一次输出未通过结构或事实引用校验。请按既定 schema 重新返回完整 JSON。"),
        "## 开发评测调用\n\n`debug/prompt_ab/eval_prompt.py` 的 `current` 变体复用 SP-05。"
        "`baseline` 变体使用下面的 system message，并复用 SP-05 的 user message 与结构契约。\n",
        block("电话提示 A/B 评测 baseline", "system", baseline_system_prompt(True)),
        block(
            "电话提示 A/B 评测 baseline",
            "user",
            baseline_user_prompt("{{TRANSCRIPT}}", "{{CANDIDATE_NAME}}", include_qa_records=True),
        ),
        "### 用户指定 system 文件变体\n\n使用 `--compare-system <path>` 时，文件的 UTF-8 全文原样成为"
        " A 变体的 system message；其内容由运行命令决定，仓库无法静态展开。user message 仍为 SP-05。\n",
        "## 动态数据与长度分支\n\n"
        "- JD 不超过 60,000 字符时全文传输；超限时保留前 45,000 和后 15,000 字符，并插入"
        " `[中间内容因超长省略]`。\n"
        "- 简历不超过 120,000 字符时全文传输；超限时保留前 80,000 和后 40,000 字符，并插入"
        " `[中间内容因超长省略]`。\n"
        "- 电话转写不超过 160,000 字符时全文传输；超限时保留前 120,000 和后 40,000 字符，并插入"
        " `[中间转写因超长省略]`。\n"
        "- 横向比较最多接收 20 位候选人；每位候选人按 SP-04 JSON 数组元素重复。\n"
        "- 候选人名、文件名、筛选标准、评估摘要、关注项和原始文档均是动态不可信数据。\n",
        "## 完整性边界\n\n"
        "生产代码中的自然语言 messages 只有以上五类。`docs/MODEL_INPUT_TEXTS.md`、README、源码地图、"
        "前端文案、日志和普通异常文本不会发送给模型；只有本文件列出的三条结构纠正后缀会在对应失败重试时追加。\n",
    ]
    (ROOT / "docs" / "MODEL_INPUT_TEXTS.md").write_text("\n".join(sections), encoding="utf-8")


if __name__ == "__main__":
    main()
