# 0. Project Note

事实来源：`app/`（后端）+ `frontend/`（前端）。项目结构、参考文档与运行拓扑等细节从 `docs/SOURCE_MAP.md` 入口按主题查阅 `docs/source-map/`。

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

**功能变更与文档更新必须同时完成，禁止先改代码后补文档。** 用户依赖文档配置与使用功能；文档落后于代码会直接造成困惑。

- 新增模块、能力或外部服务 → 同步更新 `README.md` / `README.en.md`（当前能力、技术特性、配置章节）与 `APP_GUIDE.md`（面向用户的操作步骤）。
- 修改代码结构、数据流、API、配置字段或状态机 → 同步更新 `docs/SOURCE_MAP.md` 入口及 `docs/source-map/` 中对应专题（代码地图、运行时拓扑、数据流、API 契约、变更影响矩阵）。
- 新增用户可操作的配置项 → 在 README 与 APP_GUIDE 中提供逐步配置指引，包含界面入口的具体描述（面向非技术用户时，说明入口在界面的哪个位置，不假设用户熟悉平台）。
- 文档必须基于代码实现描述事实，不记录临时调试过程（故障证据放 `debug/`，稳定约束回写文档）。
- 收尾前检查清单：README（中英）是否提到新功能、APP_GUIDE 是否可让新用户独立完成配置、`docs/SOURCE_MAP.md` 是否反映真实数据流与影响面。

# 6. 生产代码卫生（Code Hygiene）

**注释与文档只描述当前代码事实，使用现在时；不记录历史变迁，不引用已删除的实现。**

- 禁止过去时与历史描述：注释/文档中不得出现「之前 / 原来 / 旧版 / 原版 / 由原…变来 / 重构前 / 迁移前 / 未复刻 / 已删除」等措辞。
- 禁止引用已不存在的文件或符号：一律直接描述当前行为，不引用历史实现。
- 迭代修改直接改原文件，不留 v1/v2 双份命名（如 `*-v2.test.ts`）；旧版本不再使用时删除，不保留"第二版"。
- 禁止把对话指令、用户要求、评审意见的措辞写进生产代码或生产文档；约束只沉淀在 `AGENTS.md` / `README` / `docs/SOURCE_MAP.md` 等约定性文档中。
- 文档（README / `docs/SOURCE_MAP.md` / APP_GUIDE）只描述当前事实，不记录过程与历史（临时调试证据放 `debug/`）。
