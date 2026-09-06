#!/usr/bin/env python3
"""任务数据分析工具：结论分布、筛选标准与评估详情、A 类条件守卫回放。

用法：
  python debug/analysis/analyze.py summary
  python debug/analysis/analyze.py criteria [--job <前缀>]
  python debug/analysis/analyze.py detail [--job <前缀>] [--conclusion A|B|C] [--candidate <姓名>]
  python debug/analysis/analyze.py replay [--job <前缀>] [--baseline] [--unsatisfied 姓名:0,3 ...]
"""

import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.models import AClassCheck, CandidateEvaluation, ScreeningCriteria
from app.pipeline import apply_evidence_guard, apply_hard_gate_guard

BASE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "TalentHub", "jobs")
CORE = ["object_match", "scenario_match", "core_actions", "ownership_depth"]
AUX = ["closed_loop", "tools_certificates", "scale_results", "stability"]
LABELS = {"A优先约面": "A", "B电话确认": "B", "C不推进": "C"}

# 历史核查后保留的模拟判定：这些候选人的 A 类条件存在存疑项。
# 何伟：独立闭环动作证据依赖多年前经历、无量化成绩；彭强/朱钊健：工具物料台账管理未展开。
DEFAULT_UNSATISFIED = {"何伟": {0, 3}, "彭强": {2}, "朱钊健": {2}}


def job_dirs(job_filter=None):
    dirs = [
        d for d in glob.glob(os.path.join(BASE, "*"))
        if os.path.isdir(d) and (not job_filter or os.path.basename(d).startswith(job_filter))
    ]
    return sorted(dirs, key=lambda d: os.path.getmtime(d))


def load_job(jobdir):
    job = json.load(open(os.path.join(jobdir, "job.json"), encoding="utf-8"))
    criteria = json.load(open(os.path.join(jobdir, "筛选标准.json"), encoding="utf-8"))
    results = json.load(open(os.path.join(jobdir, "评估结果.json"), encoding="utf-8"))
    return job, criteria, results


def header(jobdir, job):
    return f"{job['title']} [{os.path.basename(jobdir)[:8]}]"


def cmd_summary(args):
    for jobdir in job_dirs(args.job):
        try:
            job, _, results = load_job(jobdir)
        except FileNotFoundError as exc:
            print(f"[跳过] {os.path.basename(jobdir)[:8]}: 缺少 {os.path.basename(str(exc))}")
            continue
        total = len(job.get("resume_files", []))
        dist = {}
        for r in results:
            dist[LABELS.get(r["conclusion"], r["conclusion"])] = dist.get(
                LABELS.get(r["conclusion"], r["conclusion"]), 0
            ) + 1
        parts = " ".join(f"{k}={v}" for k, v in sorted(dist.items()))
        print(f"{header(jobdir, job)} | 提交{total} 成功{len(results)} | {parts}")
        for e in job.get("errors", []):
            print(f"    ERR: {e}")


def cmd_criteria(args):
    for jobdir in job_dirs(args.job):
        try:
            job, criteria, _ = load_job(jobdir)
        except FileNotFoundError as exc:
            print(f"[跳过] {os.path.basename(jobdir)[:8]}: 缺少 {os.path.basename(str(exc))}")
            continue
        print("=" * 100)
        print(f"### {header(jobdir, job)}")
        print(f"--- 岗位本质: {criteria.get('essence', '')}")
        print(f"--- 核心对象: {criteria.get('target_objects')}")
        print(f"--- 核心场景: {criteria.get('required_scenarios')}")
        for key, label in (
            ("hard_requirements", "硬性门槛"),
            ("a_conditions", "A类条件"),
            ("b_conditions", "B类条件"),
            ("c_conditions", "C类条件"),
            ("negative_signals", "负向信号"),
            ("bonus_signals", "加分信号"),
        ):
            items = criteria.get(key) or []
            if not items:
                continue
            print(f"--- {label}:")
            for i, item in enumerate(items):
                rule = item.get("rule") if isinstance(item, dict) else item
                verification = item.get("verification") if isinstance(item, dict) else ""
                print(f"    [{i}] {rule}" + (f" (核验: {verification})" if verification else ""))


