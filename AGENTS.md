# 0. Project Note

`references/skill_refer/resume-evaluator/` is an **obsolete early-stage reference** and has no relation to the current codebase. Do not read, reference, or maintain this directory — doing so pollutes the agent context. The only authoritative reference documents for this app live in `app/resources/references/`; the code under `app/` is the source of truth.

# 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

# 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

# 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

# 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

# 5. 文档同步（Doc Sync）

**功能变更与文档更新必须同时完成，禁止先改代码后补文档。** 用户依赖文档配置与使用功能；文档落后于代码会直接造成困惑（经验来源：飞书推送上线时，用户按过时/缺失的文档找不到配置入口）。

- 新增模块、能力或外部服务 → 同步更新 `README.md` / `README.en.md`（当前能力、技术特性、配置章节）与 `APP_GUIDE.md`（面向用户的操作步骤）。
- 修改代码结构、数据流、API、配置字段或状态机 → 同步更新 `SOURCE_MAP.md`（代码地图、运行时拓扑、数据流、API 契约、变更影响矩阵）。
- 新增用户可操作的配置项 → 在 README 与 APP_GUIDE 中提供逐步配置指引，包含界面入口的具体描述（面向非技术用户时，说明入口在界面的哪个位置，不假设用户熟悉平台）。
- 文档必须基于代码实现描述事实，不记录临时调试过程（故障证据放 `debug/`，稳定约束回写文档）。
- 收尾前检查清单：README（中英）是否提到新功能、APP_GUIDE 是否可让新用户独立完成配置、SOURCE_MAP 是否反映真实数据流与影响面。