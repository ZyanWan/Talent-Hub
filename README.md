<p align="center" style="margin-bottom: 6px;">
  <img src="references/ico_refer/图标3-极简主义.png" alt="Talent Hub 图标" width="120" />
</p>

<h1 align="center" style="margin-top: 0;">Talent Hub</h1>

<p align="center">
  <em>本地运行、证据驱动的 AI 人才工作台，围绕招聘中的关键判断提供可复核、可交付的智能辅助，让每一次人才判断都有据可循。</em>
</p>

<p align="center">
  <a href="README.en.md">English</a> · 简体中文
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Language-Python-3776AB?style=flat&amp;logo=python&amp;logoColor=white" alt="Language: Python" />
  <img src="https://img.shields.io/badge/Backend-FastAPI-009688?style=flat&amp;logo=fastapi&amp;logoColor=white" alt="Backend: FastAPI" />
  <img src="https://img.shields.io/badge/Frontend-Vanilla%20JS-F7DF1E?style=flat&amp;logo=javascript&amp;logoColor=black" alt="Frontend: Vanilla JS" />
  <img src="https://img.shields.io/badge/Excel-openpyxl-217346?style=flat" alt="Excel: openpyxl" />
  <img src="https://img.shields.io/badge/PDF-pdfplumber-7B5BF2?style=flat" alt="PDF: pdfplumber" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OCR-Tesseract-B45F2A?style=flat" alt="OCR: Tesseract" />
  <img src="https://img.shields.io/badge/ASR-Volcano%20Engine-3370FF?style=flat" alt="ASR: Volcano Engine" />
  <img src="https://img.shields.io/badge/Platform-Windows-0078D6?style=flat&amp;logo=windows&amp;logoColor=white" alt="Platform: Windows" />
  <img src="https://img.shields.io/badge/Packaging-PyInstaller%20%2B%20Inno%20Setup-8AA0B5?style=flat" alt="Packaging: PyInstaller + Inno Setup" />
</p>

> [!IMPORTANT]
> AI 结果仅用于招聘辅助，不构成自动录用或淘汰决定。HR 与用人部门始终保留最终判断权。

## 目录

