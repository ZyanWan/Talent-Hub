<p align="center" style="margin-bottom: 6px;">
  <img src="assets/app-icon-logo.png" alt="Talent Hub logo" width="120" />
</p>

<h1 align="center" style="margin-top: 0;">Talent Hub</h1>

<p align="center">
  <em>A local-first, evidence-driven AI talent workbench that supports key hiring decisions with verifiable, deliverable assistance.</em>
</p>

<p align="center">
  English · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Language-Python-3776AB?style=flat&amp;logo=python&amp;logoColor=white" alt="Language: Python" />
  <img src="https://img.shields.io/badge/Backend-FastAPI-009688?style=flat&amp;logo=fastapi&amp;logoColor=white" alt="Backend: FastAPI" />
  <img src="https://img.shields.io/badge/Frontend-React%20%2B%20TS-61DAFB?style=flat&amp;logo=react&amp;logoColor=black" alt="Frontend: React + TS" />
  <img src="https://img.shields.io/badge/Excel-openpyxl-217346?style=flat" alt="Excel: openpyxl" />
  <img src="https://img.shields.io/badge/PDF-pdfplumber-7B5BF2?style=flat" alt="PDF: pdfplumber" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/OCR-Tesseract-B45F2A?style=flat" alt="OCR: Tesseract" />
  <img src="https://img.shields.io/badge/ASR-Volcano%20Engine-3370FF?style=flat" alt="ASR: Volcano Engine" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%2B%20macOS-555555?style=flat" alt="Platform: Windows + macOS" />
  <img src="https://img.shields.io/badge/Packaging-PyInstaller-8AA0B5?style=flat" alt="Packaging: PyInstaller" />
</p>

> [!IMPORTANT]
> AI results are hiring assistance only — never an automatic hire-or-reject decision. HR and hiring managers always keep the final call.

## Table of contents

