# Prompt A/B 测试工作台

用于对 `app/runtime/phone_screening.py` 的电话初筛整理 prompt 做迭代验证：修改 prompt 前后各跑一遍相同的通话转写，对比输出质量，避免 prompt 调整引入劣化。

## 文件结构

```
prompt_ab/
├── eval_prompt.py          # 测试脚本（用法见下）
├── normal/                 # 用例：优秀候选人（王晓明）——验证真亮点不被误杀
├── mediocre/               # 用例：平庸候选人（陈磊）——验证普通应答不被拔高
├── subtle_risk/            # 用例：隐性风险候选人（周宇）——验证隐性风险不被漏检
└── risk/                   # 用例：显性风险候选人（李强）——验证显性风险捕捉不劣化
```

每个用例文件夹只需维护 `transcript.txt`（通话转写文本，说话人 0 为 HR、说话人 1 为候选人）。四个用例分别校准 prompt 的四种核心能力，覆盖从优秀到显性风险的能力光谱。

## 典型工作流

在项目根目录执行：

```powershell
# 1. 修改 prompt 前，保存当前 system prompt 快照作为基线
python debug\prompt_ab\eval_prompt.py --case call-summary --save-current-system debug\prompt_ab\snapshot_before.txt

# 2. 修改 app/runtime/phone_screening.py 或软性素质框架文件

# 3. 对比运行：快照（variantA）vs 修改后（variantB），逐用例执行
python debug\prompt_ab\eval_prompt.py --compare-system debug\prompt_ab\snapshot_before.txt --a-name variantA --b-name variantB --input debug\prompt_ab\subtle_risk\transcript.txt --candidate 周宇 --out-dir debug\prompt_ab\subtle_risk

# 4. 人工审读 out-dir 下的 variantA_result.md 与 variantB_result.md，
#    结合 JSON 里的质量指标（见下节）判断优化还是劣化

# 5. 验证完毕后删除快照与 result 产物（移入回收站，勿永久删除）
```

`--candidate` 参数只影响输出文件的候选人姓名显示，需与转写内容一致。

## 质量指标说明

`*_result.json` 中的 `quality` 字段为自动量化指标：

| 指标 | 含义 | 期望 |
|---|---|---|
| `spectator_phrases` | 旁观转述句式命中（如"候选人表示""HR 询问"） | 0（记录必须是 HR 本人口径） |
| `speaker_leak` / `timestamp_leak` | 转写说话人标记 / 时间戳泄漏到正文 | 0 |
| `markdown_leak` | Markdown 语法泄漏 | 0 |
| `generic_praise_hits` | 泛化拔高评价命中（如"整体较好""沟通顺畅"） | 0 |
| `soft_skill_polarity` | 软性分点正/负/中性计数（负面优先分类） | 结合用例画像判断 |
| `doubts` | 待确认事项 | 结合用例画像判断 |

自动化指标只能覆盖格式与句式层面，**校准是否得当（拔高/漏检/过度解读）必须人工审读 MD 文件或交给评审 agent 盲评**（盲评时不告知评审方哪个是新版本，仅以 variantA/variantB 命名）。

## 已知注意事项

- 模型偶发不返回可解析 JSON（脚本内置 3 次重试），若最终失败会抛 `LLMError`，重跑该用例即可；
- 事实引用只用于录音定位，不影响正文、招聘判断和字段状态；
- 测试产物（`*_result.json/md`、快照 txt）验证完成后应清理，本目录长期只保留脚本与用例语料。
