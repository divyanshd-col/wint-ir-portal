# Wint Wealth IR Portal Prompts Documentation

This document inventories and details all the system and agent prompts used across the Wint Wealth IR Portal codebase. The portal employs a variety of models (Gemini and Claude) to power live triage pipelines, quality scoring engines (both chat and call), analytics tools, and performance reviews.

---

## Table of Contents
1. [Customer Chat Pipeline (Stage 1 & 2)](#1-customer-chat-pipeline-stage-1--2)
2. [Chat Draft Generator](#2-chat-draft-generator)
3. [Quality Evaluator (IQS) Scoring Prompts](#3-quality-evaluator-iqs-scoring-prompts)
4. [Audio & Call Analytics Prompts](#4-audio--call-analytics-prompts)
5. [Analytics Agent & Text-to-SQL Prompts](#5-analytics-agent--text-to-sql-prompts)
6. [Agent Coaching & Feedback Prompts](#6-agent-coaching--feedback-prompts)

---

## 1. Customer Chat Pipeline (Stage 1 & 2)

These prompts work in sequence to power the real-time helper chat for Investor Relations (IR) agents.

### A. Stage 1: Triage & Question Generator
* **Key/Variable Name:** `analyzePrompt`
* **File Locations:** 
  * Source Template: [PROMPT_analyze.txt](file:///Users/admin/Documents/WintWealth/wint-ir-portal/PROMPT_analyze.txt)
  * Runtime Route: [app/api/chat/analyze/route.ts#L35](file:///Users/admin/Documents/WintWealth/wint-ir-portal/app/api/chat/analyze/route.ts#L35)
* **Model:** `gemini-2.5-flash`
* **Role/Purpose:** Evaluates every message sent by the agent. It determines if a query is `direct` (how-to/policy), `clarify`, or `process` (requires user-specific lookup). For `process` queries, it walks a canonical field schema for **10 categories** (Repayment, KYC, Payment, SIP, Sell/DDPI, Referral, Taxation, Dashboard, FD, HUF) and generates structured JSON to collect facts one at a time. It also automatically extracts facts from attached screenshots.
* **Output Format:** JSON
  ```json
  {
    "queryType": "direct" | "process" | "clarify",
    "category": "repayment" | "kyc" | "payment" | "sip" | "sell" | "referral" | "taxation" | "dashboard" | "fd" | "huf" | null,
    "questions": [
      {
        "id": "canonical_field_id",
        "label": "Question label",
        "options": ["opt1", "opt2"],
        "type": "select" | "text"
      }
    ],
    "stepTitle": "Step N: Description",
    "reasoning": "Contextual reason for this question",
    "extractedFacts": { "field_id": "value" }
  }
  ```

### B. Stage 2: Answer Generator (Chat Assistant)
* **Key/Variable Name:** `DEFAULT_CHAT_PROCESS_PROMPT`
* **File Locations:** 
  * Source Template: [PROMPT_chat.txt](file:///Users/admin/Documents/WintWealth/wint-ir-portal/PROMPT_chat.txt)
  * Runtime Route: [app/api/chat/route.ts#L11](file:///Users/admin/Documents/WintWealth/wint-ir-portal/app/api/chat/route.ts#L11)
* **Model:** `gemini-2.5-pro` (falls back to `gemini-2.5-flash`)
* **Role/Purpose:** Executes once Stage 1 has collected all necessary facts. It takes the confirmed facts, conversation history, and the top 15 retrieved Knowledge Base (KB) chunks. It maps the facts to precise scenarios in the KB and generates an internal briefing strictly structured for the agent.
* **Output Format:** Plain text matching:
  ```text
  Block 1 — Tell the user: [exact message to relay] — 1-2 sentences only
  Block 2 — Agent actions: numbered Finder checks and internal steps
  Block 3 — Escalation: exact channel + POC + what to include
  ```

### C. Pipeline Meta-Prompt
* **File Location:** [PROMPT_analysis_meta.txt](file:///Users/admin/Documents/WintWealth/wint-ir-portal/PROMPT_analysis_meta.txt)
* **Role/Purpose:** A review guide to copy-paste into external LLMs (e.g. Claude 3.5 Sonnet) along with `PROMPT_analyze.txt` and `PROMPT_chat.txt` to run a gap analysis, question quality review, answer formatting assessment, and coherence check.

---

## 2. Chat Draft Generator

* **Key/Variable Name:** `draftPrompt`
* **File Location:** [app/api/chat/draft/route.ts#L28](file:///Users/admin/Documents/WintWealth/wint-ir-portal/app/api/chat/draft/route.ts#L28)
* **Model:** `gemini-2.5-flash`
* **Role/Purpose:** Takes the internal agent briefing (from Stage 2) and case details to generate a draft message that the agent can send directly to the investor. It enforces rules to omit internal terminology (e.g., specific Slack channels like `#cx-ops` or CRM names like `Finder`) and structures the text to be empathetic, professional, and limited to 3-5 sentences.
* **Output Format:** JSON
  ```json
  { "draft": "<relayed customer message>" }
  ```

---

## 3. Quality Evaluator (IQS) Scoring Prompts

Evaluates agent performance against defined standards.

### A. Chat Quality Evaluator (IQS) Scorer
* **Key/Variable Name:** `IQS_SYSTEM_PROMPT`
* **File Location:** [lib/quality.ts#L175](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/quality.ts#L175)
* **Model:** `gemini-2.5-flash`
* **Role/Purpose:** Evaluates complete chat transcripts. It rates them across **11 parameters** (Technically Correct, All Questions Answered, Expectation Setting, Contextual & Personal, Follow-up & Closing, Sentences/Tone, Process-wise, First Response & Opening, Call, Grammar, and Empathy).
* **Output Format:** JSON
  ```json
  {
    "scores": { "Technical": "Yes|No|NA", ... },
    "reasoning": { "Technical": "explanation and citation", ... },
    "kbCitation": "Document Name > Section Heading (or null)",
    "iqs_score": 85,
    "summary": "1-2 sentence assessment",
    "agentName": "First name of agent",
    "uncertain_parameters": [
      { "parameter": "Grammar", "question": "coaching question" }
    ]
  }
  ```

### B. Call Quality Evaluator (IQS) Scorer
* **Key/Variable Name:** `CALL_IQS_SYSTEM_PROMPT`
* **File Location:** [lib/call-quality.ts#L455](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-quality.ts#L455)
* **Model:** Speech/text evaluation model
* **Role/Purpose:** Evaluates call recordings (via transcripts) on 11 parameters customized for voice interactions (e.g. Call Opening, Call Closing, Fillers/Dead Air, Active Listening, and Simplifying Answers).
* **Output Format:** JSON (similar structure to the Chat Scorer, including a list of `poor_listening_segments`).

---

## 4. Audio & Call Analytics Prompts

These prompts analyze raw call recordings, structure transcripts, and extract metadata.

### A. Call Transcription (Pass 1)
* **Key/Variable Name:** `CALL_TRANSCRIPTION_PROMPT`
* **File Location:** [lib/call-quality.ts#L166](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-quality.ts#L166)
* **Model:** Multilingual audio-to-text pipeline
* **Role/Purpose:** Listens to raw audio to perform transcription and identify roles (`IR EXECUTIVE` vs `INVESTOR`). It flags interruptions, inserts dead air durations, identifies active listening phrases, and translates non-English spoken turns into English.
* **Output Format:** JSON (`language`, `segments[]`)

### B. Energy / Tone Audio Scorer (Pass 1b)
* **Key/Variable Name:** `ENERGY_TONE_PROMPT`
* **File Location:** [lib/call-quality.ts#L273](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-quality.ts#L273)
* **Model:** Audio signal model
* **Role/Purpose:** Evaluates energy level, enthusiasm, and tone modulation of the IR Executive's voice directly from audio patterns.
* **Output Format:** JSON `{ "score": "Yes|No|NA", "reasoning": "..." }`

### C. Call Topic/Disposition Extractor
* **Key/Variable Name:** `CALL_DISPOSITION_PROMPT`
* **File Location:** [lib/call-quality.ts#L288](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-quality.ts#L288)
* **Role/Purpose:** Conducts loose extraction of the main topics/dispositions from a call to facilitate downstream Knowledge Base searches.
* **Output Format:** JSON `{ "call_disposition": "...", "call_sub_disposition": "..." }`

### D. Call Taxonomy Classifier
* **Key/Variable Name:** `CALL_DISPOSITION_CLASSIFY_PROMPT`
* **File Location:** [lib/call-quality.ts#L294](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-quality.ts#L294)
* **Role/Purpose:** Classifies a transcript strictly into one of Wint Wealth's official taxonomies (e.g. Liquidity, SGB, Referral, Taxation, Bond Purchase, FD, Repayment, Asset, Flexi-Tenure, SIP, KYC).
* **Output Format:** JSON `{ "disposition": "...", "sub_disposition": "..." }`

### E. Call Chunking Splitter
* **Key/Variable Name:** `CALL_CHUNK_PROMPT`
* **File Location:** [lib/call-quality.ts#L430](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-quality.ts#L430)
* **Role/Purpose:** Breaks long transcripts into topic-based slices for finer-grained retrieval.
* **Output Format:** JSON Array of chunk objects (`topic`, `summary`, `content`).

### F. Two-Pass Call Analyzer (Pass 1 - Structure)
* **Key/Variable Name:** `PASS1_PROMPT`
* **File Location:** [lib/call-analyzer.ts#L250](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-analyzer.ts#L250)
* **Model:** `gemini-2.5-flash`
* **Role/Purpose:** First pass of the audio analyzer. Detects timing structures, speaker turns (labeled as generic A/B), overlap sections, and dead air duration without transcribing word contents.
* **Output Format:** JSON `{ "duration_seconds": 0.0, "events": [...] }`

### G. Two-Pass Call Analyzer (Pass 2 - Content)
* **Key/Variable Name:** `buildPass2Prompt`
* **File Location:** [lib/call-analyzer.ts#L294](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/call-analyzer.ts#L294)
* **Model:** `gemini-2.5-flash`
* **Role/Purpose:** Second pass of the audio analyzer. Takes structural timestamps from Pass 1, performs translation/transcription, identifies roles (`IR_EXECUTIVE` / `INVESTOR`), and computes per-turn sentiment, aggression, confidence, empathy, and speech speed.
* **Output Format:** JSON containing mapped segments, language details, and speaker confidence levels.

---

## 5. Analytics Agent & Text-to-SQL Prompts

These prompts power the natural language query engine on the CX Analytics Dashboard.

### A. Analytics Planner (Pass 1)
* **Key/Variable Name:** `PLANNER_PROMPT`
* **File Location:** [lib/analytics/agent.ts#L10](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/agent.ts#L10)
* **Model:** SQL Planner
* **Role/Purpose:** Translates conversational analyst queries into detailed query plans. It defines dates, selects metrics (CSAT, IQS, volume), implements SQL rules (date filtering, joins, limit guards), maps target charts, and decides whether transcript retrieval is required.
* **Output Format:** JSON
  ```json
  {
    "action": "plan" | "clarify",
    "intent": "intent description",
    "sqls": [{ "sql": "...", "intent": "...", "output_shape": "..." }],
    "needs_transcripts": false,
    "transcript_id_sql": null,
    "transcript_intent": null,
    "output_shape": "single_number|bar_chart|line_chart|table|insight_summary|transcript_analysis|combined_analysis"
  }
  ```

### B. Analytics Synthesizer (Pass 2)
* **Key/Variable Name:** `SYNTHESIZER_PROMPT`
* **File Location:** [lib/analytics/agent.ts#L162](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/agent.ts#L162)
* **Model:** Senior CX Data Analyst
* **Role/Purpose:** Synthesizes SQL database results and transcript summaries. It surfaces core insights, characterises metrics, identifies anomalies, explains data constraints, and crafts stakeholder-ready briefs.
* **Output Format:** JSON (`action: final_answer`, `title`, `answer_text`, `data_rows`, `finding`, `evidence`, `coverage`, `caveats`, `warnings`).

### C. Intent Classifier
* **Key/Variable Name:** Constructed by `buildSystemPrompt`
* **File Location:** [lib/analytics/classifier.ts#L29](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/classifier.ts#L29)
* **Role/Purpose:** Classifies natural language requests into aggregate query templates or qualitative theme extractions. Maps filters like dates, CSAT scores, agent names, and teams.
* **Output Format:** JSON `{ "type": 1|2, "shape": "...", "templateId": "...", "entities": {...} }`

### D. Qualitative Theme Summarizer
* **Key/Variable Name:** Inside `summarizeBatch`
* **File Location:** [lib/analytics/themes.ts#L113](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/themes.ts#L113)
* **Role/Purpose:** Summarizes batches of bad or could-be-better CSAT chats into short, one-sentence problem descriptions.
* **Output Format:** JSON Array of strings.

### E. Theme Clustering Scorer
* **Key/Variable Name:** Inside `clusterThemes`
* **File Location:** [lib/analytics/themes.ts#L146](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/themes.ts#L146)
* **Role/Purpose:** Consolidates multiple one-sentence complaint summaries into at most 7 clustered problem themes.
* **Output Format:** JSON `{ "themes": [...] }`

### F. Qualitative Batch Summarizer
* **Key/Variable Name:** `PROMPT`
* **File Location:** [lib/analytics/summarizer.ts#L4](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/summarizer.ts#L4)
* **Role/Purpose:** Summarizes batches of conversations for analysis, focusing on sentiment triggers, agent handling, and resolution bottlenecks.
* **Output Format:** Plain text paragraph (5-8 sentences).

### G. PostgreSQL Text-to-SQL Generator
* **Key/Variable Name:** Constructed by `buildPrompt`
* **File Location:** [lib/analytics/text-to-sql.ts#L101](file:///Users/admin/Documents/WintWealth/wint-ir-portal/lib/analytics/text-to-sql.ts#L101)
* **Role/Purpose:** Generates a PostgreSQL query with chart presentation hints based on user questions and metadata filters.
* **Output Format:** JSON `{ "kind": "sql" | "theme_extraction" | "cannot_answer", ... }`

---

## 6. Agent Coaching & Feedback Prompts

Prompts that compile coaching cards and performance feedback for agents and supervisors.

### A. Team Lead (TL) Member-Analytics Feedback
* **Key/Variable Name:** `prompt`
* **File Location:** [app/api/cx/tl/member-analytics/ai/route.ts#L168](file:///Users/admin/Documents/WintWealth/wint-ir-portal/app/api/cx/tl/member-analytics/ai/route.ts#L168)
* **Model:** `gemini-2.5-flash`
* **Role/Purpose:** Evaluates agent stats (CSAT, IQS, volume, weakest parameters, and top dispositions) and compiles strengths, watch areas, and actionable coaching tips for Team Leads.
* **Output Format:** JSON
  ```json
  {
    "summary": "Coaching overview paragraph",
    "items": [
      { "type": "strength" | "watch" | "tip", "text": "Details..." }
    ]
  }
  ```

### B. Agent Self-Analytics Feedback
* **Key/Variable Name:** `systemPrompt`
* **File Location:** [app/api/quality/my-analytics/ai/route.ts#L199](file:///Users/admin/Documents/WintWealth/wint-ir-portal/app/api/quality/my-analytics/ai/route.ts#L199)
* **Model:** `claude-haiku-4-5-20251001`
* **Role/Purpose:** Evaluates an individual agent's stats to generate a direct, actionable summary of performance, highlighting specific areas of strength, watches, and tips.
* **Output Format:** JSON
  ```json
  {
    "summary": "Overview sentence",
    "items": [
      { "tag": "Strength" | "Watch" | "Tip", "text": "Insight..." }
    ]
  }
  ```