def cmd_detail(args):
    for jobdir in job_dirs(args.job):
        try:
            job, criteria, results = load_job(jobdir)
        except FileNotFoundError as exc:
            print(f"[跳过] {os.path.basename(jobdir)[:8]}: 缺少 {os.path.basename(str(exc))}")
            continue
        want = args.conclusion
        name_filter = args.candidate
        for r in results:
            if want and LABELS.get(r["conclusion"]) != want:
                continue
            if name_filter and name_filter not in r.get("candidate_name", ""):
                continue
            print("=" * 100)
            print(f"### {header(jobdir, job)} | {r['candidate_name']} | {r['conclusion']} "
                  f"| level={r.get('evidence_level')} | src={os.path.basename(r.get('source_file', ''))}")
            if r.get("one_line"):
                print(f"  one_line: {r['one_line']}")
            for v in r.get("hard_gate", []):
                print(f"  硬门槛 [{v.get('id')}] {v.get('status')} | {v.get('rule')} "
                      f"| 引文: {v.get('quote', '')[:80]} | note: {v.get('note', '')[:80]}")
            for name in CORE:
                d = r.get("evidence", {}).get(name, {})
                print(f"  核心 {name}: {d.get('status')} | 摘要: {d.get('summary', '')[:100]} "
                      f"| 引文: {d.get('quote', '')[:60]} | 位置: {d.get('location', '')}")
            for name in AUX:
                d = r.get("evidence", {}).get(name, {})
                print(f"  辅助 {name}: {d.get('status')} | 摘要: {d.get('summary', '')[:80]}")
            for c in r.get("a_conditions_check", []):
                print(f"  A类条件 [{c.get('status')}] {c.get('condition', '')[:60]} | 依据: {c.get('evidence', '')[:60]}")
            if r.get("blockers"):
                print(f"  blockers: {r['blockers']}")
            if r.get("guard_warnings"):
                print(f"  守卫告警: {r['guard_warnings']}")


def parse_unsatisfied(pairs):
    table = {}
    for pair in pairs:
        name, _, idxs = pair.partition(":")
        table[name] = {int(i) for i in idxs.split(",") if i.strip()}
    return table


def cmd_replay(args):
    unsatisfied = dict(DEFAULT_UNSATISFIED)
    if args.baseline:
        unsatisfied = {}
    unsatisfied.update(parse_unsatisfied(args.unsatisfied or []))
    for jobdir in job_dirs(args.job):
        try:
            job, criteria_raw, results = load_job(jobdir)
        except FileNotFoundError as exc:
            print(f"[跳过] {os.path.basename(jobdir)[:8]}: 缺少 {os.path.basename(str(exc))}")
            continue
        criteria = ScreeningCriteria.model_validate(criteria_raw)
        parsed_dir = os.path.join(jobdir, "parsed")
        for r in results:
            if not (args.all or r["conclusion"] == "A优先约面"):
                continue
            name = r.get("candidate_name", "")
            try:
                ev = CandidateEvaluation.model_validate(r)
            except ValueError as exc:
                print(f"[解析失败] {name}: {exc}")
                continue
            stem = os.path.splitext(os.path.basename(r.get("source_file", "")))[0]
            parsed_files = os.listdir(parsed_dir) if os.path.isdir(parsed_dir) else []
            matches = [f for f in parsed_files if f.startswith(stem) and f.endswith(".txt")]
            if not matches:
                print(f"[缺简历文本] {name}")
                continue
            resume_text = open(os.path.join(parsed_dir, matches[0]), encoding="utf-8").read()
            checks = []
            for idx, ac in enumerate(criteria.a_conditions):
                if idx in unsatisfied.get(name, set()):
                    checks.append(AClassCheck(condition=ac.rule, status="存疑", evidence="简历信息不足"))
                else:
                    evidence_text = (
                        ev.evidence.core_actions.summary
                        or ev.evidence.object_match.summary
                        or ev.evidence.scenario_match.summary
                    )
                    checks.append(AClassCheck(condition=ac.rule, status="满足", evidence=evidence_text))
            ev.a_conditions_check = checks
            before = r["conclusion"]
            ev = apply_evidence_guard(ev, resume_text)
            ev = apply_hard_gate_guard(ev, criteria, resume_text)
            reason = ev.blockers[-1] if ev.blockers else "-"
            print(f"{header(jobdir, job)} {name}: {before} -> {ev.conclusion} | {reason[:70]}")


def main():
    parser = argparse.ArgumentParser(description="Talent-Hub 任务数据分析工具")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--job", help="按任务目录 ID 前缀过滤")

    sub.add_parser("summary", parents=[common], help="各任务结论分布")
    sub.add_parser("criteria", parents=[common], help="各任务筛选标准")
    p_detail = sub.add_parser("detail", parents=[common], help="候选人评估详情")
    p_detail.add_argument("--conclusion", choices=["A", "B", "C"], help="按结论过滤")
    p_detail.add_argument("--candidate", help="按候选人姓名子串过滤")

    p_replay = sub.add_parser("replay", parents=[common], help="A 类条件守卫回放（模拟补填判定后重跑守卫）")
    p_replay.add_argument("--baseline", action="store_true", help="全部 A 类条件按满足模拟")
    p_replay.add_argument("--unsatisfied", action="append", metavar="姓名:0,3", help="追加存疑条件索引，可多次")
    p_replay.add_argument("--all", action="store_true", help="对全部结论而非仅 A 回放")

    args = parser.parse_args()
    {"summary": cmd_summary, "criteria": cmd_criteria, "detail": cmd_detail, "replay": cmd_replay}[args.command](args)


if __name__ == "__main__":
    main()
