# 火山引擎本地语音识别

脚本使用火山引擎豆包语音的"录音文件极速版识别 HTTP"接口，适合不超过 2 小时、100 MB 的 WAV、MP3、OGG 或 OPUS 文件。

## 配置 API Key

新版控制台使用 API Key：

```powershell
$env:VOLCENGINE_API_KEY = "your-api-key"
```

如果控制台使用旧版鉴权，则设置 App ID 和 Access Token：

```powershell
$env:VOLCENGINE_APP_ID = "your-app-id"
$env:VOLCENGINE_ACCESS_TOKEN = "your-access-token"
```

## 执行

```powershell
python .\speech_to_text.py ".\audio\interview.mp3"
```

结果默认写入 `transcripts`：

- `interview.json`：接口原始结果，包含时间戳、词级信息和说话人字段
- `interview.txt`：按时间轴整理的纯文本稿

针对研究记录，默认关闭语义顺滑，尽量保留原始口语。需要更适合阅读的文本时再启用：

```powershell
python .\speech_to_text.py ".\audio\interview.mp3" --enable-punc --enable-ddc
```

关闭说话人分离：

```powershell
python .\speech_to_text.py ".\audio\interview.mp3" --no-speaker-info
```

输出不带时间戳：

```powershell
python .\speech_to_text.py ".\audio\interview.mp3" --no-timestamp
```

脚本会根据环境变量自动选择鉴权方式：新版使用 `X-Api-Key`，旧版使用 `X-Api-App-Key` 和 `X-Api-Access-Key`。资源 ID 固定为 `volc.bigasr.auc_turbo`。本地文件通过 Base64 放入请求体，不需要先上传 OSS。