- [它解决什么问题](#它解决什么问题)
- [HR 提效的核心场景](#hr-提效的核心场景)
- [当前能力](#当前能力)
- [技术特性](#技术特性)
- [快速开始（开发环境）](#快速开始开发环境)
- [应用设置（配置项说明）](#应用设置配置项说明)
- [飞书推送配置（可选）](#飞书推送配置可选)
- [Windows 构建](#windows-构建)
- [数据与安全](#数据与安全)
- [项目结构](#项目结构)
- [使用边界](#使用边界)

## 它解决什么问题

招聘高峰时，HR 常常被重复性事务拖住，真正花在研究判断上的时间反而被挤压：

- **简历量大，筛不过来看不完**——大批简历只能逐份翻看判断，耗时费力，急了更容易凭感觉打分、漏掉合适的人。
- **尺度不统一，结论说不清**——不同人、不同时候判得不一样，候选人或用人部门问起来，拿不出留谁刷谁的依据。
- **关键环节断在各自工具里**——初筛、电话核实、结果整理分散在不同地方，信息碎、容易漏，想沉淀成可复用的记录很麻烦。

Talent Hub 把招聘里最耗时、最容易带主观偏差的几个环节串成一个流程：判断留有依据、拿不准的自动标出、结果即拿即用，同时数据留在本机，兼顾效率与信息保密。

## HR 提效的核心场景

| 业务环节 | 原来常见的卡点 | 用了 Talent Hub 之后 |
| --- | --- | --- |
| **批量初筛** | 几十上百份简历要逐份翻、凭印象打分，尺度忽高忽低，容易漏掉合适的人。 | 上传岗位说明和一叠简历，按统一标准自动筛出一份分档名单，一眼锁定重点候选人。 |
| **判断与复核** | 候选人问进展、用人部门要理由，结论却说不清依据；复核要整份重读，耗时长。 | 每个判断都附上可回溯的依据，拿不准的自动标注，复核只看凭证，不再整份重读。 |
| **电话确认** | 录音要逐段重听、手动记要点、再整理归档，一套下来非常占时间，还容易记漏。 | 一次上传多位候选人录音，自动整理成要点并标出存疑之处，校对后直接导出留档。 |
| **结果交付** | 名单、纪要散落在不同工具，格式不一，汇总整理费时易错。 | 自动生成统一的评估结果与推荐名单，可直接用于面试安排与存档。 |
| **结果同步** | 要守在电脑前看进度，结果出来后还要手动整理转发到群里，给同事同步要另花功夫。 | 任务一完成，结果摘要自动推送到指定飞书群，手机上就能看到排名与结论，不用守着刷新、不用自己转发。 |

## 当前能力

以下为当前已支持的模块，功能将持续扩展：

### 简历筛选

| 能力 | 说明 |
| --- | --- |
| **岗位标准先行** | 从 JD 生成岗位本质、核心对象、业务场景、关键动作、硬门槛、负向信号与 A/B/C 判定规则。 |
| **证据驱动评估** | 匹配与不匹配判断必须引用简历原文；无法通过原文校验的关键证据会被降档或转人工确认。 |
| **分层建议** | 输出「优先约面（A）」「电话确认（B）」「不推进（C）」，并附风险提示与电话确认问题。 |
| **批量评估** | 支持 1–12 路并发，一次性完成全部候选人评估，无二次模型调用。 |
| **横向对比** | 对选中候选人做 AI 排序，输出推荐约面顺序与理由。 |
| **多格式解析** | 支持 PDF、DOCX、TXT、Markdown 与常见图片；扫描件可接入 Tesseract OCR。 |
| **可交付结果** | 生成并校验五张工作表的 Excel（候选人总表、证据匹配、电话确认问题、筛选标准、推荐名单）与 Markdown 筛选标准。 |

### 电话确认

| 能力 | 说明 |
| --- | --- |
| **批量录音转写** | 上传多段录音（m4a / wav / mp3 / ogg / opus），接入火山引擎 ASR。 |
| **AI 整理** | 生成结构化说明，含结构化要点、分点式软性表现概述与可选快筛问答（默认关闭以提速）。 |
| **事实守卫** | 事实引用须能回溯到转写原文，否则标记为含糊，由 HR 校对时判断。 |
| **人工校对与下载** | 逐人校对后，每位候选人导出 Markdown 档案。 |

### 飞书推送

| 能力 | 说明 |
| --- | --- |
| **任务完成自动通知** | 简历筛选完成或电话整理完成后，自动把结果摘要推送到指定飞书群。 |
| **结果摘要消息** | 筛选任务推送岗位、候选人总数、A/B/C 结论分布与前 5 名候选人（姓名+结论+证据等级）；电话任务推送任务标题、完成条目数与各候选人关键确认字段。 |
| **测试飞书链接** | 设置中可一键发送测试消息，验证 Webhook 连通性。 |
| **失败不影响任务** | 推送失败只记录提示，不影响筛选/电话任务本身的完成状态。 |

## 技术特性

- **本地优先**：数据默认保存在 `%LOCALAPPDATA%\TalentHub`，不写入源码目录。
- **密钥安全**：模型、ASR 与飞书签名密钥使用当前 Windows 用户的 DPAPI 加密。
- **回环隔离**：服务仅监听 `127.0.0.1`，每次启动生成随机会话令牌。
- **轻量前端**：原生 HTML/CSS/JS，无前端框架依赖。
- **飞书通知可选**：使用飞书自定义机器人 Webhook 推送结果摘要，无新增第三方依赖。

## 快速开始（开发环境）

**前置条件**：Windows、Python，以及可用的 OpenAI Chat Completions 兼容模型服务。

1. 安装依赖：

   ```powershell
   python -m pip install -r requirements.txt
   ```

2. 启动应用：

   ```powershell
   python -X utf8 -m app.main
   ```

应用启动后会在默认浏览器打开。首次使用时，在设置中填写模型服务基础地址、API Key 与模型名称，并测试连接。

> [!NOTE]
> 文本型 PDF、DOCX、TXT、Markdown 无需 OCR；处理扫描 PDF 或图片时需安装 Tesseract 并在设置中配置 `tesseract.exe` 路径（中文简历建议安装 `chi_sim` 语言包）。

## 应用设置（配置项说明）

在应用顶栏右侧的「设置」弹窗中集中管理以下配置。其中「模型服务基础地址 / API Key / 模型名称」为必填，其余为可选或按需调整。

| 配置 | 默认值 / 范围 | 说明 |
| --- | --- | --- |
| 模型服务基础地址 | `https://api.openai.com/v1` | 兼容 `/chat/completions` 与 JSON 输出的 OpenAI 格式服务；需以 `/v1` 结尾。 |
| API Key | 空 | 模型服务的访问密钥，DPAPI 加密保存在本机，界面不显示明文。 |
| 模型名称 | 空 | 实际使用的模型标识，由模型服务商决定。 |
| 并发数 | 6（1–12） | 每批同时处理的候选人数量。值越大越快，但受模型服务商限流影响；遇限流时请调低。 |
| 请求超时（秒） | 180（30–600） | 单次模型请求的超时时间；模型响应较慢时可适当调大。 |
| Tesseract 路径 | 空 | 处理扫描 PDF 或图片简历时的 `tesseract.exe` 路径；文本型 PDF/DOCX/TXT/Markdown 无需配置，中文简历建议安装 `chi_sim` 语言包。 |
| 保留解析文本 | 开启 | 是否在本机保留解析后的简历文本；关闭后任务不再保存解析文本，以减小本机数据留存。 |
| 语音转写密钥 | 空 | 火山引擎大模型语音识别（录音文件极速版）的 API Key，用于电话确认的录音转写；DPAPI 加密保存。 |
| 电话快筛详情（问答原文） | 关闭 | 开启后电话整理会生成通篇问答原文；默认关闭以大幅缩短整理耗时。 |

### 语音转写（火山引擎）配置

电话确认的录音转写依赖**火山引擎大模型语音识别（录音文件极速版）**，只需一个 API Key。

1. 打开[火山引擎语音 / 豆包语音控制台](https://console.volcengine.com/speech/app)并登录（未注册需先注册并完成实名认证）。
2. 创建应用，并**务必勾选「录音文件极速版 / 大模型语音识别极速版」**（资源 `volc.bigasr.auc_turbo`）；不要误选标准版或实时流式识别，否则无法转写本地录音文件。
3. 在控制台的「API Key」页面（新版控制台）复制 **API Key**。
4. 在应用「设置」中把该 Key 填入「语音转写密钥」，保存即可。

> [!NOTE]
> 语音转写由火山引擎按转写时长计费，建议先在控制台确认免费额度与资源包。转写文本与整理档案只保存在本机，不会上传到模型服务。

### 环境变量（可选）

| 环境变量 | 说明 |
| --- | --- |
| `TALENT_HUB_API_KEY` | 以环境变量方式注入模型 API Key；适用于非 Windows 系统或不便在设置中保存密钥的场景。设置中保存的 Key 优先，未保存时回退到该变量。 |
| `TALENT_HUB_DATA_DIR` | 覆盖默认数据目录 `%LOCALAPPDATA%\TalentHub`，用于设置、任务材料、解析文本与结果文件的存储位置。 |

## 飞书推送配置（可选）

开启后，简历筛选完成与电话整理完成时，结果摘要会自动推送到指定飞书群。

1. 在飞书桌面客户端进入目标群 → 右上角设置 → 群机器人 → 添加机器人 → **自定义机器人** → 设置名称并添加。
2. 复制弹出的 **Webhook 地址**（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`）。
3. 在应用「设置」弹窗的「飞书推送」区块：勾选「任务完成后自动推送结果到飞书群」，粘贴 Webhook 地址，点击「测试飞书链接」验证，最后保存。

> [!TIP]
> ① 未开启签名校验时，签名密钥留空即可；若在飞书中开启「签名校验」，请把生成的密钥填入「飞书推送 · 签名密钥」。② 请勿在机器人安全设置中勾选「自定义关键词」，否则不含关键词的消息会被飞书拦截。③ 推送内容仅含候选人姓名、结论与关键字段摘要，不含联系方式与转写原文。

## Windows 构建

1. 安装构建依赖：

   ```powershell
   python -m pip install -r requirements-build.txt
   ```

2. 执行构建脚本：

   ```powershell
   .\scripts\build_windows.ps1
   ```

便携版与安装包输出到 `release\` 目录，最终用户无需安装 Python。构建脚本会生成图标与版本信息，并对便携版做健康检查与启动烟测。生成安装程序需 Inno Setup 7 或 6。

## 数据与安全

- 应用数据默认保存在 `%LOCALAPPDATA%\TalentHub`，包括设置、任务材料、解析文本与结果文件。
- API Key 与 ASR Key 使用 DPAPI 加密保存，接口不回显明文。
- 服务仅监听本机回环地址，所有 API 请求均需携带会话令牌。
- 筛选与电话整理时，岗位说明、解析后的简历文本及转写文本会发送至用户配置的模型 / ASR 服务；使用前应评估服务商的数据处理与合规性。
- 飞书推送通过 Webhook 将结果摘要发送至飞书服务器；请妥善保管 Webhook 地址，避免泄露后被他人在群内发送消息。
- 关键岗位、校招生、稀缺人才及高风险淘汰结果应保留人工复核。

## 项目结构

| 目录 | 说明 |
| --- | --- |
| `app/` | FastAPI 服务、筛选与电话流程、模型客户端、运行时工具与原生前端 |
| `packaging/` | PyInstaller 与 Inno Setup 打包配置 |
| `scripts/` | 构建与发布验证脚本 |
| `references/` | 技能与图标参考资料 |
| `assets/` | 应用图标资源 |

## 使用边界

筛选与电话整理的准确性受 JD 清晰度、简历 / 录音可解析质量、模型与 ASR 能力、服务稳定性及岗位口径影响。系统通过证据校验降低无依据判断的风险，但不能承诺零误判；最终招聘决策必须由具备授权的人员作出。
