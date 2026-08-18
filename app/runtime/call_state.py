"""电话确认任务与条目的状态机：集中定义合法转换、收敛与重试规则。

条目状态：queued → transcribing → summarizing → done
         任意处理中状态 → failed；failed 可重试回 queued
取消/中断时 transcribing/summarizing 收敛回 queued
任务级状态：draft → running → done / failed / cancelled；failed / cancelled 可重跑
"""

from __future__ import annotations

# 条目状态
ITEM_QUEUED = "queued"
ITEM_TRANSCRIBING = "transcribing"
ITEM_SUMMARIZING = "summarizing"
ITEM_DONE = "done"
ITEM_FAILED = "failed"
ITEM_CANCELLED = "cancelled"

# 条目中间态：处理中、未产生终态结果
ITEM_INTERMEDIATE = frozenset({ITEM_TRANSCRIBING, ITEM_SUMMARIZING})
# 条目终态：不再参与后台处理
ITEM_TERMINAL = frozenset({ITEM_DONE, ITEM_FAILED, ITEM_CANCELLED})

# 任务级状态
CALL_DRAFT = "draft"
CALL_QUEUED = "queued"
CALL_RUNNING = "running"
CALL_DONE = "done"
CALL_FAILED = "failed"
CALL_CANCELLED = "cancelled"
CALL_RUNNING_STATES = frozenset({CALL_QUEUED, CALL_RUNNING})

# 合法条目转换表
_ITEM_TRANSITIONS: dict[str, frozenset[str]] = {
    ITEM_QUEUED: frozenset({ITEM_TRANSCRIBING, ITEM_FAILED}),
    ITEM_TRANSCRIBING: frozenset({ITEM_SUMMARIZING, ITEM_FAILED, ITEM_QUEUED}),
    ITEM_SUMMARIZING: frozenset({ITEM_DONE, ITEM_FAILED, ITEM_QUEUED}),
    ITEM_DONE: frozenset(),
    ITEM_FAILED: frozenset({ITEM_QUEUED}),
    ITEM_CANCELLED: frozenset(),
}


def item_transition_allowed(from_state: str, to_state: str) -> bool:
    """判断条目状态转换是否合法。"""
    return to_state in _ITEM_TRANSITIONS.get(from_state, frozenset())


def pending_item_ids(items: list[dict]) -> list[str]:
    """返回等待处理的条目 ID（queued）。"""
    return [entry["id"] for entry in items if entry.get("status") == ITEM_QUEUED]


def has_queued_item(items: list[dict]) -> bool:
    """是否存在等待处理的条目。"""
    return any(entry.get("status") == ITEM_QUEUED for entry in items)


def terminal_item_count(items: list[dict]) -> int:
    """返回已结束的条目数（done/failed/cancelled）。"""
    return sum(1 for entry in items if entry.get("status") in ITEM_TERMINAL)


def any_item_failed(items: list[dict]) -> bool:
    """是否存在失败条目。"""
    return any(entry.get("status") == ITEM_FAILED for entry in items)


def reset_failed_items(items: list[dict]) -> bool:
    """把失败条目重置为 queued（重试语义）；done 条目永不动。返回是否有重置。

    重置同时清除旧 summary/reviewed：重试即重新生成，避免失败重跑后
    残留与 failed 状态矛盾的旧整理结果。
    """
    reset = False
    for entry in items:
        if entry.get("status") == ITEM_FAILED:
            entry.update(
                status=ITEM_QUEUED, stage="等待处理", progress=0, error="",
                summary=None,
            )
            reset = True
    return reset


def converge_interrupted_items(items: list[dict]) -> bool:
    """把取消/中断时残留的中间态条目收敛为 queued；返回是否有收敛。"""
    converged = False
    for entry in items:
        if entry.get("status") in ITEM_INTERMEDIATE:
            entry.update(status=ITEM_QUEUED, stage="等待处理", progress=0)
            converged = True
    return converged
