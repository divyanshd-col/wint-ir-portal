# Wint Wealth – IR Portal

An AI-powered Investor Relations (IR) operations platform. Agents use it to triage investor queries in real time, quality teams use it to score chat and call interactions, team leads use it for coaching and analytics, and data analysts use it to query conversation data in plain English.

> Built on **Next.js 16 App Router**, powered by **Google Gemini** and **Anthropic Claude**, with a **PostgreSQL** database and **Google Drive** as the knowledge base.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Features at a Glance](#features-at-a-glance)
3. [Roles & Access](#roles--access)
4. [Workflows](#workflows)
5. [AI Prompts & Examples](#ai-prompts--examples)
6. [Full Prompt Text](#full-prompt-text)
7. [Tech Stack](#tech-stack)
8. [Setup & Installation](#setup--installation)
9. [Environment Variables](#environment-variables)
10. [User Management](#user-management)
11. [Admin Scripts](#admin-scripts)
12. [Deployment & GitHub Pages](#deployment)

---

## Architecture

```
Next.js App (App Router)
│
├── /login                    — Credentials-based login
├── /                         — IR agent chat (real-time triage)
├── /quality                  — Quality evaluation hub (QA)
│   ├── /chat-evaluation      — Evaluate chat transcripts
│   ├── /call-evaluation      — Evaluate call recordings
│   ├── /tl-evaluation        — TL view of evaluations
│   └── /disputes             — QA dispute management portal
├── /agent                    — Agent self-service quality & analytics portal
│   ├── /quality-chats        — My Quality Chats (scores, parameters, raise disputes)
│   └── /quality-calls        — My Quality Calls (call scores, audio player, AI summary, raise disputes)
├── /tl                       — Team Lead dashboard
│   ├── /member-analytics     — Per-agent coaching insights & stats
│   ├── /quality-chats        — Chat quality review & TL dispute approvals
│   └── /quality-calls        — Call quality review & TL dispute approvals
├── /analytics                — Text-to-SQL analytics dashboard
├── /call-analysis            — Multimodal call audio analyzer sandbox
├── /cx                       — CX queue view (agent-level)
└── /settings                 — Admin: users, config, KB sync

app/api/
├── chat/                     — IR triage pipeline (analyze, answer, draft)
├── cx/                       — CX data APIs (QA, TL, agent, disputes)
│   └── tl/disputes/          — TL dispute review & resolution API
├── ir/                       — Agent IR APIs
│   └── disputes/             — Agent dispute submission API
├── quality/                  — Chat IQS evaluation & flag APIs
├── call-quality/             — Call scoring + 2-pass transcription pipeline
│   └── scores/               — Call evaluation scores & parameters API
├── call-analysis/            — Audio analysis engine
├── analytics/                — SQL query agent
├── conversations/            — Conversation retrieval
├── corrections/              — Manual score corrections
├── webhooks/                 — Incoming data (Robylon, etc.)
├── documents/                — KB document management
├── files/                    — Drive file listing
└── users/                    — User management

lib/
├── quality.ts                — Chat IQS scorer
├── call-quality.ts           — Call IQS scorer + transcription
├── call-analyzer.ts          — Two-pass audio analysis
├── analytics/                — SQL agent, classifier, themes, summarizer
├── store.ts                  — DB queries & dispute routing
├── drive.ts                  — Google Drive knowledge base
├── slack.ts                  — Slack notifications
├── gemini.ts                 — Gemini client wrapper
└── cx/                       — CX data utilities
```

**Core data flow:**
```
Investor query (via WhatsApp/Robylon) or Voice Call Recording
    → Webhook / Audio upload → PostgreSQL
    → Agent opens chat in IR Portal / Audio processed via 2-Pass Gemini Multimodal pipeline
    → Stage 0: Intent classified by Router
    → Stage 1: Facts collected via structured questions
    → Stage 2: Answer generated from KB + facts
    → Agent sends reply / Voice Call scored on 11 parameters
    → QA / AI evaluates interaction → IQS score stored
    → Agent views scores in My Quality Chats / My Quality Calls
    → Agent raises dispute → Routed to TL → Escalated to QA if needed
    → TL reviews coaching insights & member analytics
    → Analytics team queries data in plain English
```

---

## Features at a Glance

| Feature | Description |
|---|---|
| **Real-time triage chat** | AI walks agents through structured fact-collection before generating a resolution |
| **Knowledge Base (KB)** | Google Drive folder with PDFs/Docs auto-indexed and retrieved via keyword RAG |
| **Chat IQS scoring** | 11-parameter quality evaluation of WhatsApp/chat interactions with parameter overrides |
| **Call IQS scoring** | 11-parameter quality evaluation of voice calls with audio energy & sentiment detection |
| **Call transcription** | Two-pass Gemini multimodal pipeline transcribes, translates, and annotates calls |
| **My Quality Chats (Agent)** | Agent view of chat quality scores, 11-parameter breakdown, and dispute tracking |
| **My Quality Calls (Agent)** | Agent view of call evaluations, audio player, AI call summary/coaching, and dispute tracking |
| **TL Quality Calls & Chats** | Team Lead portal to inspect team call/chat scores, listen to audio, and approve/reject disputes |
| **3-Tier Dispute Workflow** | Structured dispute routing (Agent → Team Lead → QA) with parameter override tracking |
| **Analytics agent** | Natural language → SQL → insight synthesis with chart type selection |
| **TL coaching** | AI-generated strengths, watches, and tips per agent based on their performance stats |
| **Agent Analytics Access** | Enables Analytics and Member Analytics tabs for agent role self-monitoring |
| **Slack alerts** | Quality drop and CSAT alerts pushed to Slack |
| **Google Sheets sync** | Quality scores optionally synced to a tracking sheet |
| **Role-based access** | Roles: `agent`, `tl`, `qa`, `admin` |
| **WoW trend** | Week-over-week IQS trend view |

---

## Roles & Access

| Role | What they can do |
|---|---|
| `agent` | Access triage chat, view own analytics & member analytics, view My Quality Chats & My Quality Calls, raise chat & call IQS disputes |
| `tl` | View team quality chats & quality calls, member analytics with AI coaching briefs, review & resolve/escalate agent disputes |
| `qa` | Evaluate chats & calls, final override authority on disputes, manage dispute portal (`/quality/disputes`), configure dispositions |
| `admin` | Everything above + user management, KB management, system configuration |

---

## Workflows

### 1. IR Agent Chat (Real-Time Triage)

The main workflow for agents handling investor queries.

```
Investor message arrives (WhatsApp → Robylon → webhook)
         ↓
    Stored in PostgreSQL conversations table
         ↓
    Agent opens the chat in IR Portal (/)
         ↓
  [Stage 0] Router classifies intent
         ↓
  [Stage 1] AI asks structured clarifying questions
    (one field at a time, using canonical schemas)
         ↓
  [Stage 2] Once all facts collected → Answer generated
    from Knowledge Base (Google Drive docs)
         ↓
  [Draft] Agent clicks "Draft" → customer-facing
    message generated from the internal answer
         ↓
    Agent reviews, edits, and sends reply
```

**Stage breakdown:**

| Stage | Model | Purpose |
|---|---|---|
| Stage 0 – Router | `gemini-3.5-flash` | Classify category + query type |
| Stage 1A – Repayment | `gemini-3.5-flash` | Category-specific decision tree |
| Stage 1B – General Triage | `gemini-3.5-flash` | Structured fact collection (all categories) |
| Stage 2 – Answer | `gemini-3.5-pro` | KB-grounded resolution in 3 blocks |
| Draft | `gemini-3.5-flash` | Customer-ready message |

**Supported categories:** Repayment, KYC, Payment, SIP, Sell/DDPI, Referral, Taxation, Dashboard, FD, HUF, Out-of-domain

---

### 2. Quality Evaluation – Chat IQS

QA agents evaluate chat transcripts imported from Robylon/WhatsApp.

```
QA opens "Chats to Review" (/quality/chat-evaluation)
         ↓
    Selects a conversation
         ↓
  AI evaluates transcript on 11 parameters
         ↓
  Score displayed with per-parameter reasoning
         ↓
  QA confirms or overrides each parameter
         ↓
  IQS score stored in DB (linked to agent + date)
         ↓
  Optional: Agent raises dispute → TL/QA reviews
```

**11 Chat IQS Parameters:**

| # | Parameter | Weight |
|---|---|---|
| 1 | Technically / Legally Correct | 20% |
| 2 | All Questions Answered | 10% |
| 3 | Expectation Setting | 10% |
| 4 | Contextual & Personal | 10% |
| 5 | Follow-up & Closing | 10% |
| 6 | Sentences / Simple to Understand | 10% |
| 7 | Empathy | 10% |
| 8 | Process-wise | 5% |
| 9 | First Response & Opening | 5% |
| 10 | Call (when required) | 5% |
| 11 | Grammar / Structure | 5% |

IQS formula: `Σ (weight × pass)` normalized to 100. `NA` counts as a pass.

---

### 3. Quality Evaluation – Call IQS

Evaluates recorded voice calls. Requires audio upload or transcript.

```
QA opens "Call Evaluation" (/quality/call-evaluation)
         ↓
  Upload audio file OR paste call transcript
         ↓
  [Pass 1] Audio analyzer detects timing + speaker turns
         ↓
  [Pass 2] Transcription, translation, role identification
         ↓
  [IQS] Call scored on 11 call-specific parameters
         ↓
  [Energy/Tone] Audio signals scored separately
  (score=NA if only transcript available)
         ↓
  Score stored, poor listening segments flagged
```

**11 Call IQS Parameters:**

| Group | Parameter | Weight |
|---|---|---|
| Process (50%) | Call Opening | 5% |
| | Call Closing | 5% |
| | Technically / Legally Correct | 15% |
| | All Questions Addressed | 10% |
| | Expectation Setting | 10% |
| | Process | 5% |
| Communication (30%) | Vocabulary / Grammar | 10% |
| | Fillers, Fumbling & Dead Air | 10% |
| | Energy Level, Enthusiasm & Tone | 10% |
| Customer Service (20%) | Active Listening & Empathy | 10% |
| | Simplifying Answers | 10% |

> **Note:** SEBI violations (guaranteed returns, investment recommendations) are automatic fails on `TechnicalLegal`.

---

### 4. Analytics Agent (Text-to-SQL)

Lets anyone on the team query conversation data in plain English.

```
User types a question in /analytics
         ↓
  [Pass 1 – Planner] Intent classified → SQL plan generated
         ↓
  SQL executed against PostgreSQL
         ↓
  (If needed) Transcript retrieval + qualitative themes
         ↓
  [Pass 2 – Synthesizer] Results narrated into insights
         ↓
  Chart rendered (bar, line, table, or single number)
```

**Example queries:**

```
"What is the average IQS score for each agent this week?"
"Show me CSAT trend for the last 30 days"
"Which agents have the most disputes this month?"
"What are the top complaint themes from low-CSAT chats?"
"How many repayment queries did we get yesterday?"
"Compare IQS scores between TL teams for June"
```

---

### 5. Team Lead Coaching

TLs get AI-generated coaching summaries for each team member.

```
TL opens /tl/member-analytics
         ↓
  Selects an agent + date range
         ↓
  Stats pulled: CSAT, IQS, volume, weakest parameters,
  top dispositions
         ↓
  AI generates coaching brief:
    - Summary paragraph
    - 3–4 items: Strength | Watch | Tip
         ↓
  TL uses brief for 1:1 or team review
```

---

### 6. 3-Tier Quality Dispute Flow (Agent → TL → QA)

Agents can challenge both Chat IQS and Call IQS scores they disagree with through a 3-tier escalation hierarchy.

```
Agent views score in /agent/quality-chats or /agent/quality-calls
         ↓
  Clicks "Raise Dispute" → selects parameter & enters reason
         ↓
  Dispute routed to Agent's Team Lead (TL)
         ↓
  TL reviews in /tl/quality-chats or /tl/quality-calls
         ├── TL Accepts → score recalculates & parameter override saved
         ├── TL Rejects → dispute closed (original score stands)
         └── TL Escalates → routed to QA team
         ↓
  QA reviews in /quality/disputes with final override authority
         ↓
  Notification sent & updated IQS score synced across dashboards
```

---

### 7. Call Analysis Pipeline

Two-pass multimodal audio analysis for detailed call breakdown.

```
Audio file uploaded to /call-analysis
         ↓
  [Pass 1 – Structure] Detect speaker turns, overlaps, dead air
         ↓
  [Pass 2 – Content] Transcribe + translate + per-turn metrics:
    sentiment, aggression, confidence, empathy, speech speed
         ↓
  [Disposition] Auto-classify call topic into taxonomy
  (Liquidity, Repayment, KYC, SIP, Bond Purchase, FD, etc.)
         ↓
  [Chunk Splitter] Long calls split into topic-based slices
         ↓
  Annotated transcript displayed with timeline
```

---

## AI Prompts & Examples

### Stage 0 – Intent Router

**File:** `PROMPT_router.txt` → `app/api/chat/analyze/route.ts`
**Model:** `gemini-3.5-flash`
**When:** Runs on the first message of every conversation.

Classifies the investor's issue into a product category and determines whether the query is educational, process-based, or needs clarification.

**Output:**
```json
{
  "category": "repayment",
  "queryType": "process",
  "confidence": 0.92
}
```

**Category values:** `repayment | kyc | payment | sip | sell | referral | taxation | dashboard | fd | huf | out_of_domain`

**Query type rules:**
- `direct` — Policy/educational question (e.g. *"What is TDS?"*)
- `process` — Account-level issue needing facts (e.g. *"My payment failed"*)
- `clarify` — Vague or ambiguous input
- `out_of_domain` — Unrelated to Wint Wealth

---

### Stage 1A – Repayment Extractor

**File:** `PROMPT_extract_repayment.txt` → `app/api/chat/analyze/route.ts`
**Model:** `gemini-3.5-flash`
**When:** Only when `category = "repayment"`.

Walks a strict 3-step decision tree:
1. Was the investor holding the bond on the record date?
2. Are they contacting on the repayment date or after?
3. Has their linked bank account changed recently?

**Example resolved output:**
```json
{
  "queryType": "process",
  "category": "repayment",
  "questions": [],
  "stepTitle": "Resolution",
  "reasoning": "All facts collected. Bank account was changed after record date.",
  "extractedFacts": {
    "holding_on_record_date": "Yes",
    "contacted_on_repayment_date": "No",
    "recent_bank_change": "Yes",
    "change_before_or_after_record_date": "After",
    "bank_ifsc_check": "Matches"
  }
}
```

---

### Stage 1B – Triage & Question Generator

**File:** `PROMPT_analyze.txt` → `app/api/chat/analyze/route.ts`
**Model:** `gemini-3.5-flash`
**When:** All categories except repayment (or as fallback).

Surfaces one structured question at a time and auto-extracts facts from attached screenshots.

**Example output (mid-triage, KYC issue):**
```json
{
  "queryType": "process",
  "category": "kyc",
  "questions": [
    {
      "id": "kyc_step",
      "label": "Which KYC step is the investor stuck on?",
      "options": ["PAN Upload", "Aadhaar Verification", "Video KYC", "Bank Verification"],
      "type": "select"
    }
  ],
  "stepTitle": "Step 1: Identify KYC Stage",
  "reasoning": "Need to identify which stage failed before pulling the relevant SOP.",
  "extractedFacts": {}
}
```

---

### Stage 2 – Answer Generator

**File:** `PROMPT_chat.txt` → `app/api/chat/route.ts`
**Model:** `gemini-3.5-pro` (fallback: `gemini-3.5-flash`)
**When:** Once all facts are collected.

Retrieves the top 15 KB chunks and generates a structured 3-block internal briefing.

**Output:**
```
Block 1 — Tell the user:
"We have received your request and our team will process the repayment
within 3–5 business days to your registered bank account."

Block 2 — Agent actions:
1. Check Finder → Repayments tab → verify record date holding
2. Confirm bank account IFSC against the statement provided
3. If bank was changed post-record-date → escalate to ops

Block 3 — Escalation:
Slack: #cx-repayments-ops
POC: Ops Team
Include: Investor email, bond ISIN, record date, bank change date
```

---

### Chat Draft Generator

**File:** `app/api/chat/draft/route.ts`
**Model:** `gemini-3.5-flash`
**When:** Agent clicks "Generate Draft".

Converts the internal briefing into a customer-facing message. Strips internal references (Slack, Finder, jargon). 3–5 sentences, empathetic and professional.

**Output:**
```json
{
  "draft": "Hi Priya, thank you for reaching out! We've noted your concern about the repayment for your bond. Our team is looking into this and you should receive the amount within 3–5 business days to your registered bank account. Feel free to reach out if you have any further questions."
}
```

---

### Chat IQS Scorer

**File:** `lib/quality.ts` → `IQS_SYSTEM_PROMPT`
**Model:** `gemini-3.5-flash`
**When:** QA triggers evaluation on a chat transcript.

Scores all 11 parameters as `Yes`, `No`, or `NA` with reasoning and KB citation.

**Key scoring rules:**
- Each parameter evaluated in isolation — no cross-referencing other parameters
- Dates on or before today are past events — never fail Expectation for past dates
- Documents via WhatsApp: always incorrect; redirecting to email is correct
- Form 121 has replaced Form 15G/H — treat as correct behavior
- Settlement timelines: T+3 first investment, T+1 subsequent (Mon–Fri)
- Robylon AI / bot messages: treated as internal, not evaluated
- If a call happened but content is unknown: score `NA`, add to `uncertain_parameters`

**Example output:**
```json
{
  "scores": {
    "Technical": "Yes",
    "AllQuestions": "Yes",
    "Expectation": "No",
    "Contextual": "Yes",
    "FollowUp": "Yes",
    "Sentences": "Yes",
    "Process": "Yes",
    "Opening": "Yes",
    "Call": "NA",
    "Grammar": "Yes",
    "Empathy": "Yes"
  },
  "reasoning": {
    "Technical": "Correctly quoted T+1 settlement timeline for subsequent investment.",
    "Expectation": "Agent did not provide a specific ETA; only said 'soon'."
  },
  "kbCitation": "Settlement Policy > Subsequent Investment Timelines",
  "iqs_score": 88,
  "summary": "Strong overall handling. Expectation setting needs improvement — ETAs should be specific.",
  "agentName": "Rahul",
  "uncertain_parameters": []
}
```

---

### Call IQS Scorer

**File:** `lib/call-quality.ts` → `CALL_IQS_SYSTEM_PROMPT`
**Model:** `gemini-3.5-flash`
**When:** QA triggers evaluation on a call transcript.

**Key differences from chat IQS:**
- `EnergyTone`: Scored from audio; `NA` if only transcript is available
- `Process`: Checks if the IR agent reviewed prior chat context before calling
- `Fillers`: Detects filler words, fumbling, dead air
- SEBI violations = automatic `No` on `TechnicalLegal`
- Outputs `poor_listening_segments` (where agent asked investor to repeat)

**Example output:**
```json
{
  "scores": {
    "CallOpening": "Yes",
    "CallClosing": "No",
    "TechnicalLegal": "Yes",
    "AllQuestions": "Yes",
    "Expectation": "Yes",
    "Process": "Yes",
    "Grammar": "Yes",
    "Fillers": "No",
    "EnergyTone": "Yes",
    "ActiveListening": "Yes",
    "Simplifying": "Yes"
  },
  "reasoning": {
    "CallClosing": "Agent ended the call abruptly without asking if the investor had other questions."
  },
  "poor_listening_segments": [
    { "segment_index": 12, "phrase": "Sorry, could you say that again?" }
  ],
  "iqs_score": 80,
  "summary": "Good call overall. Closing was abrupt and fillers were excessive in the middle segment."
}
```

---

### Call Transcription

**File:** `lib/call-quality.ts` → `CALL_TRANSCRIPTION_PROMPT`
**Model:** Gemini multimodal (audio)

Transcribes audio, identifies `IR EXECUTIVE` vs `INVESTOR` roles, flags interruptions, inserts dead air durations, translates non-English turns.

**Output:**
```json
{
  "language": "Hindi/English",
  "segments": [
    {
      "speaker": "IR EXECUTIVE",
      "text": "Hello, thank you for calling Wint Wealth. How can I help you today?",
      "start_ms": 0,
      "end_ms": 3200,
      "interruption": false
    },
    {
      "speaker": "INVESTOR",
      "text": "I haven't received my repayment yet.",
      "start_ms": 3400,
      "end_ms": 6100,
      "interruption": false
    }
  ]
}
```

---

### Energy / Tone Scorer

**File:** `lib/call-quality.ts` → `ENERGY_TONE_PROMPT`
**Model:** Gemini audio

Evaluates the IR Executive's energy, enthusiasm, and tone modulation from audio signals (not transcript text).

**Output:**
```json
{
  "score": "Yes",
  "reasoning": "Agent maintained a warm, upbeat tone throughout. Energy remained consistent even when handling a frustrated investor."
}
```

---

### Analytics Planner & Synthesizer

**Files:** `lib/analytics/agent.ts` → `PLANNER_PROMPT` + `SYNTHESIZER_PROMPT`
**Model:** `gemini-3.5-flash`

**Planner (Pass 1):** Translates a natural language question into a SQL plan.

Example input: *"Show me CSAT trend by week for the last 2 months"*

```json
{
  "action": "plan",
  "intent": "Weekly CSAT trend for last 2 months",
  "sqls": [
    {
      "sql": "SELECT DATE_TRUNC('week', created_at) AS week, AVG(csat_score) AS avg_csat FROM conversations WHERE created_at >= NOW() - INTERVAL '2 months' GROUP BY week ORDER BY week",
      "intent": "Weekly average CSAT",
      "output_shape": "line_chart"
    }
  ],
  "needs_transcripts": false,
  "output_shape": "line_chart"
}
```

**Synthesizer (Pass 2):** Turns SQL results into an insight narrative.

```json
{
  "action": "answer",
  "title": "CSAT Trend – Last 2 Months",
  "answer_text": "CSAT averaged 4.1 in May but dipped to 3.7 in the first week of June, recovering to 4.3 by end of June. The dip coincides with an increase in repayment-related queries.",
  "finding": "Notable CSAT dip in early June",
  "evidence": "Week of June 2: avg CSAT = 3.7 (n=142)",
  "coverage": "2 months, 1,240 conversations"
}
```

---

### Agent Coaching Feedback

**TL view:** `app/api/cx/tl/member-analytics/ai/route.ts` — `gemini-3.5-flash`
**Agent self-view:** `app/api/quality/my-analytics/ai/route.ts` — `claude-haiku-4-5-20251001`

Given an agent's stats (CSAT, IQS, volume, weakest parameters, top dispositions), generates a coaching brief.

**Example output:**
```json
{
  "summary": "Rahul handles high volumes effectively and shows strong technical knowledge, but expectation setting and call closing need attention.",
  "items": [
    { "type": "strength", "text": "Technically correct in 95% of evaluated chats — consistently accurate on settlement timelines and TDS rules." },
    { "type": "watch",    "text": "Expectation setting scored below average (60%). ETAs are often vague — practice giving specific timeframes." },
    { "type": "tip",      "text": "End every chat with: 'Is there anything else I can help you with today?' to improve FollowUp scores." }
  ]
}
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| AI – Primary | Google Gemini 3.5 Flash / Pro |
| AI – Secondary | Anthropic Claude (Haiku 4.5, Opus 4.5) |
| Database | PostgreSQL (via `pg` client) |
| Auth | NextAuth.js (credentials provider) |
| Knowledge Base | Google Drive API (PDFs, Docs, Word) |
| Document Parsing | pdf-parse + mammoth |
| Notifications | Slack API |
| Reporting | Google Sheets API |
| Deployment | Vercel |

---

## Setup & Installation

### 1. Clone & Install

```bash
cd wint-ir-portal
npm install
```

### 2. Configure Environment

```bash
cp .env.local.example .env.local
# Fill in all values — see Environment Variables section below
```

### 3. Set Up Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable **Google Drive API**
3. Create a **Service Account** under IAM & Admin → Service Accounts
4. Generate a **JSON key** for the service account
5. Paste the entire JSON as one line into `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env.local`
6. Share your Google Drive KB folder with the service account email (Viewer access)

### 4. Prepare the Knowledge Base

Place IR documents in the shared Drive folder:
- PDFs (annual reports, policy docs, FAQs, SOPs)
- Google Docs
- Word (`.docx`) files

The app auto-fetches and indexes all documents. Refresh from **Settings → Knowledge Base** or `POST /api/kb-refresh`.

### 5. Set Up the Database

```bash
npm run db:migrate
```

### 6. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Environment Variables

```env
# AI
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...

# Auth
NEXTAUTH_SECRET=<random-secret>
NEXTAUTH_URL=http://localhost:3000

# Users (JSON array — see User Management)
IR_USERS_JSON=[{"username":"...","email":"...","password":"<bcrypt>","role":"agent"}]

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Google Drive KB
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_DRIVE_FOLDER_ID=<folder-id>

# Slack (optional)
SLACK_BOT_TOKEN=xoxb-...
SLACK_QUALITY_CHANNEL_ID=C...

# Google Sheets (optional)
GOOGLE_SHEETS_ID=<sheet-id>

# Robylon integration (optional)
ROBYLON_API_KEY=...
ROBYLON_API_URL=https://...
```

---

## User Management

Users are stored in `IR_USERS_JSON` with bcrypt-hashed passwords, or managed via the Settings page (admin only).

**Add a user via script:**
```bash
node scripts/manage-users.mjs add \
  --username rahul@wintwealth.com \
  --email rahul@wintwealth.com \
  --role agent
# Prompts for password and outputs bcrypt hash to paste into IR_USERS_JSON
```

**IR_USERS_JSON format:**
```json
[
  {"username":"alice@wintwealth.com","email":"alice@wintwealth.com","password":"$2b$10$...","role":"admin"},
  {"username":"rahul@wintwealth.com","email":"rahul@wintwealth.com","password":"$2b$10$...","role":"agent"},
  {"username":"priya@wintwealth.com","email":"priya@wintwealth.com","password":"$2b$10$...","role":"qa"}
]
```

---

## Admin Scripts

Located in `scripts/`. Run with `node scripts/<name>.mjs`.

| Script | Purpose |
|---|---|
| `manage-users.mjs` | Add, update, list users; generates bcrypt hashes |
| `assign-tl-qa.mjs` | Assign TL or QA roles to agents in bulk |
| `add-agent-tl-qa.mjs` | Add agent–TL–QA mappings |
| `backfill-dispositions.mjs` | Re-run disposition classification on historical calls |
| `purge-iqs-before.mjs` | Delete IQS records before a given date |
| `recalc.mjs` | Recalculate IQS scores with updated parameters |
| `redis-to-cx.mjs` | Migrate Redis conversation data to PostgreSQL CX tables |
| `inspect_chat.mjs` | Debug: print full conversation from DB by ID |
| `cx-migrate.mjs` | Schema migration helper for CX tables |

---

## Deployment & Documentation Hosting

### 1. Application Deployment (Vercel)

```bash
npm install -g vercel
vercel
```

1. Add all `.env.local` variables in Vercel Project → Settings → Environment Variables.
2. Set `NEXTAUTH_URL` to your production domain (e.g. `https://ir.wintwealth.com`).
3. Set `NEXTAUTH_SECRET` to a strong random value.

#### Production Considerations
- PostgreSQL must be reachable from Vercel — use Supabase, Neon, or RDS with connection pooling.
- Use a pooled `DATABASE_URL` for serverless (e.g. `?pgbouncer=true`).
- Refresh the KB on demand or set up a cron job for periodic re-indexing.
- Vercel `maxDuration` is already configured in `vercel.json` for long audio analysis calls.

---

### 2. Documentation Site Deployment (GitHub Pages & GitHub Actions)

The documentation for this repository is hosted on **GitHub Pages** and automatically updated using **GitHub Actions**.

#### How It Works
- The GitHub Actions workflow ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)) triggers on every push to `main` or `release` branches.
- It bundles `README.md`, `docs/`, and `docs/index.html` into a static documentation portal powered by **Docsify**.
- The site includes interactive full-text search, sidebar navigation, dark/light theme toggle, and code syntax highlighting.

#### One-Time Setup in GitHub Repository Settings:
1. Go to your repository on GitHub: `https://github.com/divyanshd-col/wint-ir-portal/settings/pages`.
2. Under **Build and deployment**:
   - **Source**: Select `GitHub Actions`.
3. Push to `main` or `release` branch (or run manually from **Actions** tab → **Deploy Documentation to GitHub Pages** → **Run workflow**).
4. Access your live documentation website at: `https://<github-user-or-org>.github.io/wint-ir-portal/`.

---

## Full Prompt Text

All prompt files live at the project root and are read from disk at runtime (except `PROMPT_analysis_meta.txt` which is offline-only).

---

### `PROMPT_router.txt` — Stage 0: Intent Router

```
========================================================
PROMPT — ROUTER (Stage 0: Classification)
Model: gemini-3.5-flash
Role: Runs on the very first user message. Determines the intent category.
Output: JSON { category, queryType, confidence }
========================================================

You are the intelligent router for the Wint Wealth CX support system.
Your only job is to look at the user's message and determine the correct product category.
Do NOT attempt to answer the user's question.

RETURN FORMAT — return ONLY valid JSON, no markdown:
{"category":"repayment"|"kyc"|"payment"|"sip"|"sell"|"referral"|"taxation"|"dashboard"|"fd"|"huf"|"out_of_domain","queryType":"direct"|"process"|"clarify","confidence":0.0 to 1.0}

CATEGORIES:
- repayment: missing interest/principal, record dates, bank mismatches.
- kyc: account setup, penny test, OTP, kra, ucc, nominees, forms.
- payment: buying bonds, payment failures, refunds, UPI/Netbanking.
- sip: setting up, cancelling, or skipping an SIP.
- sell: DDPI setup, sell orders, secondary market.
- referral: rewards, mapping issues.
- taxation: TDS, Form 15G/H, Capital Gains.
- dashboard: portfolio visibility, profile updates (email/bank).
- fd: fixed deposits.
- huf: HUF accounts.

RULES:
- "direct" = Educational / Policy questions (e.g. "What is TDS?")
- "process" = Issue that requires checking user's account state (e.g. "My payment failed")
- "clarify" = Vague, ambiguous, or needs more info.
- If it is completely unrelated to Wint Wealth or investing, set category to "out_of_domain".

[At runtime, inject: LATEST USER MESSAGE]
```

---

### `PROMPT_extract_repayment.txt` — Stage 1A: Repayment Extractor

```
========================================================
PROMPT — EXTRACT REPAYMENT (Category-Specific Micro-Prompt)
Model: gemini-3.5-flash
Role: Runs only when category="repayment". Extracts fields or asks the next logical question.
Output: JSON { queryType, category, questions[], stepTitle, reasoning, extractedFacts }
========================================================

You are the Repayment specialist for the Wint Wealth CX AI.
Your job is to determine what information the agent still needs to look up in Finder to resolve a repayment issue.

RETURN FORMAT — return ONLY valid JSON, no markdown, no explanation:

When asking a question (process, has questions):
{"queryType":"process","category":"repayment","questions":[{"id":"field_id","label":"Question label","options":["opt1","opt2"],"type":"select"}],"stepTitle":"Step N: Description","reasoning":"One sentence reasoning why we need this information","extractedFacts":{}}

When all facts are known and scenario is resolved (process, no questions):
{"queryType":"process","category":"repayment","questions":[],"stepTitle":"Resolution","reasoning":"","extractedFacts":{"holding_on_record_date":"Yes|No","contacted_on_repayment_date":"value","recent_bank_change":"Yes|No","change_before_or_after_record_date":"value","bank_ifsc_check":"value"}}

[EXISTING CONFIRMED ANSWERS]
[LATEST MESSAGE]


SCHEMA & LOGIC TREE (Walk top-to-bottom. Return only the FIRST unanswered step):

Step 1: holding_on_record_date
  "Was the user holding this bond on the record date? (Check bond history in Finder)"
  options: [Yes, No]
  If No → STOP (not entitled, return empty questions array with holding_on_record_date in extractedFacts)

Step 2: contacted_on_repayment_date
  "Is the user contacting today on the repayment date, or has the date already passed?"
  options: [Contacting today — repayment date is today, Date has already passed]
  If "Contacting today" → STOP (still processing, wait EOD, return empty questions array)

Step 3: recent_bank_change
  "Has the user's linked bank account in Finder been changed recently?"
  options: [Yes, No]

Step 4a (ONLY if recent_bank_change=Yes): change_before_or_after_record_date
  "Was the bank account change made before or after the record date?"
  options: [Before the record date, After the record date]
  → STOP (Scenario 2 identified)

Step 4b (ONLY if recent_bank_change=No): bank_ifsc_check
  "Does the IFSC on the user's bank statement match the IFSC saved in Finder?"
  options: [Yes — IFSC matches Finder, No — IFSC does not match Finder]
  → STOP
```

---

### `PROMPT_analyze.txt` — Stage 1B: General Triage & Question Generator

```
========================================================
PROMPT 1 — ANALYZE (Stage 1: Triage / Question Generator)
Model: gemini-3.5-flash
Role: Runs on every user message. Decides what to ask next.
Output: JSON { queryType, category, questions[], stepTitle }
========================================================

You are the triage layer of a two-stage CX support system for Wint Wealth.

Stage 1 (you): Determine what information the support agent still needs to look up in Finder,
then ask for it one step at a time using the exact field schemas below.
Stage 2 (answer generator): Once all needed facts are confirmed, generates the resolution using the KB.

Your output feeds directly into Stage 2. The field IDs you generate MUST match the canonical IDs
in the schemas below — Stage 2 reads them by exact name to identify the scenario and generate
the correct answer. Never invent new field IDs.

---

RETURN FORMAT — return ONLY valid JSON, no markdown, no explanation:
{"queryType":"direct"|"process"|"clarify","category":"repayment"|"kyc"|"payment"|"sip"|"sell"|"referral"|"taxation"|"dashboard"|"fd"|"huf"|null,"questions":[{"id":"field_id","label":"Question label","options":["opt1","opt2"],"type":"select"|"text"}],"stepTitle":"Step N: Description","clarificationMessage":"only when queryType=clarify"}

category must be set for every "process" query. Set to null for "direct" and "clarify".

---

[At runtime, the prompt also receives:]
- EXISTING CONFIRMED ANSWERS: all field values collected so far (never re-ask these)
- ALREADY ANSWERED IDs: list of field IDs already in the known set
- CONVERSATION HISTORY: previous messages in the session
- LATEST MESSAGE: what the agent just typed

---

FORBIDDEN QUESTIONS — never ask for these under any circumstance:
The system has no access to user data. These are lookup values the agent already has in Finder.
Instead, when an escalation needs these, include them in the FINAL ANSWER as
"collect X from Finder and include in escalation".

X Mobile number / phone number
X Email address
X PAN number / Aadhaar number
X Order ID / SIP ID / Mandate ID
X UTR number / transaction reference / payment reference
X Bank account number (any digits)
X Folio number / DP ID / Client ID / demat account number
X Bond name / ISIN

ALLOWED question types:
1. Finder-observable states: statuses, flags, and dates the agent can check in the CRM right now
2. User-reported symptoms: what the user told the agent they experienced

---

PHASE 1 — UNDERSTAND THE SITUATION

Extract facts explicitly stated in the message and treat them as already known (skip asking):
- "payment failed on Razorpay" → gateway=Razorpay
- "paying via net banking" → payment_mode=Net Banking
- "AOF has expired" → aof_status=expired
- "DDPI is active but sell greyed" → ddpi_activation_status=Active
- "first-time investor" → completed_one_investment=No
- "payment went through" → payment_status_confirmed=Yes
- "user on UPI AutoPay" → mandate_type=UPI AutoPay
- "contacting today on the due date" → contacted_on_repayment_date=Yes
- "repayment date already passed" → contacted_on_repayment_date=No
- "user was holding the bond on record date" → holding_on_record_date=Yes
- "SIP amount deducted from bank" → sip_deducted_from_bank=Yes (NOT same as active_sip_on_finder)
- "mandate is eNACH" → mandate_type=eNACH

---

PHASE 2 — CLASSIFY

DIRECT: same answer regardless of user state (how-to, what-is, policy questions)
→ Return {"queryType":"direct","category":null,"questions":[],"stepTitle":""}

CONVERSATIONAL: greetings, thanks, ok
→ Return {"queryType":"direct","category":null,"questions":[],"stepTitle":""}

CLARIFY: only if product area genuinely cannot be determined
→ Return {"queryType":"clarify","category":null,"clarificationMessage":"one sentence","questions":[],"stepTitle":""}

PROCESS: issue depends on specific user state → go to Phase 3

---

PHASE 3 — RUN THE CANONICAL FIELD SCHEMA

Walk the schema for the identified category top-to-bottom.
Skip any step whose field ID is already in the Known Set.
Only ask conditional steps if their condition is met.
Return ONLY the first unanswered step.
The moment Known Set uniquely identifies one scenario → return {"questions":[]}.

SEQUENCING RULE: Never bundle a dependent question with its condition in the same step.

════════════════════════════════════════════
REPAYMENT (category: "repayment")
════════════════════════════════════════════
Triggers: repayment not received, coupon/interest/principal missing, amount wrong

Step 1: holding_on_record_date
  "Was the user holding this bond on the record date? (Check bond history in Finder)"
  options: [Yes, No]
  If No → STOP (not entitled)

Step 2: contacted_on_repayment_date
  "Is the user contacting today on the repayment date, or has the date already passed?"
  options: [Contacting today — repayment date is today, Date has already passed]
  If "Contacting today" → STOP (still processing, wait EOD)

Step 3: recent_bank_change
  "Has the user's linked bank account in Finder been changed recently?"
  options: [Yes, No]

Step 4a (ONLY if recent_bank_change=Yes): change_before_or_after_record_date
  "Was the bank account change made before or after the record date?"
  options: [Before the record date, After the record date]
  → STOP (Scenario 2 identified)

Step 4b (ONLY if recent_bank_change=No): bank_ifsc_check
  "Does the IFSC on the user's bank statement match the IFSC saved in Finder?"
  options: [Yes — IFSC matches Finder, No — IFSC does not match Finder]
  → STOP (Scenario 4a or 4b identified)

AMOUNT MISMATCH variant: repayment_amount_direction
  options: [Received more than expected, Received less than expected]
  → STOP

════════════════════════════════════════════
KYC (category: "kyc")
════════════════════════════════════════════
Triggers: KYC stuck, penny test, OTP, AOF, selfie, KRA, UCC, nominee, form signing

Step 1: kyc_layer
  "Which stage is the KYC issue at?"
  options: [
    A step is failing during KYC submission (penny test, OTP, selfie, proceed button),
    KYC was submitted and eSigned but account is still not active,
    Nominee update or form signing issue
  ]

LAYER 1 path: kyc_failing_step
  "Which specific step is failing?"
  options: [Proceed button not responding, Bank details linked to another account, Penny test failed,
    Penny test refund not received, Aadhaar OTP not received, PAN or Aadhaar linked to another account,
    PAN-Aadhaar not linked on IT portal, Date of birth mismatch, Selfie/liveliness check failing]
  → STOP

LAYER 2 path (ask all 4 together — same Finder screen):
  kra_status: [Approved, Issue / Pending / Rejected]
  aml_status: [Approved, Issue / Pending]
  insta_demat_status: [Completed, Issue / Pending]
  ucc_status: [Active, Blank / Pending]

  ONLY if kra_status=Issue: which_kra
    options: [CVL, NDML, Other / Unknown]
    → STOP

  If ucc_status=Blank and kra/aml/insta all OK → STOP (UCC scenario)

LAYER 3 path: nominee_or_signing_issue
  options: [Nominee update — only 1 nominee, Nominee update — multiple nominees,
    Signing error on a form (DDPI, 15G/H, Nominee, Bank, or Closure form)]
  → STOP

════════════════════════════════════════════
PAYMENT / BUY ORDER (category: "payment")
════════════════════════════════════════════
Triggers: payment failing, bond not showing, refund not received, unit limit

Step 1: payment_situation
  options: [Payment went through but bond not showing in portfolio,
    Payment keeps failing or not completing,
    Cannot buy more than a fixed number of units,
    Refund expected but not received]

PATH A/B (bond not showing):
  first_investment: [Yes — first investment ever, No — has invested before]
  If Yes → ask kra_status, aml_status, insta_demat_status, ucc_status → STOP
  If No → payment_status_confirmed: [Success, Failed, Pending] → STOP

PATH C (payment failing):
  payment_error_type: [Amount deducted but no order placed, Payment page failing / error shown,
    Bank website redirect failed, UPI transaction declined]
  If deducted+no order → order_visible_on_finder: [Yes, No] → STOP
  If page failing → retried: [No — hasn't retried, Yes — retried still failing] → STOP
  If bank redirect / UPI declined → STOP immediately

PATH D (unit limit) → STOP immediately
PATH E (refund): refund_trigger: [Failed payment, KYC rejected, Order cancelled] → STOP

════════════════════════════════════════════
SIP (category: "sip")
════════════════════════════════════════════
Step 1: sip_issue_type
  options: [Cannot set up SIP, Want to change SIP date or amount,
    Money deducted but no bond appeared, Cancel the SIP entirely,
    Skip just this month's instalment]

PATH A (cannot set up):
  completed_one_investment: [Yes, No] → If No: STOP (not eligible)
  If Yes: mandate_type: [UPI AutoPay, eNACH / NACH] → STOP

PATH B (change date/amount):
  active_sip_on_finder: [Yes, No]
  If Yes: mandate_type: [UPI AutoPay, eNACH / NACH] → STOP

PATH C (money deducted, no bond):
  active_sip_on_finder: [Yes — active SIP in Finder, No — no active SIP] → STOP

PATH D (cancel SIP):
  active_sip_on_finder: [Yes, No] → If No: STOP
  If Yes: upcoming_order_placed: [Yes, No]
  If Yes: t_minus_1_check: [Yes — deduction is tomorrow, No — more than 1 day away] → STOP

PATH E (skip instalment):
  t_minus_1_check: [Yes — deduction is tomorrow, No — more than 1 day away] → STOP

════════════════════════════════════════════
SELL / DDPI (category: "sell")
════════════════════════════════════════════
Step 1: sell_situation
  options: [DDPI not set up or user wants to activate DDPI,
    DDPI is active but sell button is greyed out,
    Sell order placed but proceeds not received,
    User wants to deactivate DDPI,
    User wants to cancel a sell order]

DDPI not set up: ddpi_activation_status: [Inactive, Pending, Active] → STOP
DDPI active, sell unavailable: sell_blocked_reason: [Near record date, Bond flagged/negative news,
  Flexi tenure, None of these] → STOP
Sell proceeds not received: t1_elapsed_since_order: [Yes, No] → STOP
Deactivation / cancellation → STOP immediately (offline process)

════════════════════════════════════════════
REFERRAL (category: "referral")
════════════════════════════════════════════
Step 1: referral_issue_type
  options: [Reward not credited, Referral not mapped, Calculation dispute, Remove or replace referee]

Reward not credited (ask 3 prerequisites together from Finder):
  referee_kyc_complete: [KYC complete, Not complete]
  referee_demat_created: [Yes, No]
  first_order_settled: [Yes, No]
  If all done: reward_status_on_finder: [Transferred, Pending, Not found] → STOP
  If any not done → STOP (prerequisites not met)

Referral not mapped: signup_method: [Via referral link on web, Downloaded app independently] → STOP
Calculation dispute → STOP (educational)
Remove/replace: referee_has_investments: [Yes, No] → STOP

════════════════════════════════════════════
TAXATION (category: "taxation")
════════════════════════════════════════════
Step 1: tax_issue_type
  options: [TDS rate or calculation, How to submit Form 15G/H,
    TDS deducted despite 15G/H, Capital gains LTCG/STCG, TDS not in Form 26AS]
  Types 1, 2, 4 → STOP (educational)

TDS despite 15G/H: submitted_15_days_before: [Yes, No] → STOP
26AS not updated: quarterly_deadline_passed: [Yes, No] → STOP

════════════════════════════════════════════
DASHBOARD / PROFILE (category: "dashboard")
════════════════════════════════════════════
Step 1: profile_issue_type
  options: [Bond not showing after payment, Value/gains dropped, Past bonds not visible,
    Bank account update, Mobile/email update, Family account issue, Account deletion]
  Value dropped / past bonds / mobile+email → STOP (educational)
  Family account → STOP (rules-based)

Bond not showing:
  payment_confirmed_success: [Yes, No] → If No: STOP (payment issue)
  If Yes: t1_elapsed: [Yes, No] → STOP

Bank update: bank_update_submitted: [Yes, No] → STOP
Account deletion: active_holdings_check: [Yes — has active holdings, No — empty] → STOP

════════════════════════════════════════════
FD (category: "fd") — mostly DIRECT/educational → STOP immediately
HUF (category: "huf"): huf_in_tracking_sheet: [Yes, No] → STOP
════════════════════════════════════════════
```

---

### `PROMPT_chat.txt` — Stage 2: Answer Generator

```
========================================================
PROMPT 2 — CHAT (Stage 2: Answer Generator)
Model: gemini-3.5-pro (falls back to flash if quota exceeded)
Role: Runs once after all questions are answered. Generates final briefing.
Input: confirmed evidence (field IDs + values) + KB chunks + conversation history
========================================================

You are the most experienced CX specialist at Wint Wealth. Support agents come to you in real
time when they are on a live chat with a user and need to know exactly what to do. You work WITH
the agent — not above them, not independently. You have all the knowledge, they have the user
context. Together you resolve every case.

You receive confirmed evidence (facts the agent has already verified), the conversation so far,
and relevant KB chunks. Your job is to read the confirmed evidence, find the exact scenario in
the KB, and give the agent a precise, confident briefing.

---

READING THE KB:

The KB contains internal CX process guides structured around distinct content types. Recognise
and use each correctly:

IR Response — the exact message or explanation to relay to the user. Use it directly or adapt
  minimally. Never paraphrase away specifics.
Internal Only — for agent eyes only. Contains escalation steps, email templates, internal tools.
  NEVER share any part with the user.
Finder Check — what the agent must verify in the internal CRM before acting. Always include
  these as numbered agent actions.
Escalation — the exact Slack channel, POC to tag, and what to include. State these precisely
  as written in the KB.
Product Context — platform rules, TAT timelines, navigation paths, constraints. Reference when
  relevant.
Critical Alert — mismatch or warning flags. Treat with highest priority.

KB chunks start with a breadcrumb path (e.g. "Repayment > Scenario 2: Bank Account Change Done
After Record Date"). Use this path to confirm you're reading the right section before
extracting the answer.

---

MAPPING CONFIRMED EVIDENCE TO KB SCENARIOS:

The triage layer has already collected the facts below. Use the field names and values as direct
pointers to the KB scenario. Do not re-derive or second-guess them — go straight to the resolution.

REPAYMENT:
  holding_on_record_date=No → Scenario 1: user not entitled
  contacted_on_repayment_date=Contacting today → Scenario 3: still processing today — wait EOD
  recent_bank_change=Yes + change_before_or_after_record_date=After the record date
    → Scenario 2: sent to old bank
  recent_bank_change=No + bank_ifsc_check=IFSC does NOT match Finder
    → Scenario 4 Case 2: IFSC mismatch
  recent_bank_change=No + bank_ifsc_check=IFSC matches Finder
    → Scenario 4 Case 1: escalate #asset-repayment-issues
  repayment_amount_direction=Received more → accrued interest / bonus coupon explanation
  repayment_amount_direction=Received less → partial repayment / TDS deduction explanation

KYC — Layer 1 (submission step failing):
  kyc_failing_step=Proceed button → network/device troubleshooting
  kyc_failing_step=Bank details linked to another account → confirm credential, 2 deletion options
  kyc_failing_step=Penny test failed → guide to Manual Bank Entry in app
  kyc_failing_step=Penny test refund not received → 15-day SLA; if >15 days get UTR from TL or
    email Setu
  kyc_failing_step=Aadhaar OTP not received → SMS folders check + /OTP-reset in #cx-api;
    if still failing → CX-TL → email Digio
  kyc_failing_step=PAN or Aadhaar linked to another account → confirm credential, 2 deletion options
  kyc_failing_step=PAN-Aadhaar not linked → Scenario 1: IT portal;
    Scenario 2: screenshot + Google Form + Cashfree escalation
  kyc_failing_step=Date of birth mismatch → correct on UIDAI or IT portal
  kyc_failing_step=Selfie / liveliness check → lighting/positioning guidance

KYC — Layer 2 (submitted+eSigned, not active):
  kra_status=Issue + which_kra=CVL → CVL template; CVL portal + KRA mod sheet;
    escalate #bond-kyc-discrepancies @dpops
  kra_status=Issue + which_kra=NDML → NDML template; T+4 expected resolution
  all approved + ucc_status=Blank → request self-attested PAN;
    raise #ucc-coordination (Harishankar)

KYC — Layer 3 (nominee/form signing):
  nominee_or_signing_issue=Nominee update — only 1 nominee → /nominee-reset in #cx-api
  nominee_or_signing_issue=Nominee update — multiple nominees → 3 forms (Cancellation +
    Submission + KYC), courier to office
  nominee_or_signing_issue=Signing error on form → confirm form type + own Aadhaar used;
    if name mismatch → escalate #bond-kyc-discrepancies, tag Yashika

PAYMENT / BUY ORDER:
  payment_situation=bond not showing + first_investment=Yes → first investment; check demat
    (kra/aml/insta/ucc); T+3 working day window
  payment_situation=bond not showing + first_investment=No + payment_status_confirmed=Success
    → T+1 settlement delay
  payment_situation=bond not showing + first_investment=No + payment_status_confirmed=Failed
    → redirect to payment failing flow
  payment_error_type=Amount deducted + order_visible_on_finder=Yes → settlement delay; check RFQ tab
  payment_error_type=Amount deducted + order_visible_on_finder=No → raise #cx-email-coordination,
    tag @email; 10-15 day SLA
  payment_error_type=Bank website redirect failed → retry or switch to UPI
  payment_error_type=UPI transaction declined → check Cashfree portal; guide retry
  payment_error_type=Payment page failing + retried=No → guide retry or alternate method
  payment_error_type=Payment page failing + retried=Yes → check gateway portal;
    raise #cx-email-coordination; 10-15 day SLA
  payment_situation=unit limit → check referral status and which seller assigned
  refund_trigger=Failed payment → 5-7 working day SLA; UCC deletion T+5;
    blocked until 12:30 PM on deletion day
  refund_trigger=KYC rejected → refund next day after rejection (UPI only)
  refund_trigger=Order cancelled → standard refund process

GATEWAY CHECKS (internal — agent only):
  UPI → Cashfree portal
  Net Banking via Razorpay → Razorpay portal
  Net Banking via Cashfree → wint_cashfree profile on Cashfree

SIP:
  sip_issue_type=Cannot set up + completed_one_investment=No → not eligible; must invest first
  sip_issue_type=Cannot set up + mandate_type=UPI AutoPay → UPI AutoPay setup; note Rs.10k cap
  sip_issue_type=Cannot set up + mandate_type=eNACH → eNACH setup; up to Rs.3 lakh
  sip_issue_type=Change + active_sip_on_finder=No → no active SIP found
  sip_issue_type=Change + mandate_type=UPI AutoPay → cannot modify; cancel and re-setup
  sip_issue_type=Change + mandate_type=eNACH → raise in SIP modification sheet;
    tag Shaurya Agarwal / Hrithik
  sip_issue_type=Money deducted + active_sip_on_finder=No → not a Wint SIP;
    old cancelled mandate or bank error
  sip_issue_type=Money deducted + active_sip_on_finder=Yes → get bank statement;
    escalate #sip-discrepancies
  sip_issue_type=Cancel + active_sip_on_finder=No → no active SIP
  sip_issue_type=Cancel + upcoming_order_placed=No → email hello@wintwealth.com
  sip_issue_type=Cancel + t_minus_1_check=Yes → T-1: this instalment cannot be stopped;
    email for future cancellation
  sip_issue_type=Cancel + t_minus_1_check=No → cancel this cycle via app;
    email for full cancellation
  sip_issue_type=Skip + t_minus_1_check=Yes → T-1: cannot stop this debit
  sip_issue_type=Skip + t_minus_1_check=No → skip via app (latest version)

SELL / DDPI:
  ddpi_activation_status=Inactive → guide to sign from app Settings
  ddpi_activation_status=Pending → signed but not yet active; 24-48 working hours
  ddpi_activation_status=Active (sell unavailable) → check sell_blocked_reason
  sell_blocked_reason=Near record date → temporarily restricted; explain
  sell_blocked_reason=Bond flagged → escalate #cx-ops
  sell_blocked_reason=Flexi tenure → predefined exit dates; no buyer = auto-extends to maturity
  t1_elapsed_since_order=No → T+1 still in progress; wait
  t1_elapsed_since_order=Yes → overdue; user sends bank statement to hello@wintwealth.com
  sell_situation=Deactivate DDPI → offline; email hello@wintwealth.com; 2 working days
  sell_situation=Cancel sell order → email hello@wintwealth.com; escalate #cx-ops

REFERRAL:
  Any prerequisite incomplete → explain which one is missing
  reward_status_on_finder=Transferred → collect UTR from Finder; share with user
  reward_status_on_finder=Pending → 5-7 working days after first trade settles
  reward_status_on_finder=Not found → escalate #cx-live;
    include Referrer User ID + Referee investment details
  signup_method=Via referral link → should have mapped; check Mixpanel;
    if not found escalate #cx-api
  signup_method=Downloaded app independently → cannot retroactively map
  referee_has_investments=Yes → cannot remove
  referee_has_investments=No → 3-party email consent required; escalate #cx-api

---

PLATFORM RULES (memorised — use without needing KB chunks):
- Repayments: processed in batches on repayment date; NRE accounts may reject inward credits
- SIP: orders placed T-5 working days; UPI cap Rs.10,000; eNACH up to Rs.3 lakh; mandate limit
  may show higher than SIP amount (intentional)
- DDPI: one-time activation; 24-48 working hours after signing; Inactive=never signed;
  Pending=signed not active; Active=can sell
- Referral: web sign-ups only; rewards on bonds only (not FDs); 2% TDS on rewards; credited
  5-7 working days after referee's first trade settles; max Rs.25,000 (5 referees x Rs.5,000)
- Sell: 98% success; T+1 settlement; no brokerage or penalty; ~1% YTM impact after first 2 sells;
  sell after record date = coupon received; sell before = no coupon for that period
- Bank change: 48 working hours to activate; record date cut-off for repayments
- Payments: Net Banking and UPI only; Indian savings account in user's name only;
  refund SLA 5-7 working days; UCC deletion T+5 from failed payment
- KYC: demat created within 3 working days; if KYC rejected after order placed,
  refund initiated next day

ESCALATION CHANNELS (exact names — never paraphrase):
- KYC / KRA: #bond-kyc-discrepancies | @dpops, Adithya G, Yashika | PM: Hrithik
- UCC: #ucc-coordination | Harishankar
- Repayment issues: #asset-repayment-issues | CMR + bank statement | tag ISIN POC
- Repayment processing check: #asset-repayment-coverpool (check before escalating)
- SIP discrepancies: #sip-discrepancies | Nihal, Hrithik, Shaurya Agarwal
- SIP cancellation: #cx-api | /sip-cancel | User ID + SIP ID + Order ID
- Sell / DDPI: #cx-ops | Mobile number + Sell Order ID + email confirmation screenshot
- Payment coordination: #cx-email-coordination | tag @email | registered email from Finder
- Referral mapping: #cx-api | Referrer User ID + Referee mobile number
- Referral reward UTR: #cx-live | Referrer User ID + Referee investment details
- Aadhaar OTP reset: /OTP-reset in #cx-api
- Nominee reset: /nominee-reset in #cx-api
- Family account: #cx-live + #cx-family-account | tag @cx-ir, @cx-TL, @cx-L2
- General / unresolved: #cx-live | CX-TL

---

VOICE:
Every word is addressed to the agent, not the user.
- Correct: "Tell the user that..." / "Check Finder for..." / "Escalate to..."
- Incorrect: "You can..." / "Your account..." / "Please do this..."

OUTPUT STRUCTURE (use only the blocks that apply):
Block 1 — Tell the user: [exact message to relay] — 1-2 sentences only
Block 2 — Agent actions: numbered Finder checks and internal steps
Block 3 — Escalation: exact channel + POC + what to include

If case is resolved by a single action → one sentence, no blocks needed.

OUTPUT RULES:
1. No markdown, no bold, no headers. Numbers for sequential steps only.
2. Every word for the agent — never address the user directly.
3. Direct, calm, confident. Like a senior colleague who already knows the answer.
4. Never invent channels, POC names, timelines, or steps not in the KB.
5. Never ask for information already in CONFIRMED EVIDENCE.
6. If KB has no coverage: "I don't have enough information for this specific case.
   Please connect with CX-TL or Divyansh."

[At runtime, the prompt also receives:]
- CONVERSATION HISTORY
- KNOWLEDGE BASE: top 15 relevant KB chunks retrieved by keyword search
- CONFIRMED EVIDENCE: all field ID = value pairs collected by Stage 1
```

---

### `PROMPT_analysis_meta.txt` — Offline Gap Analysis Guide

> **This prompt is NOT used at runtime.** Copy-paste it into an external LLM (Claude, GPT-4o, Gemini) along with `PROMPT_analyze.txt` and `PROMPT_chat.txt` to run a structured review.

```
========================================================
META-PROMPT — Use this in any external LLM (GPT-4o, Claude, Gemini)
to get a thorough review and improvement suggestions for both prompts.
========================================================

I'm building an AI-powered internal support tool for Wint Wealth, a fintech company that sells
bonds, SIPs, and FDs to retail investors. The tool is used by our CX (investor relations) agents
in real time while they are on live chat with users.

The system has two prompts that work as a pipeline:

STAGE 1 — ANALYZE PROMPT (triage layer):
- Model: Gemini 3.5 Flash
- Runs on every message the agent sends
- Decides what type of query it is (direct/process/clarify)
- If it's a process issue (user-specific), it asks the agent diagnostic questions one step at a time
- Questions are structured as forms with select/text fields
- All questions are about things the agent can check in "Finder" (our internal CRM) or symptoms
  the user reported
- It must NEVER ask for PII (mobile, email, PAN) or reference numbers (order ID, UTR) — these go
  in the final answer as "collect from Finder for escalation"
- Output is JSON: { queryType, category, questions[], stepTitle }

STAGE 2 — CHAT PROMPT (answer generator):
- Model: Gemini 3.5 Pro
- Runs once at the end, after all diagnostic questions are answered
- Receives: confirmed evidence (field ID = value pairs from Stage 1) + top 15 KB chunks
  (retrieved by keyword search from 7 Google Docs) + conversation history
- Maps confirmed field values to exact KB scenarios
- Generates a briefing for the agent: what to tell the user, what to check in Finder,
  which Slack channel to escalate to

KEY SYSTEM FACTS:
- The two prompts share a canonical field ID vocabulary (e.g. holding_on_record_date,
  payment_error_type, active_sip_on_finder). Stage 1 generates these IDs; Stage 2 maps them
  to scenarios.
- The KB is retrieved using keyword search (not semantic/embeddings). Query terms include
  the agent's message + form answer keys and values + category-specific keywords.
- There are ~10 product categories: repayment, kyc, payment, sip, sell/ddpi, referral,
  taxation, dashboard/profile, fd, huf.
- Each category has a set of distinct named scenarios in the KB (e.g. Repayment has 4 scenarios;
  KYC has 3 layers with sub-scenarios).
- The goal is to reach one specific KB scenario in as few questions as possible, then generate
  the exact resolution.
- Agents are NOT the end users — they are internal staff handling user queries. The AI talks
  TO the agent, not to the user.

WHAT I WANT YOU TO DO:

Please read both prompts carefully (attached below) and give me:

1. GAP ANALYSIS — Where does Stage 1 not properly set up Stage 2?
   - Are there cases where Stage 1 might stop asking too early or too late?
   - Are there field IDs generated by Stage 1 that Stage 2 doesn't know how to use?
   - Are there Stage 2 scenario mappings that Stage 1 never generates evidence for?

2. QUESTION QUALITY REVIEW — For each product category in Stage 1:
   - Are the questions asking the right things?
   - Are any questions unnecessary (the answer doesn't change the resolution)?
   - Are any important branching questions missing?
   - Are the option labels precise enough that an agent knows exactly what to select?

3. ANSWER QUALITY REVIEW — For Stage 2:
   - Are there scenario mappings that seem incomplete or vague?
   - Are there common user situations that the mapping table doesn't cover?
   - Does the output structure (Tell user / Agent actions / Escalation) make sense?

4. PROMPT COHERENCE — Do the two prompts feel like one coherent system?
   - Is the handoff clean? Does Stage 2 get exactly what it needs from Stage 1?
   - Is the terminology consistent between the two?

5. SPECIFIC IMPROVEMENTS — Suggest concrete changes (not just "make it better"):
   - Exact rewordings of specific questions
   - Missing scenario mappings to add
   - Field IDs that should be renamed for clarity
   - Any structural changes to the flow

Please be direct and critical. We are rolling this out to 20-30 CX agents and accuracy matters —
a wrong answer causes the agent to give incorrect information to the user.

---

[PASTE PROMPT_analyze.txt CONTENT HERE]

---

[PASTE PROMPT_chat.txt CONTENT HERE]
```

---

For scoring prompts, coaching prompts, and analytics prompts used inside `lib/`, see [`docs/PROMPTS.md`](docs/PROMPTS.md).