- [What it solves](#what-it-solves)
- [HR productivity scenarios](#hr-productivity-scenarios)
- [Current capabilities](#current-capabilities)
- [Technical highlights](#technical-highlights)
- [Quick start (development)](#quick-start-development)
- [Application settings](#application-settings)
- [Feishu push setup (optional)](#feishu-push-setup-optional)
- [Windows build](#windows-build)
- [macOS build](#macos-build)
- [Data & security](#data--security)
- [Project layout](#project-layout)
- [Limitations](#limitations)

## What it solves

During peak hiring, HR gets buried in repetitive work and real time for judgment keeps shrinking:

- **More resumes than there is time to read** — screening means reading every one; under pressure it's easy to score on instinct and miss good fits.
- **Inconsistent standards, hard-to-explain calls** — different people, different days, different verdicts, and there's no grounding for keeping or dropping someone when candidates or hiring managers push back.
- **Key steps scattered across tools** — screening, phone checks, and result organizing live in separate places, so information gets fragmented, easily missed, and hard to turn into reusable records.

Talent Hub ties the most time-consuming, judgment-heavy steps into one flow: every call has a traceable basis, uncertain points are flagged for you, and results are ready to use — with data staying on your machine for both efficiency and confidentiality.

## HR productivity scenarios

| Step | The usual bottleneck | After Talent Hub |
| --- | --- | --- |
| **Bulk screening** | Dozens to hundreds of resumes, read one by one and scored on instinct, so the bar shifts and good candidates get missed. | Upload a role description and a stack of resumes; get a tiered shortlist screened against one consistent standard at a glance. |
| **Justifying & reviewing calls** | Candidates ask where they stand and hiring managers want the "why", but the reasoning isn't grounded; reviewing means re-reading everything. | Each judgment comes with a traceable basis, anything uncertain is flagged, and review only checks the evidence — no more full re-reads. |
| **Phone confirmation** | Play back recordings, jot notes by hand, then organize and archive — slow and easy to miss things. | Upload recordings for several candidates at once; the key points are organized and anything uncertain is flagged, then reviewed and exported for records. |
| **Delivering results** | Lists and notes live in different tools with no uniform format, so consolidating takes time and invites mistakes. | Automatically produce one unified evaluation outcome and shortlist, ready for scheduling and archiving. |
| **Sharing results** | Watching progress at the computer, then manually formatting and forwarding the outcome to the group to keep teammates in the loop. | When a task finishes, the result summary is pushed automatically to your Feishu group, so you see the ranking and calls from your phone — no refreshing, no manual forwarding. |

## Current capabilities

Currently supported modules — more will follow:

### Resume screening

| Capability | Description |
| --- | --- |
| **Criteria first** | Generates the job essence, target profile, business scenarios, key actions, hard requirements, negative signals, and A/B/C decision rules from the JD. |
| **Evidence-driven evaluation** | Match and mismatch judgments must be grounded in the resume source: direct quotes are preferred, and reasonable inference from the full experience is allowed; judgments with no traceable basis in the source are downgraded or sent to manual review. |
| **Tiered recommendations** | Outputs "Interview first (A)", "Confirm by phone (B)", and "Do not proceed (C)", with risk notes and phone-confirmation questions. |
| **Batch evaluation** | Supports 1–12 concurrent candidates in a single pass with no second model call; one parsing or model-request failure does not stop the remaining resumes. |
| **Saved partial results** | Each successful evaluation is saved locally immediately; if batch finalization fails, completed candidates remain viewable and the run can be restarted, while download, append, and notification actions stay unavailable until formal artifacts exist. |
| **Side-by-side comparison** | Ranks selected candidates with AI and outputs the recommended interview order with reasons. |
| **Multi-format parsing** | Supports PDF, DOCX, TXT, Markdown, and common image formats; scanned documents can use Tesseract OCR. |
| **Deliverable results** | Generates and validates a five-sheet Excel workbook (candidate summary, evidence matching, phone-confirmation questions, screening criteria, recommendation list) plus Markdown screening criteria. |

### Phone screening

| Capability | Description |
| --- | --- |
| **Batch transcription** | Upload multiple recordings (m4a / wav / mp3 / ogg / opus) powered by Volcano Engine ASR. |
| **AI summarization** | Produces structured notes with organized highlights, bullet-point soft-skill summaries, and optional Q&A detail (off by default for speed). |
| **Fact guardrails** | Fact references must trace back to the transcript; otherwise they are flagged as unconfirmed for HR to judge during review. |
| **Manual review & download** | After per-candidate review, export a Markdown record for each candidate. |

### Feishu push

| Capability | Description |
| --- | --- |
| **Auto notification on completion** | Pushes results to a designated Feishu group when resume screening or phone screening finishes. |
| **HR-focused result messages** | Each resume-screening run sends one overview with submitted/successful/failed counts, A/B/C distribution, and one-line judgments for up to five A/B candidates; phone screening sends one redacted full organized record per candidate. |
| **Incremental deduplication** | Appended resumes notify only newly evaluated results and include the cumulative role total; appended recordings send only entries not yet pushed successfully; a full re-screen after criteria changes is notified as a new version. |
| **Reliable delivery** | Transient network errors, HTTP 429, and 5xx responses receive limited retries with rate limiting; push failures are recorded without changing the screening or phone task's business status. |
| **Manual notification retry** | From a completed screening result or phone task detail, click "Retry Feishu notification" to send only pending results and see whether this attempt actually sent anything. |
| **Test Feishu link** | One-click test message in Settings to verify Webhook connectivity. |

## Technical highlights

- **Local-first**: data is stored on the user's machine (Windows: `%LOCALAPPDATA%\TalentHub`; macOS: `~/.local/share/TalentHub`), never in the source tree.
- **Key security**: Windows encrypts model, ASR, and Feishu signature keys with the current user's DPAPI; macOS uses environment variables for secrets.
- **Loopback isolation**: the service listens on `127.0.0.1` only and generates a per-session token at startup.
- **Frontend**: React + TypeScript frontend (Vite build), served by FastAPI.
- **Optional Feishu notifications**: pushes result summaries via a Feishu custom bot Webhook, with no new third-party dependency.

## Quick start (development)

**Prerequisites**: Windows or macOS, Python, and an OpenAI Chat Completions-compatible model service.

1. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

2. Build the frontend (the backend serves the `frontend/dist` build output):

   Windows:

   ```powershell
   cd frontend
   npm ci
   npm run build
   ```

   macOS:

   ```bash
   cd frontend && npm ci && npm run build
   ```

   > Windows shortcut: double-click `start-app.bat` in the project root. It builds the frontend (step 2) and starts the app (step 3); while developing, frontend changes are rebuilt automatically, so a page refresh shows the latest code.

3. Start the app:

   Windows:

   ```powershell
   python -X utf8 -m app.main
   ```

   macOS:

   ```bash
   export TALENT_HUB_API_KEY="your model API key"
   python -X utf8 -m app.main
   ```

The app opens your default browser on startup. On first use, enter the model service base URL, API key, and model name in Settings, then test the connection; on macOS, configure secrets with environment variables.

> [!NOTE]
> Text-based PDF, DOCX, TXT, and Markdown need no OCR. For scanned PDFs or images, install Tesseract and set the Tesseract executable path in Settings (install the `chi_sim` language pack for Chinese resumes). On macOS, install it with `brew install tesseract tesseract-lang`.

## Application settings

The Settings dialog (top-right) centrally manages the options below. "Model base URL / API key / Model name" are required; the rest are optional or tuned on demand.

| Setting | Default / range | Description |
| --- | --- | --- |
| Model base URL | `https://api.openai.com/v1` | An OpenAI Chat Completions-compatible service supporting `/chat/completions` and JSON output; must end in `/v1`. |
| API key | empty | Model service access key; Windows encrypts it with DPAPI, while macOS uses the `TALENT_HUB_API_KEY` environment variable. |
| Model name | empty | The model identifier to use, as defined by your model provider. |
| Concurrency | 6 (1–12) | Number of candidates processed in parallel per batch. Higher is faster but is limited by the provider's rate limits; lower it when rate-limited. |
| Request timeout (seconds) | 180 (30–600) | Timeout for a single model request; increase it when the model responds slowly. Criteria generation tries up to 3 times; each candidate evaluation allows up to 2 model transport attempts. |
| Tesseract path | empty | Tesseract executable path for scanned PDFs or image resumes. Not needed for text PDF/DOCX/TXT/Markdown; install the `chi_sim` language pack for Chinese resumes. |
| Retain parsed text | on | Whether to keep the parsed resume text locally. Turn off to stop storing parsed text and reduce local data retention. |
| Speech-to-text key | empty | Volcano Engine large-model speech recognition (audio-file fast version) API key; Windows encrypts it with DPAPI, while macOS uses the `TALENT_HUB_ASR_API_KEY` environment variable. |
| Phone Q&A detail (verbatim transcript) | off | When enabled, phone summarization also produces a full Q&A transcript; off by default to greatly cut processing time. |

### Speech-to-text (Volcano Engine) setup

Phone-call transcription uses **Volcano Engine large-model speech recognition (audio-file fast version)** and needs just one API key.

1. Open the [Volcano Engine Speech / Doubao voice console](https://console.volcengine.com/speech/app) and log in (register and complete real-name verification first if needed).
2. Create an app and be sure to select **"Audio-file fast version / Large-model speech recognition fast version"** (resource `volc.bigasr.auc_turbo`); do not pick the standard or streaming variant, which cannot transcribe local files.
3. In the console's "API key" page (new console), copy the **API key**.
4. On Windows, paste that key into "Speech-to-text key" in Settings and save; on macOS, set `TALENT_HUB_ASR_API_KEY` before launch.

> [!NOTE]
> Transcription is billed by Volcano Engine by transcript duration; check the free allowance and resource packs in the console first. Audio files are sent to Volcano Engine ASR for transcription. The transcript is sent to the configured model service to generate the organized call record. Transcripts and organized records are saved in the local data directory.

### Environment variables (optional)

| Variable | Description |
| --- | --- |
| `TALENT_HUB_API_KEY` | Injects the model API key via environment variable. On Windows, a saved key takes precedence and this variable is a fallback; on macOS, use this variable for the model key. |
| `TALENT_HUB_ASR_API_KEY` | Injects the Volcano Engine ASR API key via environment variable; macOS uses this variable for speech-to-text. |
| `TALENT_HUB_FEISHU_SIGN_SECRET` | Injects the Feishu bot signature secret via environment variable; the Webhook URL can still be saved in Settings. |
| `TALENT_HUB_DATA_DIR` | Overrides the default data directory (Windows: `%LOCALAPPDATA%\TalentHub`; macOS: `~/.local/share/TalentHub`), which stores settings, task materials, parsed text, and result files. |
| `TESSERACT_CMD` | Specifies the Tesseract executable path; if unset, the app tries `PATH` and platform-specific common locations. |

## Feishu push setup (optional)

When enabled, each resume-screening run pushes one business overview, while phone screening pushes one organized record per candidate. Appended work notifies only new results that have not been pushed successfully; a full re-screen after criteria changes is notified as a new version.

1. In the Feishu desktop client, open the target group → top-right settings → Group bots → Add bot → **Custom bot** → set a name and add it.
2. Copy the generated **Webhook URL** (e.g. `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx`).
3. In the app's Settings dialog, under the "Feishu push" section: check "Automatically push results to the Feishu group when tasks finish", paste the Webhook URL, click "Test Feishu link" to verify, then save.

> [!TIP]
> ① If signature verification is not enabled, leave the signature secret blank; if you enable "Signature verification" in Feishu, paste the generated secret into "Feishu push · Signature secret". ② Do not set a "custom keyword" on the bot — messages without the keyword would be blocked by Feishu. ③ Resume messages contain only statistics, candidate names, conclusions, and one-line judgments. Phone messages contain the app's text-based organized record, but mobile numbers, landlines, and email addresses are redacted; raw transcripts, internal facts, and citations are not appended. Oversized phone messages are truncated with a prompt to view the full record in Talent Hub.

## Windows build

1. Install build dependencies:

   ```powershell
   python -m pip install -r requirements-build.txt
   ```

2. Run the build script:

   ```powershell
   .\scripts\build_windows.ps1
   ```

Portable and installer outputs go to `release\`; end users don't need Python. The build script generates the icon and version info, and performs health-check and startup smoke tests on the portable app. Building the installer requires Inno Setup 7 or 6.

## macOS build

macOS artifacts must be built on macOS. Install build dependencies explicitly before building:

```bash
python -m pip install -r requirements-build.txt
bash scripts/build_macos.sh
```

The script creates `dist/TalentHub.app` and `release/<version>/macos/TalentHub-macOS-<version>.zip`, then runs a local startup smoke test. The macOS package is currently unsigned and not notarized; organization distribution should add Apple Developer ID signing and notarization.

## Data & security

- App data is stored by default on the user's machine (Windows: `%LOCALAPPDATA%\TalentHub`; macOS: `~/.local/share/TalentHub`), including settings, task materials, parsed text, and result files.
- On Windows, API keys, ASR keys, and Feishu signature secrets are encrypted with DPAPI; on macOS, secrets are provided through environment variables. Plaintext secrets are never returned by the API.
- The service listens only on the loopback address, and all API requests require a session token.
- During screening and phone summarization, the job description, parsed resume text, and transcripts are sent to your configured model / ASR service; evaluate the provider's data handling and compliance before use.
- Feishu push sends result summaries to Feishu servers via a Webhook; keep the Webhook URL private to prevent others from posting messages into the group.
- Keep manual review for critical roles, campus hires, scarce talent, and high-risk rejections.

## Project layout

| Directory | Description |
| --- | --- |
| `app/` | FastAPI service, screening & phone pipelines, model client, runtime tools |
| `frontend/` | React + TypeScript frontend project (Vite build) |
| `packaging/` | PyInstaller and Inno Setup packaging config |
| `scripts/` | Build and release verification scripts |
| `docs/references/` | External background reference files (not part of the app) |
| `assets/` | Application icon assets |

## Limitations

Screening and phone-summarization accuracy depends on JD clarity, resume/recording parsability, model and ASR capability, service stability, and role criteria. The system reduces unsupported judgments via evidence checks but cannot promise zero errors; final hiring decisions must be made by authorized personnel.
