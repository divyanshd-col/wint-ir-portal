# Wint Wealth IR Portal — Current Flows & Optimization Plan

This document covers the current architecture, known weaknesses, and recommended improvements for all four AI-powered systems in the portal.

> **Last updated:** 2026-07-06

---

## Table of Contents
1. [IR Support Assistant Chat](#1-ir-support-assistant-chat)
2. [Chat Quality Analysis (IQS)](#2-chat-quality-analysis-iqs)
3. [Call Transcript & Analysis](#3-call-transcript--analysis)
4. [Call Quality Judging (IQS)](#4-call-quality-judging-iqs)
5. [Shared RAG Infrastructure](#5-shared-rag-infrastructure)
6. [Quick-Reference: What to Change](#6-quick-reference-what-to-change)

---

## 1. IR Support Assistant Chat

### Current Flow

```
Agent types query
      │
      ▼
[Stage 0] PROMPT_router.txt → gemini-3.5-flash
      │  Classifies: category + queryType (direct/process/clarify)
      │
      ├── queryType = "direct" ──────────────────────────────────────────────────►
      │                                                                           │
      ├── category = "repayment" + queryType = "process"                         │
      │         │                                                                 │
      │         ▼                                                                 │
      │  [Stage 1A] PROMPT_extract_repayment.txt → gemini-3.5-flash              │
      │         │   Walks decision tree: 4-step fact-gathering                   │
      │         │   Returns next question OR resolved extractedFacts              │
      │         │                                                                 │
      └── all other categories + queryType = "process"                           │
                │                                                                 │
                ▼                                                                 │
       [Stage 1B] PROMPT_analyze.txt → gemini-3.5-flash                          │
                │  General triage: walks field schema for 10 categories          │
                │  Returns next question OR extractedFacts                        │
                │                                                                 │
                └── all facts collected ──────────────────────────────────────►  │
                                                                                  │
                                                     ◄────────────────────────────┘
                                                     │
                                                     ▼
                              [KB Retrieval] fetchKnowledgeChunks() → cache
                              [Query Expansion] expandQuery() → gemini-3.5-flash
                                     │  Distills query to 6-10 focused keywords
                                     │  + category boost keywords appended
                                     │  + form answer keys/values appended
                                     │
                                     ▼
                              retrieveRelevantChunks(all chunks, query, topK=20)
                                     │  BM25-style: header 3×, body 1×, phrase 5×
                                     │  Always returns top 20 regardless of score
                                     │
                                     ▼
                              [Stage 2] PROMPT_chat.txt → gemini-3.5-pro
                                     │  Receives: confirmed facts + top-20 KB chunks
                                     │  Outputs: 3-block structured briefing
                                     │     Block 1 — Tell the user (1-2 sentences)
                                     │     Block 2 — Agent actions (Finder checks)
                                     │     Block 3 — Escalation path
                                     │
                                     ▼
                              [Draft] draftPrompt → gemini-3.5-flash
                                     Converts internal briefing → customer-ready message
                                     Strips internal terms (Finder, #cx-ops, etc.)
```

### Problems

| # | Problem | Impact |
|---|---|---|
| 1 | **600-char chunk size** splits scenarios mid-content | Answer generator misses half a repayment scenario or SIP step |
| 2 | **topK=20** with small chunks sends many partial sections | LLM context is noisy; more tokens don't mean more precision |
| 3 | **Only repayment has a dedicated micro-prompt (Stage 1A)** | Other categories (SIP, KYC, Sell) use the generic Stage 1B with all 10 schemas in one prompt — it's large and can misfire on edge cases |
| 4 | **KB cache is stale for up to 30 min** after a doc update | Agents get outdated answers; no way to force-refresh without a cold start |
| 5 | **Query expansion is a separate LLM call** adding ~1-2s latency | Runs in parallel with KB fetch, but adds cost every query |

### Recommended Changes

| Change | Action | File | Priority |
|---|---|---|---|
| Increase chunk size | `maxChars = 1100` | `lib/drive.ts` L140 | High |
| Bump cache key | `wint_kb_cache_v3` | `lib/store.ts` L15 | High (paired with above) |
| Reduce topK for chat | `topK = 15` | `app/api/chat/route.ts` L330 | Medium |
| Add on-demand KB refresh | `POST /api/admin/refresh-kb` endpoint | New file | Medium |
| Build more category micro-prompts | One PROMPT_extract_*.txt per category | New files | Low (high effort) |

---

## 2. Chat Quality Analysis (IQS)

### Current Flow

```
Chat closes on Robylon
      │
      ▼ (webhook fires → POST /api/webhooks/chat)
[Webhook] Receives chat_id + transcript + CSAT data
      │
      ├─ Build search query from disposition tags
      │
      ▼
fetchKnowledgeChunks() → retrieveRelevantChunks(topK=5)  ← ⚠️ ONLY 5 CHUNKS
      │
      ▼
IQS_SYSTEM_PROMPT + buildScoringPrompt(transcript, KB context)
→ gemini-3.5-flash
      │
      │  Scores 11 parameters:
      │  Technical (20%) | AllQuestions (10%) | Expectation (10%)
      │  Contextual (10%) | FollowUp (10%) | Sentences (10%)
      │  Process (5%) | Opening (5%) | Call (5%)
      │  Grammar (5%) | Empathy (10%)
      │
      ▼
parseScoringResponse() → IQS score + per-parameter scores + reasoning
      │
      ▼
DB: INSERT into iqs_scores table
      │
      ▼ (if linked calls exist)
scoreLinkedCallsForChat() → scores any associated call recordings
```

**Manual re-score path (EvalPanel UI):**
```
QA clicks "Re-score" on EvalPanel
      │
      ▼
POST /api/call-quality/unified-score { chat_id }
      │  Fetches chat transcript + call transcript from DB
      │  Retrieves KB chunks (topK=5) ← ⚠️ ONLY 5 CHUNKS
      │  Scores chat IQS + call IQS in parallel
      │
      ▼
Returns both scores + merged chat+call timeline to EvalPanel
```

### Problems

| # | Problem | Impact |
|---|---|---|
| 1 | **topK=5 for the Technical parameter (20% weight)** — the most important parameter only has 5 chunks to cross-reference | Scorer incorrectly fails Technical when the right KB section is not in the top 5; produces false negatives |
| 2 | **Search query is just the disposition tag** (e.g. "SIP Cancellation") with no query expansion | Disposition tags are often vague; if KB section uses different terminology, relevant chunks score 0 and get passed last |
| 3 | **Transcript trimmed to 5,000 chars** before scoring | Long chats (20+ messages) have their later half discarded — closing messages, follow-ups and confirmations are lost |
| 4 | **Scoring uses `IQS_SYSTEM_PROMPT` or configOverride** — no validation that the override prompt is structurally valid | A bad configOverride silently produces malformed JSON, scores fail, no alert raised |

### Recommended Changes

| Change | Action | File | Priority |
|---|---|---|---|
| Increase topK for IQS scoring | `topK = 12` | `app/api/webhooks/chat/route.ts` L218, L422 | High |
| Increase topK for unified-score | `topK = 12` | `app/api/call-quality/unified-score/route.ts` L357 | High |
| Expand IQS search query | Use `expandQuery()` before retrieval (or add category keywords like live chat does) | `app/api/webhooks/chat/route.ts` L213-228 | Medium |
| Raise transcript trim limit | `trimTranscript(chatTranscriptRaw, 8000)` | `app/api/call-quality/unified-score/route.ts` L187 | Medium |
| Add configOverride JSON validation | Parse + validate structure before using | `app/api/webhooks/chat/route.ts` L306 | Low |

---

## 3. Call Transcript & Analysis

### Current Flow

```
Call ends → recording URL available in Robylon
      │
      ▼ (auto path — webhook fires or linked by chat)
[Step 1] Fetch audio from recording_url → base64
      │
      ▼
[Step 2] CALL_TRANSCRIPTION_PROMPT → Gemini multimodal (audio)
      │  Transcribes audio
      │  Identifies speakers: IR EXECUTIVE vs INVESTOR
      │  Detects: interruptions, dead air, active listening phrases
      │  Translates non-English turns to English
      │  Output: JSON { language, segments[] }
      │
      ▼
[Step 3] DB: INSERT transcript segments into call_recordings table
         UPDATE: interruption_count, dead_air_count, status = 'linked'
      │
      ▼
[Step 4] CALL_DISPOSITION_PROMPT → Gemini text (loose extraction)
      │  Extracts: call_disposition, call_sub_disposition
      │  Used for KB retrieval query
      │
      ▼ (if strict taxonomy needed)
[Step 4b] CALL_DISPOSITION_CLASSIFY_PROMPT → Gemini text
      │   Maps to official taxonomy: Liquidity / SGB / Referral /
      │   Taxation / Bond Purchase / FD / Repayment / Asset /
      │   Flexi-Tenure / SIP / KYC
      │
      ▼
[Step 5] ENERGY_TONE_PROMPT → Gemini audio
      │  Evaluates: energy level, enthusiasm, tone modulation
      │  Output: JSON { score: "Yes|No|NA", reasoning }
      │  NOTE: Runs on audio only — cannot be scored from transcript alone
      │
      ▼ (optional, for long calls — chunked KB retrieval)
[Step 6] CALL_CHUNK_PROMPT → Gemini text
      │  Splits transcript into 2-8 topic-based chunks
      │  Each chunk: { topic, summary, content }
      │  Used for per-topic KB searches on long calls

--- SEPARATE PATH: Two-Pass Deep Analyzer (lib/call-analyzer.ts) ---

[Pass 1] PASS1_PROMPT → gemini-3.5-flash (audio)
      │  Detects: timing structures, speaker turns (A/B labels)
      │  Overlap sections, dead air duration
      │  Does NOT transcribe words — structure only
      │  Output: JSON { duration_seconds, events[] }
      │
      ▼
[Pass 2] buildPass2Prompt(pass1) → gemini-3.5-flash (audio)
      │  Uses Pass 1 timestamps as anchors
      │  Transcribes content within each timed turn
      │  Identifies roles: IR_EXECUTIVE vs INVESTOR
      │  Computes per-turn: sentiment, aggression, confidence,
      │                      empathy, speech speed
      │  Output: JSON with mapped segments + language + speaker confidence
```

**Call linking logic (three-stage lookup):**
```
Given chat_id:
  Stage 1: Direct match — call_recordings.chat_id = chat_id
  Stage 2: Sibling join — recordings whose chat_id shares same contact_id
           (Robylon creates separate ticket IDs per channel)
  Stage 3: contact_id + time window fallback (recording_url not null,
           chat_id is NULL, within chat's open/close window)
→ Deduplicate by recording ID, sort by called_at chronologically
→ Auto-link and trigger transcription+scoring for any unscored recordings
```

### Problems

| # | Problem | Impact |
|---|---|---|
| 1 | **CALL_CHUNK_PROMPT chunks have a `summary` field that is never indexed** | Tokens spent generating summaries that are discarded; summary is richer than the topic label and could improve KB retrieval |
| 2 | **No coverage check on LLM-generated chunks** | LLM may skip segments or repeat them; no code verifies all [N] segment tags are present in exactly one chunk |
| 3 | **No try/catch around JSON.parse of chunk output** | Malformed JSON from CALL_CHUNK_PROMPT silently discards all chunks; downstream KB search runs on empty |
| 4 | **Energy/Tone (ENERGY_TONE_PROMPT) runs in a separate audio call** | Adds 10-15s of latency and extra Gemini audio credit cost; the main CALL_TRANSCRIPTION_PROMPT already has acoustic context |
| 5 | **Auto-transcription on-the-fly in scoreLinkedCallsForChat** — fetches audio, transcribes, and scores in one request | If the recording URL is slow or the transcription times out (270s timeout), the whole webhook request fails |

### Recommended Changes

| Change | Action | File | Priority |
|---|---|---|---|
| Verify chunk coverage | After JSON.parse, check all `[N]` segment IDs appear in chunks; fall back to full transcript if any missing | Wherever CALL_CHUNK_PROMPT is used | High |
| Add JSON parse try/catch + fallback | Wrap chunk parsing; if malformed, use full transcript as single chunk | Same | High |
| Use chunk `summary` in KB retrieval query | Append chunk summaries to `kbQuery` string for retrieval | Post-chunk-step | Medium |
| Merge energy/tone scoring into transcription pass | Combine ENERGY_TONE_PROMPT into the transcription prompt to save one audio call | `lib/call-quality.ts` | Low |
| Decouple auto-transcription from scoring | Queue transcription separately; score in a follow-up job or re-score trigger | `app/api/webhooks/chat/route.ts` | Low (high effort) |

---

## 4. Call Quality Judging (IQS)

### Current Flow

```
Call transcript available in DB (post-transcription)
      │
      ▼
Call disposition lookup:
  kbQuery = callDisposition || chatDisposition || first 400 chars of call
      │
      ▼
fetchKnowledgeChunks() → retrieveRelevantChunks(topK=5) ← ⚠️ ONLY 5 CHUNKS
      │
      ▼
CALL_IQS_SYSTEM_PROMPT + buildCallScoringPrompt(
    callTranscript,       ← primary source
    chatTranscript,       ← context only
    callId, date, kbContext
)
→ gemini-3.5-flash
      │
      │  Scores 11 voice-specific parameters:
      │
      │  GROUP 1 — Process (50%):
      │    CallOpening (5%)     Self-intro + "Wint Wealth" within 5 seconds
      │    CallClosing (5%)     Appropriate sign-off greeting
      │    TechnicalLegal (15%) All product claims verified against KB ← needs most KB
      │    AllQuestions (10%)   Every investor question answered/deferred
      │    Expectation (10%)    Specific timelines given
      │    Process (5%)         Pre-checked prior chat before calling
      │
      │  GROUP 2 — Communication Skills (30%):
      │    Grammar (10%)        Vocabulary, sentence structure, pronunciation
      │    Fillers (10%)        No excessive fillers, dead air, fumbling
      │    EnergyTone (10%)     Tone modulation (audio-based; NA from transcript)
      │
      │  GROUP 3 — Customer Service Skills (20%):
      │    ActiveListening (10%) No interruptions; shows empathy
      │    Simplifying (10%)    Plain language; no unexplained jargon
      │
      ▼
parseCallScoringResponse() → call IQS score + per-parameter + poor_listening_segments
      │
      ▼
DB: UPDATE call_recordings with iqs_score, parameter_scores, scoring_notes
    insertPoorListeningFlags() → flags specific segment indexes
```

### Problems

| # | Problem | Impact |
|---|---|---|
| 1 | **TechnicalLegal (15% weight) only gets 5 KB chunks** | A call touching 2-3 topics (SIP + payment + taxation) needs 3-4 chunks per topic = 9-12 chunks minimum. With 5, TechnicalLegal fails for valid calls |
| 2 | **kbQuery = first 400 chars of transcript if no disposition** | Opening of a call is always "Hello Wint Wealth" small-talk — not useful for KB search. Retrieval is poor quality when disposition tags are missing |
| 3 | **EnergyTone scored from transcript text when audio unavailable** | Prompt says "NA: cannot assess from transcript alone" but the scorer still receives a text transcript and may attempt to score it instead of returning NA |
| 4 | **poor_listening_segments stored but no UI surface** | The data is captured and saved but not shown to the QA reviewer on EvalPanel — value is lost |
| 5 | **Call IQS uses same `buildScoringPrompt` as chat IQS in some paths** | The call-specific parameters (CallOpening, CallClosing, Fillers, etc.) are not in the chat IQS output format — parse failures occur silently |

### Recommended Changes

| Change | Action | File | Priority |
|---|---|---|---|
| Increase topK for call IQS | `topK = 10` | `app/api/call-quality/score-call/route.ts` L94, `unified-score/route.ts` L357, `link-test/route.ts` L200 | High |
| Better fallback for missing disposition | Use CALL_DISPOSITION_PROMPT output (already generated) as the KB query, not raw first 400 chars | `app/api/call-quality/unified-score/route.ts` L353 | High |
| Enforce EnergyTone = NA when no audio data | Add guard: if scoring from text only, force EnergyTone = "NA" before returning | `lib/call-quality.ts` | Medium |
| Surface poor_listening_segments in EvalPanel | Show flagged segments as highlighted rows in the call transcript timeline | `components/quality/EvalPanel.tsx` | Medium |
| Add call-specific prompt selector | Ensure call scoring always uses `buildCallScoringPrompt` + `CALL_IQS_SYSTEM_PROMPT`, never the chat path | All call scoring routes | Low |

---

## 5. Shared RAG Infrastructure

This infrastructure is used by ALL four systems above.

### Current State

| Component | Detail |
|---|---|
| **Chunk size** | 600 chars (≈150 tokens) |
| **Chunking strategy** | Section-aware: splits at headers (Markdown, numbered, ALL CAPS, type-code) |
| **Breadcrumb** | Full ancestor path prepended: `1. KYC > 1.1 AOF > 1.1.2 Expired` |
| **Overlap** | Last paragraph of each sub-chunk seeded into the next |
| **Cache L1** | In-memory global (`global.__kbCache`), 30-min TTL |
| **Cache L2** | Vercel KV, persists across cold starts, key: `wint_kb_cache_v2` |
| **Cache L3** | Fresh fetch from Google Docs / Drive / PDF |
| **Retrieval** | BM25-style keyword scorer, no vector embeddings |
| **Scoring weights** | Header hit: 3×, Body hit: 1×, 2/3-word phrase: 5× |
| **Stemmer** | Custom suffix stripper (cancelling→cancel, pledging→pledg) |
| **Stop words** | Partial — words <3 chars filtered; longer stop words pass through |

### Known Weaknesses

1. **600-char max is too small** — Wint KB scenarios typically run 800–1,100 chars including condition + steps + caveats. Splitting mid-scenario is the single biggest accuracy degradation point.

2. **Scoring is duplicated** — `retrieveRelevantChunks` and `getTopKBScore` share identical scoring logic written twice. Any weight change must be made in two places.

3. **Stop-words not filtered** — Words like `this`, `that`, `from`, `with`, `have` pass through and generate noise matches across all chunks.

4. **No TF-length normalization** — A 1,200-char chunk with 5 mentions of "KYC" outscores a 200-char chunk that is the exact and only KYC definition. Short precise chunks are penalized.

5. **No cache invalidation trigger** — When a KB doc is updated in Google Docs, the old chunks stay in memory for up to 30 minutes. Agents receive stale answers with no visibility into this.

6. **Header text not in body buffer** — When a header is detected, it becomes the breadcrumb but is not added to the body buffer. So body-match scoring doesn't count the header words — reducing recall when the query matches section names.

### Recommended Changes

```diff
// lib/drive.ts L140
- function chunkText(text: string, maxChars = 600): string[] {
+ function chunkText(text: string, maxChars = 1100): string[] {

// lib/store.ts L15
- const KB_CACHE_KEY = 'wint_kb_cache_v2'; // v2: 600-char chunks with overlap
+ const KB_CACHE_KEY = 'wint_kb_cache_v3'; // v3: 1100-char chunks with overlap

// lib/drive.ts — inside the for (const line of lines) loop, after pushing to breadcrumb
+ buffer.push(line.trim()); // include header text in body for scoring

// lib/drive.ts — add stop-word filter
+ const STOPWORDS = new Set(['this','that','with','have','from','were','they',
+   'their','been','into','when','your','will','what','which','about','more']);
- const rawWords = q.split(/\s+/).filter(w => w.length > 2);
+ const rawWords = q.split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));

// lib/drive.ts — extract shared scorer to eliminate duplication
+ function scoreChunk(chunk, searchTerms, phrases): number { ... }
```

**Add on-demand refresh endpoint:**
```
POST /api/admin/refresh-kb
  → calls resetKBCache()
  → returns { cleared: true, message: "KB cache cleared. Will re-fetch on next request." }
```
Pair with a Google Apps Script `onEdit` trigger on KB docs to auto-call this endpoint whenever a doc is saved.

---

## 6. Quick-Reference: What to Change

### High Priority (do these first — directly affect accuracy)

| What | Current | Target | Where |
|---|---|---|---|
| Chunk size | 600 chars | **1,100 chars** | `lib/drive.ts` L140 |
| Cache key (force re-chunk) | `v2` | **`v3`** | `lib/store.ts` L15 |
| Chat answer topK | 20 | **15** | `app/api/chat/route.ts` L330 |
| Chat IQS topK (webhook) | 5 | **12** | `app/api/webhooks/chat/route.ts` L218, L422 |
| Chat IQS topK (unified) | 5 | **12** | `app/api/call-quality/unified-score/route.ts` L357 |
| Call IQS topK (score-call) | 5 | **10** | `app/api/call-quality/score-call/route.ts` L94 |
| Call IQS topK (link-test) | 5 | **10** | `app/api/call-quality/link-test/route.ts` L200 |
| Call chunk JSON fallback | none | **try/catch + full-transcript fallback** | Wherever CALL_CHUNK_PROMPT is called |

### Medium Priority (quality improvements)

| What | Action |
|---|---|
| IQS search query expansion | Use `expandQuery()` or category keywords before retrieval (mirrors live chat) |
| Header text in body buffer | Add `buffer.push(line.trim())` after breadcrumb update in chunker |
| Stop-word filter | Add `STOPWORDS` set to `retrieveRelevantChunks` |
| KB refresh endpoint | `POST /api/admin/refresh-kb` + Apps Script trigger |
| Call chunk coverage check | Verify all `[N]` segment IDs appear in exactly one chunk |
| Chat transcript trim limit | Raise from 5,000 → 8,000 chars |
| Better kbQuery fallback for calls | Use disposition output, not first 400 chars of transcript |

### Low Priority (nice to have)

| What | Action |
|---|---|
| TF-length normalization | Divide body score by `Math.log(1 + bodyLength / 200)` |
| Extract `scoreChunk()` helper | Eliminate duplicated scoring logic in `retrieveRelevantChunks` + `getTopKBScore` |
| EnergyTone guard (text-only) | Force `EnergyTone = "NA"` when no audio signal available |
| Surface poor_listening_segments | Show flagged call segments in EvalPanel UI |
| Category micro-prompts | One `PROMPT_extract_*.txt` per category (SIP, KYC, Payment, etc.) |
