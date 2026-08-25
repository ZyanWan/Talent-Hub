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
- [飞书推送配置（可选）](#飞书推送配置可选)
- [Windows 构建](#windows-构建)
- [数据与安全](#数据与安全)
- [项目结构](#项目结构)
- [使用边界](#使用边界)

## 它解决什么问题

- 批量初筛缺乏统一口径，评分主观、难以复核。
- AI 判断缺少原文证据支撑，容易出现无依据的结论。
- 关键评估环节分散在不同工具，交付物不统一、难以沉淀。

Talent Hub 把招聘中的关键评估环节沉淀为证据驱动、可复核、可交付的智能流程，以本地优先的方式兼顾效率与数据隐私。

## HR 提效的核心场景

| 场景 | 效果 |
| --- | --- |
| **批量初筛不再逐份翻简历** | 上传岗位说明和一批简历，系统按统一标准快速筛选，直接给出「优先约面 / 电话确认 / 不推进」建议，HR 一眼锁定重点候选人。 |
| **每条结论都有出处，复核不返工** | 对每个候选人的判断都附上简历原话作为依据，拿不准的地方自动标记待确认。HR 复核时直接看依据，不必重新读整份简历。 |
| **电话确认不用再手写纪要** | 多位候选人的通话录音可一起上传，系统自动转成文字、整理成要点，并标出存疑信息。HR 校对后导出记录，省去逐条听录音、手工整理的功夫。 |
| **结果一键交付，直接可用** | 自动生成候选人评估表和推荐名单，可直接用于推进面试安排与存档，无需再手工整理。 |

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
