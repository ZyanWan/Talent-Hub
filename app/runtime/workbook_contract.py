#!/usr/bin/env python3
"""Shared workbook contract for talent hub outputs."""

from __future__ import annotations


SUMMARY_SHEET = "候选人总表"
EVIDENCE_SHEET = "证据匹配表"
PHONE_SHEET = "电话确认问题"
STANDARD_SHEET = "筛选标准"
RECOMMEND_SHEET = "推荐名单（仅A类）"

REQUIRED_SHEET_NAMES = (
    SUMMARY_SHEET,
    EVIDENCE_SHEET,
    PHONE_SHEET,
    STANDARD_SHEET,
    RECOMMEND_SHEET,
)

DEFAULT_HEADERS_PER_SHEET = {
    SUMMARY_SHEET: [
        "推荐顺序",
        "候选人",
        "结论",
        "一句话判定",
        "当前/最近公司",
        "当前/最近岗位",
        "核心优势摘要",
        "关键风险/Blocker",
        "下一步动作",
        "硬性门槛判定",
        "备注",
    ],
    EVIDENCE_SHEET: [
        "候选人",
        "对象证据",
        "场景垂直性",
        "核心动作证据",
        "负责深度",
        "闭环证据",
        "工具/系统/证书",
        "规模/结果",
        "稳定性",
        "证据充分度",
    ],
    PHONE_SHEET: [
        "候选人",
        "优先级",
        "确认焦点",
        "问题",
        "当前证据",
        "确认后影响",
    ],
    STANDARD_SHEET: ["模块", "内容", "备注"],
    RECOMMEND_SHEET: [
        "推荐顺序",
        "候选人",
        "结论",
        "一句话判定",
        "联系电话",
        "邮箱",
    ],
}

CORE_FIELDS_PER_SHEET = {
    SUMMARY_SHEET: [
        "推荐顺序",
        "候选人",
        "结论",
        "一句话判定",
        "关键风险/Blocker",
        "下一步动作",
    ],
    EVIDENCE_SHEET: [
        "候选人",
        "对象证据",
        "场景垂直性",
        "核心动作证据",
        "负责深度",
        "闭环证据",
        "证据充分度",
    ],
    PHONE_SHEET: [
        "候选人",
        "优先级",
        "确认焦点",
        "问题",
        "当前证据",
        "确认后影响",
    ],
    STANDARD_SHEET: ["模块", "内容"],
    RECOMMEND_SHEET: ["推荐顺序", "候选人", "结论", "一句话判定"],
}

MIN_DATA_ROWS_PER_SHEET = {
    SUMMARY_SHEET: 1,
    EVIDENCE_SHEET: 1,
    PHONE_SHEET: 0,
    STANDARD_SHEET: 1,
    RECOMMEND_SHEET: 0,
}

ROW_KEY_FIELD_PER_SHEET = {
    SUMMARY_SHEET: "候选人",
    EVIDENCE_SHEET: "候选人",
    PHONE_SHEET: "候选人",
    STANDARD_SHEET: "模块",
    RECOMMEND_SHEET: "候选人",
}

CONCLUSION_VALUES = (
    "A优先约面",
    "B电话确认",
    "C不推进",
)

CONCLUSION_FILL_COLORS = {
    "A优先约面": "D9EAD3",
    "B电话确认": "FFF2CC",
    "C不推进": "F4CCCC",
}

HEADER_FILL_COLOR = "D9EAF7"
FREEZE_PANES = "A2"

STANDARD_MODULES = (
    "岗位本质",
    "硬性门槛",
    "A类规则",
    "B类规则",
    "C类规则",
    "否决信号",
    "相似错误类型",
)

VALID_PHONE_PRIORITIES = {"高", "中", "低"}
VALID_EVIDENCE_LEVELS = {"高", "中", "低"}
OPTIONAL_STATUS_HEADERS = {
    "对象状态",
    "场景状态",
    "动作状态",
    "深度状态",
    "闭环状态",
}
VALID_STATUS_VALUES = {"✓", "！", "✗"}
