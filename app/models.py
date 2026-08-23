from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


Conclusion = Literal["A优先约面", "B电话确认", "C不推进"]
EvidenceStatus = Literal["匹配", "待确认", "不匹配", "未体现"]


class RuleItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    rule: str
    verification: str = ""


class ScreeningCriteria(BaseModel):
    model_config = ConfigDict(extra="ignore")

    job_title: str = "未命名岗位"
    essence: str
    core_outputs: list[str] = Field(default_factory=list)
    target_objects: list[str] = Field(default_factory=list)
    required_scenarios: list[str] = Field(default_factory=list)
    allowed_adjacent: list[str] = Field(default_factory=list)
    rejected_adjacent: list[str] = Field(default_factory=list)
    hard_requirements: list[RuleItem] = Field(default_factory=list)
    a_conditions: list[RuleItem] = Field(default_factory=list)
    b_conditions: list[RuleItem] = Field(default_factory=list)
    c_conditions: list[RuleItem] = Field(default_factory=list)
    negative_signals: list[RuleItem] = Field(default_factory=list)
    similar_wrong_profiles: list[str] = Field(default_factory=list)
    evaluation_notes: list[str] = Field(default_factory=list)
    bonus_signals: list[str] = Field(default_factory=list)

    @field_validator(
        "core_outputs", "target_objects", "required_scenarios", "allowed_adjacent",
        "rejected_adjacent", "similar_wrong_profiles", "evaluation_notes", "bonus_signals",
        mode="before"
    )
    @classmethod
    def coerce_string_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [value]
        return value


class EvidenceDimension(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: EvidenceStatus = "未体现"
    summary: str = "未体现"
    quote: str = ""
    location: str = ""


class CandidateEvidence(BaseModel):
    model_config = ConfigDict(extra="ignore")

    object_match: EvidenceDimension = Field(default_factory=EvidenceDimension)
    scenario_match: EvidenceDimension = Field(default_factory=EvidenceDimension)
    core_actions: EvidenceDimension = Field(default_factory=EvidenceDimension)
    ownership_depth: EvidenceDimension = Field(default_factory=EvidenceDimension)
    closed_loop: EvidenceDimension = Field(default_factory=EvidenceDimension)
    tools_certificates: EvidenceDimension = Field(default_factory=EvidenceDimension)
    scale_results: EvidenceDimension = Field(default_factory=EvidenceDimension)
    stability: EvidenceDimension = Field(default_factory=EvidenceDimension)


class PhoneQuestion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    priority: Literal["高", "中", "低"] = "高"
    focus: str
    question: str
    current_evidence: str = "未体现"
    impact: str = "B→A或B→C"


class HardGateVerdict(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    rule: str = ""
    status: Literal["met", "unmet", "unknown"] = "unknown"
    quote: str = ""
    note: str = ""


class CandidateEvaluation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    candidate_name: str = ""
    current_company: str = "未体现"
    current_role: str = "未体现"
    contact_phone: str = ""
    contact_email: str = ""
    conclusion: Conclusion
    one_line: str
    strengths: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    next_action: str
    evidence_level: Literal["高", "中", "低"] = "低"
    evidence: CandidateEvidence = Field(default_factory=CandidateEvidence)
    hard_gate: list[HardGateVerdict] = Field(default_factory=list)
    phone_questions: list[PhoneQuestion] = Field(default_factory=list)
    source_file: str = ""
    guard_warnings: list[str] = Field(default_factory=list)

    @field_validator("strengths", "blockers", mode="before")
    @classmethod
    def coerce_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [value]
        return value


class CallFact(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    content: str = ""
    speaker: Literal["HR", "候选人", "未知"] = "未知"
    timestamp: str = ""
    ref: str = ""
    start_time: float | None = None  # 秒；程序回放定位用，模型不输出
    end_time: float | None = None    # 秒；程序回放定位用，模型不输出


class CallField(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str = ""
    label: str = ""
    value: str = "通话未提及"
    status: Literal["已确认", "含糊", "通话未提及"] = "通话未提及"
    fact_ids: list[str] = Field(default_factory=list)
    note: str = ""


class CallRemarkSection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    title: str = ""
    bullets: list[str] = Field(default_factory=list)


class CallQA(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str = ""
    answer: str = ""


class CallSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    candidate_name: str = ""
    call_date: str = ""
    remark_sections: list[CallRemarkSection] = Field(default_factory=list)
    soft_skill_summary: list[str] = Field(default_factory=list)
    soft_skill_summary_title: str = ""
    narrative: str = ""
    fields: list[CallField] = Field(default_factory=list)
    facts: list[CallFact] = Field(default_factory=list)
    qa_records: list[CallQA] = Field(default_factory=list)
    extra_info: list[str] = Field(default_factory=list)
    doubts: list[str] = Field(default_factory=list)
    guard_warnings: list[str] = Field(default_factory=list)
    transcript: str = ""

    @field_validator("soft_skill_summary", mode="before")
    @classmethod
    def coerce_soft_skill_summary(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        return value
