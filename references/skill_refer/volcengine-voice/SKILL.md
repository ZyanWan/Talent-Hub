---
name: volcengine-voice
description: 火山引擎语音服务skill，支持音频转文字（ASR）和文字转音频（TTS）两大功能。ASR触发词：音频转文字、语音转文字、录音转文字、语音识别、会议记录转换、音频转写。TTS触发词：文字转音频、配音、语音合成、文字转语音。
---

# 火山引擎语音服务

提供音频转文字（ASR）和文字转音频（TTS）两大功能，使用火山引擎豆包语音 API。

## 配置凭据

环境变量获取地址：https://console.volcengine.com/speech/service/10007

```bash
# Windows PowerShell
$env:VOLCENGINE_API_KEY = "你的API_KEY"
```

或在项目根目录创建 `.env` 文件：

```env
VOLCENGINE_API_KEY=b71c7967-41de-4a95-90dd-36ed4a528659
```

**重要**：ASR 和 TTS 共用同一个 API Key。

---

## 场景一：音频转文字（ASR）

将本地音频文件转换为文本，并应用"全局语境约束重建法"进行后处理校准。

### 使用场景

- 会议记录转换
- 访谈转录
- 研究记录
- 个人音频转写

### 工作流程

#### Step 1: 确认音频文件与输出需求

识别用户提供音频文件路径，并确认：

- 音频文件格式（支持：.wav、.mp3、.m4a、.ogg、.opus）
- 文件大小（最大 100 MB）
- 输出目录（默认：音频文件所在目录下的 `transcripts/`）
- 是否需要说话人分离（默认：开启）
- 是否需要语义顺滑（默认：关闭，保留原始口语）
- 是否需要标点预测（默认：关闭）
- 是否需要数字格式转换（默认：关闭）

未明确指定时使用默认配置。

#### Step 2: 执行音频转文字

运行 [scripts/speech_to_text.py](scripts/speech_to_text.py) 执行转录：

```powershell
python scripts/speech_to_text.py "音频文件路径" [选项]
```

常用选项：
- `--output-dir <路径>`：指定输出目录
- `--no-speaker-info`：关闭说话人分离
- `--enable-punc`：启用标点预测
- `--enable-itn`：启用数字格式转换
- `--enable-ddc`：启用语义顺滑
- `--no-timestamp`：输出 TXT 文件中不包含时间戳

输出结果：
- `<文件名>.json`：原始 ASR 结果（包含时间戳、词级信息）
- `<文件名>.txt`：按时间轴整理的纯文本稿

#### Step 3: 应用文本后处理校准

读取 [references/stt_text_post-processing_methodology.md](references/stt_text_post-processing_methodology.md)，按照"全局语境约束重建法"对 Step 2 输出的文本进行校准：

1. **全局建模**：建立事实模型、角色模型和对话模型
2. **局部重建**：分析说话人归属、断句、错词等问题
3. **全局回验**：检查修正后的全局一致性

校准原则：
- **原文锚定**：不脱离原文创造新事实
- **全文优先**：局部不通顺需参考全文上下文
- **角色功能**：说话人判断基于对话功能而非原始标签
- **最小干预**：选择改动最少的方案
- **不确定性守恒**：无法唯一恢复时保留原文表达

#### Step 4: 输出最终文本

生成最终校准文本：

```text
{输出目录}/
├── {音频文件名}.json          # 原始 ASR 结果
├── {音频文件名}.txt           # 时间轴文本稿
└── {音频文件名}-校准版.txt     # 校准后的最终文本
```

### 文件限制

- 最大文件大小：100 MB
- 最长时长：约 2 小时
- 支持格式：.wav、.mp3、.m4a、.ogg、.opus

### ASR 参考文件

| 文件 | 何时加载 |
|------|----------|
| [references/stt_text_post-processing_methodology.md](references/stt_text_post-processing_methodology.md) | 执行 Step 3 文本后处理校准时（必读） |
| [references/volcengine_asr_usage.md](references/volcengine_asr_usage.md) | 需要查看脚本详细使用说明时 |

---

## 场景二：文字转音频（TTS）

将文本转换为高质量的语音文件，支持多种音色和格式。

### 使用场景

- 为视频配音
- 生成音频文件
- 语音合成

### 安装依赖

首次使用前需要安装依赖：

```bash
pip install websockets
```

### 基本使用

```bash
# 基本使用
python scripts/text_to_speech.py --text "你好，世界！" --output output.wav

# 指定音色
python scripts/text_to_speech.py \
  --text "这是一段测试文本" \
  --speaker "BV700_V2_streaming" \
  --output audio.wav

# 指定模型版本和音频格式
python scripts/text_to_speech.py \
  --text "测试文本" \
  --speaker "BV700_V2_streaming" \
  --resource_id "seed-tts-2.0" \
  --format mp3 \
  --sample_rate 24000 \
  --output audio.mp3
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--text` | 要转换的文本（必需） | - |
| `--output` | 输出文件路径 | output.wav |
| `--speaker` | 音色ID | BV700_V2_streaming |
| `--format` | 音频编码格式 (wav/mp3/ogg_opus/pcm) | wav |
| `--sample_rate` | 音频采样率 | 24000 |
| `--api_key` | 火山引擎 API Key | 环境变量 VOLCENGINE_API_KEY |
| `--resource_id` | 资源ID（模型版本） | seed-tts-1.0 |

### 模型版本

- `seed-tts-1.0`：语音合成模型 1.0（默认）
- `seed-tts-2.0`：语音合成模型 2.0，音质更优

### 语音类型参考

常用语音类型：
- `BV700_V2_streaming` - 标准女声
- `zh_female_qingxin` - 清新女声
- `zh_male_jingpin` - 精品男声

更多语音类型请参考[火山引擎官方文档](https://console.volcengine.com/speech/new/voices)。

---

## 按需加载的参考文件

| 文件 | 何时加载 |
|------|----------|
| [references/stt_text_post-processing_methodology.md](references/stt_text_post-processing_methodology.md) | 执行 ASR Step 3 文本后处理校准时（必读） |
| [references/volcengine_asr_usage.md](references/volcengine_asr_usage.md) | 需要查看 ASR 脚本详细使用说明时 |
| [scripts/speech_to_text.py](scripts/speech_to_text.py) | 执行 ASR 音频转文字时（脚本调用） |
| [scripts/text_to_speech.py](scripts/text_to_speech.py) | 执行 TTS 文字转音频时（脚本调用） |

---

## 基础规则

### ASR 规则

- 转录前确认文件格式和大小符合要求
- ASR 转录结果（.json）始终保留作为原始记录
- 后处理校准只修复影响理解和归属的错误，不将口语改写成书面语
- 无法唯一恢复的内容保留原始表达或标记存疑
- 不引入原文无法支持的新信息

### TTS 规则

- 确保网络可以访问火山引擎API端点
- 音频文件会保存到指定的输出路径，请确保目录有写入权限
- 建议将生成的音频文件放在项目的public或assets目录中
- 支持多个模型版本，可通过 `--resource_id` 参数指定