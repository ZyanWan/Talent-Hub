from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator, model_validator


Conclusion = Literal["A优先约面", "B电话确认", "C不推进"]
EvidenceStatus = Literal["匹配", "待确认", "不匹配", "未体现"]

PROTECTED_CANDIDATE_ATTRIBUTE_RE = re.compile(
    r"年龄|性别|民族|籍贯|婚育|婚姻|已婚|未婚|生育|已育"
)


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

    @model_validator(mode="after")
    def normalize_decision_rules(self):
        """删除受保护属性规则，并为全部规则生成稳定且唯一的 ID。"""
        fields = (
            ("hard_requirements", "H"),
            ("a_conditions", "A"),
            ("b_conditions", "B"),
            ("c_conditions", "C"),
            ("negative_signals", "N"),
        )
        used: set[str] = set()
        for field_name, prefix in fields:
            items: list[RuleItem] = []
            next_index = 1
            for item in getattr(self, field_name):
                item.rule = item.rule.strip()
                item.verification = item.verification.strip()
                if not item.rule or PROTECTED_CANDIDATE_ATTRIBUTE_RE.search(
                    f"{item.rule} {item.verification}"
                ):
                    continue
                candidate_id = item.id.strip()
                if not candidate_id or candidate_id in used:
                    while f"{prefix}{next_index}" in used:
                        next_index += 1
                    candidate_id = f"{prefix}{next_index}"
                used.add(candidate_id)
                item.id = candidate_id
                items.append(item)
                next_index += 1
            setattr(self, field_name, items)
        return self


class EvidenceDimension(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status: EvidenceStatus = "未体现"
    summary: str = "未体现"
    quote: str = ""
    location: str = ""

    @field_validator("status", "summary", "quote", "location", mode="before")
    @classmethod
    def coerce_null_dimension(cls, value, info: ValidationInfo):
        if value is not None:
            return value
        return {"status": "未体现", "summary": "未体现", "quote": "", "location": ""}[info.field_name]


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

    @field_validator("id", "rule", "status", "quote", "note", mode="before")
    @classmethod
    def coerce_null_gate(cls, value, info: ValidationInfo):
        if value is not None:
            return value
        return {"id": "", "rule": "", "status": "unknown", "quote": "", "note": ""}[info.field_name]


class BonusSignalHit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    signal: str = ""
    evidence: str = ""


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
    bonus_signal_hits: list[BonusSignalHit] = Field(default_factory=list)
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

    @field_validator("conclusion", mode="before")
    @classmethod
    def expand_short_conclusion(cls, value):
        mapping = {"A": "A优先约面", "B": "B电话确认", "C": "C不推进"}
        return mapping.get(value, value)

    @field_validator("candidate_name", "current_company", "current_role",
                     "contact_phone", "contact_email", "source_file",
                     "evidence_level", mode="before")
    @classmethod
    def coerce_null_meta(cls, value, info: ValidationInfo):
        if value is not None:
            return value
        defaults = {"current_company": "未体现", "current_role": "未体现", "evidence_level": "低"}
        return defaults.get(info.field_name, "")


class CallFact(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str = ""
    speaker: Literal["HR", "候选人", "未知"] = "未知"
    ref: str = ""
    start_time: float | None = None  # 秒；程序回放定位用，模型不输出
    end_time: float | None = None    # 秒；程序回放定位用，模型不输出


class CallField(BaseModel):
    model_config = ConfigDict(extra="ignore")

    key: str = ""
    label: str = ""
    value: str = "通话未提及"
    status: Literal["已确认", "含糊", "通话未提及"] = "通话未提及"
    note: str = ""


class CallRemarkSection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = ""
    bullets: list[str] = Field(default_factory=list)

    @field_validator("bullets", mode="before")
    @classmethod
    def coerce_bullets(cls, value):
        if not isinstance(value, list):
            return value
        return [item.get("text", "") if isinstance(item, dict) else item for item in value]


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
    doubts: list[str] = Field(default_factory=list)
    transcript: str = ""

    @field_validator("soft_skill_summary", mode="before")
    @classmethod
    def coerce_soft_skill_summary(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            return [value] if value.strip() else []
        if isinstance(value, list):
            result = []
            for item in value:
                if isinstance(item, str):
                    result.append(item)
                    continue
                if isinstance(item, dict):
                    judgment = str(item.get("judgment") or item.get("text") or "").strip()
                    basis = str(item.get("basis") or "").strip()
                    if judgment:
                        result.append(f"{judgment}；{basis}" if basis else judgment)
            return result
        return value
