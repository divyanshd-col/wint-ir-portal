# Wint Wealth IR Portal — Prompts Documentation

This document inventories and details **every system and agent prompt** used across the Wint Wealth IR Portal codebase. The portal uses Gemini and Claude models to power live triage pipelines, quality scoring engines (chat & call), analytics tools, and performance coaching.

> **Last updated:** 2026-07-06

---

## Table of Contents
1. [Customer Chat Pipeline (Stage 0–2)](#1-customer-chat-pipeline-stage-02)
2. [Chat Draft Generator](#2-chat-draft-generator)
3. [Quality Evaluator (IQS) Scoring Prompts](#3-quality-evaluator-iqs-scoring-prompts)
4. [Audio & Call Analytics Prompts](#4-audio--call-analytics-prompts)
5. [Analytics Agent & Text-to-SQL Prompts](#5-analytics-agent--text-to-sql-prompts)
6. [Agent Coaching & Feedback Prompts](#6-agent-coaching--feedback-prompts)
7. [Pipeline Meta-Prompt (Offline Review)](#7-pipeline-meta-prompt-offline-review)

---

## 1. Customer Chat Pipeline (Stage 0–2)

These prompts work in sequence to power the real-time helper chat for Investor Relations (IR) agents. Stages run in order on every incoming agent message.

---

### Stage 0 — Router (Intent Classifier)

| Attribute | Detail |
|---|---|
| **Variable / File** | `PROMPT_router.txt` (read from disk at runtime) |
| **Runtime usage** | `app/api/chat/analyze/route.ts` L393 |
| **Model** | `gemini-3.5-flash` |
| **Trigger** | Runs on the very first user message only |

**Purpose:** Determines product category and query type before Stage 1. Returns a classification so the correct category-specific prompt schema can be loaded.

**Output format:**
```json
{
  "category": "repayment|kyc|payment|sip|sell|referral|taxation|dashboard|fd|huf|out_of_domain",
  "queryType": "direct|process|clarify",
  "confidence": 0.0
}
```

**Query type rules:**
- `direct` — Educational / policy questions (e.g. "What is TDS?")
- `process` — Issue requiring account-level lookup (e.g. "My payment failed")
- `clarify` — Vague or ambiguous input needing more context
- `out_of_domain` — Unrelated to Wint Wealth or investing

---

### Stage 1A — Repayment Extractor (Category Micro-Prompt)

| Attribute | Detail |
|---|---|
| **Variable / File** | `PROMPT_extract_repayment.txt` (read from disk at runtime) |
| **Runtime usage** | `app/api/chat/analyze/route.ts` L469 |
| **Model** | `gemini-3.5-flash` |
| **Trigger** | Only when `category = "repayment"` |

**Purpose:** Category-specific micro-prompt that walks a strict decision tree for repayment issues. Determines what information the agent still needs from Finder before resolving. Returns either the next question to ask OR a resolved facts payload if all steps are complete.

**Decision tree:**
1. Was the user holding the bond on the record date? (If No → stop)
2. Is the user contacting on the repayment date itself or after? (If today → stop, still processing)
3. Has the linked bank account in Finder been changed recently?
   - Yes → Ask when the change was made relative to the record date → stop (Scenario 2)
   - No → Ask if the IFSC on the bank statement matches Finder → stop

**Output format (resolved):**
```json
{
  "queryType": "process",
  "category": "repayment",
  "questions": [],
  "stepTitle": "Resolution",
  "reasoning": "",
  "extractedFacts": {
    "holding_on_record_date": "Yes|No",
    "contacted_on_repayment_date": "...",
    "recent_bank_change": "Yes|No",
    "change_before_or_after_record_date": "...",
    "bank_ifsc_check": "..."
  }
}
```

---

### Stage 1B — Triage & Question Generator (General)

| Attribute | Detail |
|---|---|
| **Variable** | `analyzePrompt` |
| **Source template** | `PROMPT_analyze.txt` |
| **Runtime route** | `app/api/chat/analyze/route.ts` L35 |
| **Model** | `gemini-3.5-flash` |

**Purpose:** Runs for all non-repayment categories (or as fallback). Determines query type and, for `process` queries, walks a canonical field schema across **10 categories** (Repayment, KYC, Payment, SIP, Sell/DDPI, Referral, Taxation, Dashboard, FD, HUF). Generates structured JSON to collect facts one at a time. Also automatically extracts facts from attached screenshots.

**Output format:**
```json
{
  "queryType": "direct|process|clarify",
  "category": "repayment|kyc|payment|sip|sell|referral|taxation|dashboard|fd|huf|null",
  "questions": [
    { "id": "canonical_field_id", "label": "Question label", "options": ["opt1"], "type": "select|text" }
  ],
  "stepTitle": "Step N: Description",
  "reasoning": "Contextual reason for this question",
  "extractedFacts": { "field_id": "value" }
}
```

---

### Stage 2 — Answer Generator (Chat Assistant)

| Attribute | Detail |
|---|---|
| **Variable** | `DEFAULT_CHAT_PROCESS_PROMPT` |
| **Source template** | `PROMPT_chat.txt` |
| **Runtime route** | `app/api/chat/route.ts` L11 |
| **Model** | `gemini-3.5-pro` (falls back to `gemini-3.5-flash`) |

**Purpose:** Executes once Stage 1 has collected all necessary facts. Takes confirmed facts, conversation history, and the top 15 retrieved Knowledge Base (KB) chunks. Maps facts to precise scenarios in the KB and generates an internal agent briefing.

**Output format (plain text):**
```
Block 1 — Tell the user: [exact message to relay] — 1-2 sentences only
Block 2 — Agent actions: numbered Finder checks and internal steps
Block 3 — Escalation: exact channel + POC + what to include
```

---

## 2. Chat Draft Generator

| Attribute | Detail |
|---|---|
| **Variable** | `draftPrompt` |
| **File** | `app/api/chat/draft/route.ts` L28 |
| **Model** | `gemini-3.5-flash` |

**Purpose:** Takes the internal agent briefing (from Stage 2) and case details to generate a customer-ready draft message. Enforces rules to omit internal terminology (Slack channels like `#cx-ops`, CRM name `Finder`). Output must be empathetic, professional, and limited to 3–5 sentences.

**Output format:**
```json
{ "draft": "<relayed customer message>" }
```

---

## 3. Quality Evaluator (IQS) Scoring Prompts

### A. Chat IQS Scorer

| Attribute | Detail |
|---|---|
| **Variable** | `IQS_SYSTEM_PROMPT` |
| **File** | `lib/quality.ts` L178 |
| **Model** | `gemini-3.5-flash` |

**Purpose:** Evaluates complete chat transcripts against trained human evaluator standards. Rates across **11 parameters** with weights summing to 100%.

#### Parameters & Weights

| # | Key | Label | Weight |
|---|---|---|---|
| 1 | `Technical` | Technically / Legally Correct | 20% (highest) |
| 2 | `AllQuestions` | All Questions Answered | 10% |
| 3 | `Expectation` | Expectation Setting | 10% |
| 4 | `Contextual` | Contextual & Personal | 10% |
| 5 | `FollowUp` | Follow-up & Closing | 10% |
| 6 | `Sentences` | Sentences / Simple to Understand | 10% |
| 7 | `Process` | Process-wise | 5% |
| 8 | `Opening` | First Response & Opening | 5% |
| 9 | `Call` | Call (when required) | 5% |
| 10 | `Grammar` | Grammar / Structure | 5% |
| 11 | `Empathy` | Empathy | 10% |

**IQS formula:** Sum of (weight x pass) for all parameters, normalized to 100. NA counts as Yes (pass).

#### Key Scoring Policies baked into the prompt

- **Parameter Isolation** — Each parameter's reasoning must stay within its own criteria only; never cross-reference other parameter names.
- **Expectation Setting & TAT Leniency** — Exact timeline/TAT is not always possible (e.g. backend/tech investigation, bank/RTA dependencies). If an agent communicates that they are raising the issue with the concerned team and will update the customer as soon as possible, this is sufficient expectation setting; never reduce marks for omitting a specific TAT.
- **Date awareness** — Dates on or before today are past events; never fail Expectation for referencing already-passed dates.
- **Documents via WhatsApp** — Always incorrect. Redirecting to email is correct behavior.
- **Form 15G/H vs Form 121** — Form 121 has replaced 15G/H. Directing customers to submit directly with the entity is correct.
- **Settlement timelines** — T+3 for first investment; T+1 for subsequent (Mon–Fri only). Never penalise for these.
- **Private Notes / Internal Notes** — Treat private/internal notes as background context to understand internal actions, but do NOT include or evaluate them while judging customer-facing chat quality.
- **Robylon AI / bot messages** — Treat as internal system entries; do not evaluate.
- **Finder checks** — Cannot assume a check was skipped unless the agent's response directly contradicts what a check would have shown.
- **Calls** — Score NA and flag `uncertain_parameters` when a call happened but you cannot evaluate it.
- **Previous conversation references** — Be lenient on Technical and AllQuestions when prior context is referenced but not visible.

**Output format:**
```json
{
  "scores": { "Technical": "Yes|No|NA", "AllQuestions": "Yes|No|NA", "Expectation": "Yes|No|NA", "Contextual": "Yes|No|NA", "FollowUp": "Yes|No|NA", "Sentences": "Yes|No|NA", "Process": "Yes|No|NA", "Opening": "Yes|No|NA", "Call": "Yes|No|NA", "Grammar": "Yes|No|NA", "Empathy": "Yes|No|NA" },
  "reasoning": { "Technical": "brief reason with KB cite", ... },
  "kbCitation": "Document Name > Section Heading (null if not relevant)",
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment",
  "agentName": "First name",
  "uncertain_parameters": [{ "parameter": "Call", "question": "Was a call arranged and handled correctly?" }]
}
```

---

### B. Call IQS Scorer

| Attribute | Detail |
|---|---|
| **Variable** | `CALL_IQS_SYSTEM_PROMPT` |
| **File** | `lib/call-quality.ts` L455 |
| **Model** | `gemini-3.5-flash` |

**Purpose:** Evaluates voice call transcripts (with optional WhatsApp chat context) across **11 voice-specific parameters**. The call transcript is the primary scoring source; the chat is context only.

#### Parameters & Weights

| Group | # | Key | Label | Weight |
|---|---|---|---|---|
| Process (50%) | 1 | `CallOpening` | Call Opening | 5% |
| | 2 | `CallClosing` | Call Closing | 5% |
| | 3 | `TechnicalLegal` | Technically / Legally Correct | 15% (highest) |
| | 4 | `AllQuestions` | All Questions Addressed | 10% |
| | 5 | `Expectation` | Expectation Setting | 10% |
| | 6 | `Process` | Process | 5% |
| Communication Skills (30%) | 7 | `Grammar` | Vocabulary / Sentence Structure / Grammar | 10% |
| | 8 | `Fillers` | Fillers, Fumbling & Dead Air | 10% |
| | 9 | `EnergyTone` | Energy Level, Enthusiasm & Tone | 10% |
| Customer Service Skills (20%) | 10 | `ActiveListening` | Active Listening, Interruptions & Empathy | 10% |
| | 11 | `Simplifying` | Simplifying Answers | 10% |

**Key differences from chat IQS:**
- `EnergyTone` is audio-based; score NA if only transcript is available.
- `Process` checks whether the IR pre-reviewed prior chat context before calling.
- Output includes `poor_listening_segments`: segment indexes where IR asked investor to repeat.
- `TechnicalLegal` — SEBI regulatory violations (investment recommendations, guaranteed returns) are automatic fails.

**Output format:**
```json
{
  "scores": { "CallOpening": "Yes|No|NA", "CallClosing": "Yes|No|NA", "TechnicalLegal": "Yes|No|NA", "AllQuestions": "Yes|No|NA", "Expectation": "Yes|No|NA", "Process": "Yes|No|NA", "Grammar": "Yes|No|NA", "Fillers": "Yes|No|NA", "EnergyTone": "Yes|No|NA", "ActiveListening": "Yes|No|NA", "Simplifying": "Yes|No|NA" },
  "reasoning": { "CallOpening": "...", ... },
  "kbCitation": "Document Name > Section Heading (null if not relevant)",
  "poor_listening_segments": [{ "segment_index": 7, "phrase": "Could you please repeat that?" }],
  "iqs_score": 85,
  "summary": "1-2 sentence overall assessment"
}
```

---

## 4. Audio & Call Analytics Prompts

### A. Call Transcription

| Variable | `CALL_TRANSCRIPTION_PROMPT` | File | `lib/call-quality.ts` L166 |
|---|---|---|---|

**Purpose:** Transcribes raw audio. Identifies roles (`IR EXECUTIVE` vs `INVESTOR`), flags interruptions, inserts dead air durations, identifies active listening phrases, translates non-English turns to English.

**Output:** JSON `{ "language": "...", "segments": [...] }`

---

### B. Energy / Tone Audio Scorer

| Variable | `ENERGY_TONE_PROMPT` | File | `lib/call-quality.ts` L273 |
|---|---|---|---|

**Purpose:** Evaluates IR Executive's energy level, enthusiasm, and tone modulation directly from audio signals (not transcription).

**Output:** JSON `{ "score": "Yes|No|NA", "reasoning": "..." }`

---

### C. Call Topic / Disposition Extractor

| Variable | `CALL_DISPOSITION_PROMPT` | File | `lib/call-quality.ts` L288 |
|---|---|---|---|

**Purpose:** Loose extraction of the main call topic/disposition to facilitate downstream KB searches.

**Output:** JSON `{ "call_disposition": "...", "call_sub_disposition": "..." }`

---

### D. Call Taxonomy Classifier

| Variable | `CALL_DISPOSITION_CLASSIFY_PROMPT` | File | `lib/call-quality.ts` L294 |
|---|---|---|---|

**Purpose:** Classifies a transcript into one of Wint Wealth's official taxonomies: Liquidity, SGB, Referral, Taxation, Bond Purchase, FD, Repayment, Asset, Flexi-Tenure, SIP, KYC.

**Output:** JSON `{ "disposition": "...", "sub_disposition": "..." }`

---

### E. Call Chunking Splitter

| Variable | `CALL_CHUNK_PROMPT` | File | `lib/call-quality.ts` L430 |
|---|---|---|---|

**Purpose:** Breaks long transcripts into topic-based slices for finer-grained retrieval.

**Output:** JSON array of `{ "topic": "...", "summary": "...", "content": "..." }`

---

### F. Two-Pass Analyzer — Pass 1 (Structure)

| Variable | `PASS1_PROMPT` | File | `lib/call-analyzer.ts` L250 | Model | `gemini-3.5-flash` |
|---|---|---|---|---|---|

**Purpose:** First pass over raw audio. Detects timing structures, speaker turns (labeled A/B — no identity), overlap sections, and dead air without transcribing words.

**Output:** JSON `{ "duration_seconds": 0.0, "events": [...] }`

---

### G. Two-Pass Analyzer — Pass 2 (Content)

| Variable | `buildPass2Prompt(pass1)` | File | `lib/call-analyzer.ts` L294 | Model | `gemini-3.5-flash` |
|---|---|---|---|---|---|

**Purpose:** Second pass using Pass 1 timestamps. Transcribes, translates, identifies roles (`IR_EXECUTIVE` / `INVESTOR`), computes per-turn sentiment, aggression, confidence, empathy, and speech speed.

**Output:** JSON — mapped segments with language details and per-turn metrics.

---

## 5. Analytics Agent & Text-to-SQL Prompts

### A. Analytics Planner (Pass 1)

| Variable | `PLANNER_PROMPT` | File | `lib/analytics/agent.ts` L10 |
|---|---|---|---|

**Purpose:** Translates conversational analyst queries into detailed SQL query plans. Defines date ranges, selects metrics (CSAT, IQS, volume), implements SQL safety rules, maps target chart types, and decides whether transcript retrieval is required.

**Output format:**
```json
{
  "action": "plan|clarify",
  "intent": "intent description",
  "sqls": [{ "sql": "...", "intent": "...", "output_shape": "..." }],
  "needs_transcripts": false,
  "output_shape": "single_number|bar_chart|line_chart|table|insight_summary|transcript_analysis|combined_analysis"
}
```

---

### B. Analytics Synthesizer (Pass 2)

| Variable | `SYNTHESIZER_PROMPT` | File | `lib/analytics/agent.ts` L162 |
|---|---|---|---|

**Purpose:** Synthesizes SQL query results and transcript summaries into stakeholder-ready analytical briefs. Surfaces insights, characterises metrics, identifies anomalies.

**Output:** JSON with `action`, `title`, `answer_text`, `data_rows`, `finding`, `evidence`, `coverage`, `caveats`, `warnings`.

---

### C. Intent Classifier

| Function | `buildSystemPrompt()` | File | `lib/analytics/classifier.ts` L24 |
|---|---|---|---|

**Purpose:** Classifies natural language requests into aggregate query templates or qualitative theme extractions. Maps filters like dates, CSAT scores, agent names, teams.

**Output:** JSON `{ "type": 1|2, "shape": "...", "templateId": "...", "entities": {...} }`

---

### D. Qualitative Theme Summarizer

| Function | `summarizeBatch()` | File | `lib/analytics/themes.ts` L104 |
|---|---|---|---|

**Purpose:** Summarizes batches of low-CSAT chats into short, one-sentence problem descriptions.

**Output:** JSON array of strings.

---

### E. Theme Clustering Scorer

| Function | `clusterThemes()` | File | `lib/analytics/themes.ts` L140 |
|---|---|---|---|

**Purpose:** Consolidates one-sentence complaint summaries into at most 7 clustered problem themes.

**Output:** JSON `{ "themes": [...] }`

---

### F. Qualitative Batch Summarizer

| Variable | `PROMPT` | File | `lib/analytics/summarizer.ts` L4 |
|---|---|---|---|

**Purpose:** Summarizes batches of conversations, focusing on sentiment triggers, agent handling, and resolution bottlenecks.

**Output:** Plain text paragraph (5–8 sentences).

---

### G. PostgreSQL Text-to-SQL Generator

| Function | `buildPrompt()` | File | `lib/analytics/text-to-sql.ts` L101 |
|---|---|---|---|

**Purpose:** Generates a PostgreSQL query with chart presentation hints from a natural language question and metadata filters.

**Output:** JSON `{ "kind": "sql|theme_extraction|cannot_answer", ... }`

---

## 6. Agent Coaching & Feedback Prompts

### A. Team Lead (TL) Member-Analytics Feedback

| Attribute | Detail |
|---|---|
| **Variable** | `prompt` |
| **File** | `app/api/cx/tl/member-analytics/ai/route.ts` L168 |
| **Model** | `gemini-3.5-flash` |

**Purpose:** Evaluates agent stats (CSAT, IQS, volume, weakest parameters, top dispositions) and compiles strengths, watch areas, and actionable coaching tips for Team Leads.

**Output format:**
```json
{
  "summary": "Coaching overview paragraph",
  "items": [{ "type": "strength|watch|tip", "text": "Details..." }]
}
```

---

### B. Agent Self-Analytics Feedback

| Attribute | Detail |
|---|---|
| **Variable** | `systemPrompt` |
| **File** | `app/api/quality/my-analytics/ai/route.ts` L199 |
| **Model** | `claude-haiku-4-5-20251001` |

**Purpose:** Evaluates an individual agent's stats to generate a direct, actionable performance summary highlighting strengths, watches, and tips. Exactly 3–4 insight items per response.

**Output format:**
```json
{
  "summary": "One concise summary sentence",
  "items": [{ "tag": "Strength|Watch|Tip", "text": "Insight..." }]
}
```

---

## 7. Pipeline Meta-Prompt (Offline Review)

| **File** | `PROMPT_analysis_meta.txt` |
|---|---|

**Purpose:** An **offline review guide** — not invoked at runtime. Copy-paste into an external LLM (e.g. Claude Sonnet 4) along with `PROMPT_analyze.txt` and `PROMPT_chat.txt` to run gap analysis, question quality review, answer formatting assessment, and coherence checks.

---

## Quick Reference: All Prompts

| Prompt | Variable / File | Model | Runtime? |
|---|---|---|---|
| Stage 0 Router | `PROMPT_router.txt` | gemini-3.5-flash | Yes |
| Stage 1A Repayment Extractor | `PROMPT_extract_repayment.txt` | gemini-3.5-flash | Yes |
| Stage 1B Triage & Questions | `PROMPT_analyze.txt` (analyzePrompt) | gemini-3.5-flash | Yes |
| Stage 2 Answer Generator | `PROMPT_chat.txt` (DEFAULT_CHAT_PROCESS_PROMPT) | gemini-3.5-pro | Yes |
| Chat Draft Generator | draftPrompt in chat/draft/route.ts | gemini-3.5-flash | Yes |
| Chat IQS Scorer | IQS_SYSTEM_PROMPT in lib/quality.ts | gemini-3.5-flash | Yes |
| Call IQS Scorer | CALL_IQS_SYSTEM_PROMPT in lib/call-quality.ts | gemini-3.5-flash | Yes |
| Call Transcription | CALL_TRANSCRIPTION_PROMPT in lib/call-quality.ts | Gemini multimodal | Yes |
| Energy / Tone Scorer | ENERGY_TONE_PROMPT in lib/call-quality.ts | Gemini audio | Yes |
| Call Disposition Extractor | CALL_DISPOSITION_PROMPT in lib/call-quality.ts | gemini | Yes |
| Call Taxonomy Classifier | CALL_DISPOSITION_CLASSIFY_PROMPT in lib/call-quality.ts | gemini | Yes |
| Call Chunk Splitter | CALL_CHUNK_PROMPT in lib/call-quality.ts | gemini | Yes |
| Audio Analyzer Pass 1 | PASS1_PROMPT in lib/call-analyzer.ts | gemini-3.5-flash | Yes |
| Audio Analyzer Pass 2 | buildPass2Prompt() in lib/call-analyzer.ts | gemini-3.5-flash | Yes |
| Analytics Planner | PLANNER_PROMPT in lib/analytics/agent.ts | gemini | Yes |
| Analytics Synthesizer | SYNTHESIZER_PROMPT in lib/analytics/agent.ts | gemini | Yes |
| Intent Classifier | buildSystemPrompt() in lib/analytics/classifier.ts | gemini | Yes |
| Theme Summarizer | summarizeBatch() in lib/analytics/themes.ts | gemini | Yes |
| Theme Clusterer | clusterThemes() in lib/analytics/themes.ts | gemini | Yes |
| Batch Summarizer | PROMPT in lib/analytics/summarizer.ts | gemini | Yes |
| Text-to-SQL Generator | buildPrompt() in lib/analytics/text-to-sql.ts | gemini | Yes |
| TL Analytics Feedback | prompt in cx/tl/member-analytics/ai/route.ts | gemini-3.5-flash | Yes |
| Agent Self-Analytics | systemPrompt in quality/my-analytics/ai/route.ts | claude-haiku-4-5 | Yes |
| Pipeline Meta-Review | PROMPT_analysis_meta.txt | (external, manual) | No |
