<p align="center" style="margin-bottom: 6px;">
  <img src="references/ico_refer/图标3-极简主义.png" alt="Talent Hub logo" width="120" />
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
> AI results are hiring assistance only — never an automatic hire-or-reject decision. HR and hiring managers always keep the final call.

## Table of contents

- [What it solves](#what-it-solves)
- [HR productivity scenarios](#hr-productivity-scenarios)
- [Current capabilities](#current-capabilities)
- [Technical highlights](#technical-highlights)
- [Quick start (development)](#quick-start-development)
- [Windows build](#windows-build)
- [Data & security](#data--security)
- [Project layout](#project-layout)
- [Limitations](#limitations)

## What it solves

- Bulk screening lacks a consistent standard, so scoring is subjective and hard to audit.
- AI judgments often lack source evidence, leading to unsupported conclusions.
- Key hiring steps live in separate tools, producing inconsistent deliverables that are hard to retain.

Talent Hub turns key hiring evaluation steps into evidence-driven, verifiable, deliverable workflows, with a local-first approach that balances efficiency and data privacy.

## HR productivity scenarios

| Scenario | Outcome |
| --- | --- |
| **Bulk screening without reading every resume** | Upload a job description and a batch of resumes; the system screens them against one consistent standard and tells you who is worth interviewing, who needs a phone call, and who to skip — so HR can focus on the top candidates at a glance. |
| **Every conclusion has a source, no rework in review** | Each judgment comes with the original resume wording as evidence, and anything uncertain is flagged for confirmation. HR reviews the supporting quotes directly instead of re-reading the whole resume. |
| **No more manual call notes** | Upload recordings for multiple candidates at once; the system transcribes them and organizes the key points, flagging anything uncertain. HR reviews and exports the record — no more listening to every call and writing minutes by hand. |
| **Ready-to-use results in one click** | Automatically generates a candidate evaluation sheet and a shortlist, ready to move the interview process forward and archive — no manual reassembly needed. |

## Current capabilities

Currently supported modules — more will follow:

### Resume screening

| Capability | Description |
| --- | --- |
| **Criteria first** | Generates the job essence, target profile, business scenarios, key actions, hard requirements, negative signals, and A/B/C decision rules from the JD. |
| **Evidence-driven evaluation** | Match and mismatch judgments must quote resume source text; key evidence that cannot be verified against the source is downgraded or sent to manual review. |
| **Tiered recommendations** | Outputs "Interview first (A)", "Confirm by phone (B)", and "Do not proceed (C)", with risk notes and phone-confirmation questions. |
| **Batch evaluation** | Supports 1–12 concurrent candidates in a single pass with no second model call. |
| **Side-by-side comparison** | Ranks selected candidates with AI and outputs the recommended interview order with reasons. |
| **Multi-format parsing** | Supports PDF, DOCX, TXT, Markdown, and common image formats; scanned documents can use Tesseract OCR. |
| **Deliverable results** | Generates and validates a five-sheet Excel workbook (candidate summary, evidence matching, phone-confirmation questions, screening criteria, recommendation list) plus Markdown screening criteria. |

### Phone screening

| Capability | Description |
| --- | --- |
| **Batch transcription** | Upload multiple recordings (m4a / wav / mp3 / ogg / opus) powered by Volcano Engine ASR. |
| **AI summarization** | Produces structured notes with organized highlights, soft-skill observations, and optional Q&A detail (off by default for speed). |
| **Dual guardrails** | Facts and soft-skill observations must trace back to the transcript; otherwise they are flagged as unconfirmed for HR to judge during review. |
| **Manual review & download** | After per-candidate review, export a Markdown record for each candidate. |

## Technical highlights

- **Local-first**: data is stored in `%LOCALAPPDATA%\TalentHub`, never in the source tree.
- **Key security**: model and ASR API keys are encrypted with the current Windows user's DPAPI.
- **Loopback isolation**: the service listens on `127.0.0.1` only and generates a per-session token at startup.
- **Lightweight frontend**: vanilla HTML/CSS/JS with no frontend framework.

## Quick start (development)

**Prerequisites**: Windows, Python, and an OpenAI Chat Completions-compatible model service.

1. Install dependencies:

   ```powershell
   python -m pip install -r requirements.txt
   ```

2. Start the app:

   ```powershell
   python -X utf8 -m app.main
   ```

The app opens your default browser on startup. On first use, enter the model service base URL, API key, and model name in Settings, then test the connection.

> [!NOTE]
> Text-based PDF, DOCX, TXT, and Markdown need no OCR. For scanned PDFs or images, install Tesseract and set the `tesseract.exe` path in Settings (install the `chi_sim` language pack for Chinese resumes).

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

## Data & security

- App data is stored by default in `%LOCALAPPDATA%\TalentHub`, including settings, task materials, parsed text, and result files.
- API keys and ASR keys are encrypted with DPAPI and never returned in plain text.
- The service listens only on the loopback address, and all API requests require a session token.
- During screening and phone summarization, the job description, parsed resume text, and transcripts are sent to your configured model / ASR service; evaluate the provider's data handling and compliance before use.
- Keep manual review for critical roles, campus hires, scarce talent, and high-risk rejections.

## Project layout

| Directory | Description |
| --- | --- |
| `app/` | FastAPI service, screening & phone pipelines, model client, runtime tools, and vanilla frontend |
| `packaging/` | PyInstaller and Inno Setup packaging config |
| `scripts/` | Build and release verification scripts |
| `references/` | Skill and icon reference materials |
| `assets/` | Application icon assets |

## Limitations

Screening and phone-summarization accuracy depends on JD clarity, resume/recording parsability, model and ASR capability, service stability, and role criteria. The system reduces unsupported judgments via evidence checks but cannot promise zero errors; final hiring decisions must be made by authorized personnel.
