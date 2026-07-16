import { query } from '@/lib/cx/db';
import { readConfig, type PortalConfig } from '@/lib/config';
import { getIQSGeminiKeys, callGeminiForCall, geminiGenerate } from '@/lib/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { analyzeCallFromUri, getMimeType } from '@/lib/call-analyzer';
import { getKbContextForScoring } from './engine';
import { GoogleGenAI } from '@google/genai';
import { log } from '@/lib/log';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ── PROMPT 1: Critical gates pass system prompt ──────────────────────────────
export const CALL_GATES_SYSTEM_PROMPT = `You are a compliance auditor for Wint Wealth, a SEBI-regulated fixed-income investment platform. You are auditing ONE support call by the IR (support rep, speaker IR_EXECUTIVE) against three critical gates. Gates are tripwires: a gate binds only when its triggering content occurs on the call. If the content never occurs, the gate passes vacuously (status "not_applicable"). Never mark a gate failed merely because its topic was absent.

INPUT
- TRANSCRIPT: numbered turns with speaker roles. Judge ONLY IR_EXECUTIVE turns.
- KB_CONTEXT: the verified knowledge base entries relevant to this call. This is the ONLY source of truth for facts and for tax scope.
- SPEAKER_ID_CONFIDENCE: how confident the upstream system is that roles are correctly assigned. This is informational. Audit as normal at every level.

THE THREE GATES

GATE G1: NO ADVICE
The rep states verified facts only.
Fails if the rep, anywhere on the call:
(a) recommends whether, what, when, or how much to invest ("you should invest", "this is a good time to buy", "I would put it in X"), OR
(b) guarantees or assures returns or safety ("guaranteed", "assured returns", "zero risk", "your money is completely safe, nothing can happen"), OR
(c) interprets tax treatment beyond what KB_CONTEXT states: explains how the customer should treat something in their filing, reasons about deduction rules, rates, or 26AS mechanics not present in KB_CONTEXT, without explicitly escalating.
Reason codes: "advice_investment" for (a)/(b), "advice_tax" for (c).
Not violations: stating verified product facts, reading the KB answer, saying "I cannot advise on that, but factually X", escalating a tax question.
Binding: (a)/(b) can occur on any call. (c) binds only if tax/TDS is discussed.

GATE G2: NO FABRICATED FACTS
Every specific figure, rate, date, or timeline the rep states must trace to KB_CONTEXT or to information present in the call itself (e.g. reading back something the system/customer provided).
Fails if the rep states a specific number, date, rate, or timeline that appears in neither KB_CONTEXT nor the call context. Vague honesty ("I will confirm and get back to you") is NOT a violation and is the correct behaviour.
Binding: any call where the rep states at least one specific claim.

GATE G3: IDENTITY VERIFIED FIRST
No account-specific information (holdings, amounts, dates of the customer's own transactions, KYC status, bank details) disclosed before an identity verification exchange (registered mobile, email, PAN, DOB, or explicit name confirmation) occurs earlier in turn order.
Binding: only calls where account-specific information is disclosed. General product questions pass vacuously.

RULES
- Cite the exact turn index for every finding.
- When a claim is ambiguous between fact and advice, quote it and mark "borderline": true rather than failing the gate. Borderline items route to human review, they do not fail the call.
- Judge the rep's words, never the customer's.
- Do not evaluate anything else about call quality. Gates only.

OUTPUT: return ONLY this JSON, no other text, no markdown fences:
{
  "gates": {
    "G1_no_advice": {
      "status": "pass" | "fail" | "not_applicable",
      "reason_code": "advice_investment" | "advice_tax" | null,
      "evidence": [{ "turn": 0, "quote": "...", "why": "..." }],
      "borderline": []
    },
    "G2_no_fabrication": {
      "status": "pass" | "fail" | "not_applicable",
      "evidence": [],
      "borderline": []
    },
    "G3_identity_first": {
      "status": "pass" | "fail" | "not_applicable",
      "evidence": [],
      "borderline": []
    }
  },
  "call_gate_result": "PASS" | "FAIL",
  "kb_gaps": [ "topics the rep was asked about that KB_CONTEXT does not cover" ]
}`;

// ── PROMPT 2: IQS scoring pass system prompt ─────────────────────────────────
export const CALL_IQS_PASS_SYSTEM_PROMPT = `You are a QA evaluator for Wint Wealth customer support calls. Score ONE call on 10 parameters. Judge only the IR_EXECUTIVE. Score each parameter exactly 0 (not met), 1 (partially met), 2 (fully met), or "NA" where the parameter's NA condition applies. Cite turn indices as evidence for every score.

PARAMETER ISOLATION: score each parameter on its own definition only. A call can be excellent on one parameter and poor on another. Never let one parameter influence another.

INPUTS
- TRANSCRIPT: numbered turns with roles and per-segment tone fields.
- STRUCTURE_EVENTS: silences (typed) and overlaps with turn positions.
- TONE_SUMMARY: aggregated audio signals (null on transcript-only calls).
- KB_CONTEXT: verified knowledge base entries (source of truth for P1).
- CHAT_CONTEXT: the originating chat messages sent BEFORE this call started, with timestamps, or null for direct calls with no chat.
- PRIOR_CALL_TRANSCRIPTS: transcripts of earlier calls on this same thread, empty if this is the first or only call.
- FILLER_COUNT_IR and IR_WORD_COUNT: precomputed.
- SPEAKER_ID_CONFIDENCE: informational only. Score as normal at every level.

THE 10 PARAMETERS

P1 FACTUAL CORRECTNESS
Every substantive answer matches KB_CONTEXT.
2 = all claims correct. 1 = minor imprecision, no material impact.
0 = any materially wrong answer.
NA = KB_CONTEXT has no entry covering the topics answered. When NA, list the uncovered topics in "kb_gaps". A KB gap is never scored against the rep.

P2 ALL QUESTIONS ADDRESSED
Every query the customer raised got an answer or an explicit committed action before the call ended. First enumerate every distinct customer question or issue (calls are often multi-topic). An issue handled by struggling through an evident language barrier, instead of offering a language-matched callback, counts as partially addressed.
2 = all addressed. 1 = exactly one dropped or only-partially addressed. 0 = more than one dropped.

P3 EXPECTATION SETTING AND FOLLOW-UP SPECIFICITY
Every open (unresolved on call) item leaves with a concrete what-happens-next: a specific timeline or TAT and, where relevant, a named owner ("our finance team will contact you by Friday"). Vague assurances ("soon", "shortly", "someone will look into it") are not specific.
2 = all open items have specific commitments. 1 = commitments exist but vague, or one open item lacks one. 0 = open items left with nothing.
NA = the call had no open items (everything resolved live).

P5 CALL OPENING
Statement-form self-introduction with the rep's name AND "Wint Wealth" within the first few IR turns. A bare "Hello?" and waiting is a miss.
2 = name + brand as a statement early. 1 = partial (brand without name, or late). 0 = no proper introduction.

P6 CALL CLOSING
Final IR turns: summarise outcome and next steps, ask if anything else is needed, close with a greeting. The summary matters most.
2 = summary + anything-else + greeting. 1 = greeting without summary or anything-else. 0 = abrupt or no close.
NA = customer hung up mid-call or call cut (evident from transcript end).

P7 PRE-CHECK, NO REPEAT ASKS
The rep does not make the customer repeat information already available. "Already available" means: stated earlier on THIS call, stated in CHAT_CONTEXT, or stated on any call in PRIOR_CALL_TRANSCRIPTS.
If CHAT_CONTEXT is null and PRIOR_CALL_TRANSCRIPTS is empty: check same-call repeats only.
2 = no repeat asks. 1 = one repeat ask. 0 = multiple.

P8 SIMPLIFYING AND JARGON HANDLING
Financial terms (TDS, YTM, senior secured, record date, DDPI, etc.) are explained in plain language, or an elaboration offer is made. Calibrate to the customer: if the customer demonstrably knows the terms (uses them fluently, corrects the rep), over-explaining scores 1, not 2.
2 = jargon matched to customer level. 1 = some unexplained jargon or mismatched depth. 0 = heavy unexplained jargon to an evidently confused customer.
NA = no financial jargon occurred on the call.

P9 ACTIVE LISTENING AND INTERRUPTIONS
Three signals: (a) IR-initiated overlaps from STRUCTURE_EVENTS, (b) repeat-forced moments where the customer restates something just said because the rep missed it, (c) acknowledgement of the customer's concern before answering (supported by segment empathy where available).
2 = zero IR interruptions AND no repeat-forced moments AND acknowledgement present. 1 = one to two IR interruptions OR one repeat-forced moment OR weak acknowledgement. 0 = habitual talk-over or no acknowledgement on a frustrated call.

P10 FILLERS AND DEAD AIR
Use FILLER_COUNT_IR / (IR_WORD_COUNT/150) as fillers-per-minute-equivalent, and dead_air events from STRUCTURE_EVENTS. A silence announced by the rep ("please stay on the line, I am checking") is a hold, never penalised. Only silence_type "dead_air" counts.
2 = filler rate under ~1/min AND zero dead_air events.
1 = moderate (rate under ~3/min, or one short dead_air).
0 = heavy fillers or repeated unexplained dead air.

P11 ENERGY, WARMTH, AND PACE [audio-derived]
From TONE_SUMMARY:
2 = executive_avg_confidence >= 7 AND executive_avg_empathy >= 7 AND talk_speed mostly normal AND sentiment trend not declining.
1 = either signal in the 4-6 band or mixed speed.
0 = either below 4, or sustained fast speed with a declining IR sentiment trend.
NA = TONE_SUMMARY is null (transcript-only call). Never infer tone from text.

ALSO EXTRACT (does not affect scores)
breach_mentions: every customer statement implying a previously promised action was not done ("I was told this would be resolved last week"). If PRIOR_CALL_TRANSCRIPTS is present, also check whether the broken promise matches a specific commitment made on a prior call and cite that prior call's turn where found.

OUTPUT: return ONLY this JSON, no other text, no markdown fences:
{
  "scores": {
    "P1": 0|1|2|"NA",
    "P2": 0|1|2|"NA",
    "P3": 0|1|2|"NA",
    "P5": 0|1|2|"NA",
    "P6": 0|1|2|"NA",
    "P7": 0|1|2|"NA",
    "P8": 0|1|2|"NA",
    "P9": 0|1|2|"NA",
    "P10": 0|1|2|"NA",
    "P11": 0|1|2|"NA"
  },
  "evidence": {
    "P1": [{ "turn": 0, "note": "..." }],
    "P2": [{ "turn": 0, "note": "..." }],
    "P3": [{ "turn": 0, "note": "..." }],
    "P5": [{ "turn": 0, "note": "..." }],
    "P6": [{ "turn": 0, "note": "..." }],
    "P7": [{ "turn": 0, "note": "..." }],
    "P8": [{ "turn": 0, "note": "..." }],
    "P9": [{ "turn": 0, "note": "..." }],
    "P10": [{ "turn": 0, "note": "..." }],
    "P11": [{ "turn": 0, "note": "..." }]
  },
  "kb_gaps": [],
  "customer_questions": [ { "question": "...", "addressed": true, "turn": 0 } ],
  "open_items": [ { "item": "...", "commitment": "..." | null, "specific": true } ],
  "breach_mentions": [ { "turn": 0, "quote": "...", "matched_prior_commitment": "call_id:turn | null" } ],
  "summary": "2-3 sentence coaching-oriented summary of the call"
}`;

// Parameter weights for call IQS
export const CALL_IQS_WEIGHTS: Record<string, number> = {
  P1: 20, // Factual correctness
  P2: 15, // All questions addressed
  P3: 15, // Expectation setting & follow-up specificity
  P5: 5,  // Call opening
  P6: 5,  // Call closing
  P7: 5,  // Pre-check, no repeat asks
  P8: 8,  // Simplifying & jargon
  P9: 9,  // Active listening & interruptions
  P10: 6, // Fillers & dead air
  P11: 12 // Energy, warmth, pace (audio)
};

export function computeCallIQS(scores: Record<string, any>) {
  let earned = 0;
  let applicable = 0;
  for (const [param, weight] of Object.entries(CALL_IQS_WEIGHTS)) {
    const s = scores[param];
    if (s === 'NA' || s === null || s === undefined) continue;
    applicable += weight;
    const numericScore = typeof s === 'string' ? parseFloat(s) : s;
    earned += weight * (numericScore / 2); // s is 0, 1, or 2
  }
  return {
    iqs_percent: applicable === 0 ? null : Math.round((earned / applicable) * 100),
    applicable_weight: applicable
  };
}

export function finalVerdict(gateResult: string, iqsPercent: number | null) {
  if (gateResult === 'FAIL') {
    return 'FAILED_CRITICAL';
  }
  if (iqsPercent === null) {
    return 'NOT_SCOREABLE';
  }
  if (iqsPercent >= 90) return 'excellent';
  if (iqsPercent >= 75) return 'meets_expectations';
  if (iqsPercent >= 60) return 'coaching';
  return 'remediation';
}

function repairTruncatedJson(cleaned: string): any | null {
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  const s = cleaned.slice(start);

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastComplete = -1;
  let stackAtLastComplete: string[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{' || c === '[') {
      stack.push(c);
    } else if (c === '}' || c === ']') {
      if (stack.length === 0) return null;
      stack.pop();
      if (stack.length > 0 && stack.length <= 3) {
        lastComplete = i + 1;
        stackAtLastComplete = stack.slice();
      }
    }
  }

  if (lastComplete < 0) return null;
  const closers = stackAtLastComplete
    .slice()
    .reverse()
    .map(b => (b === '{' ? '}' : ']'))
    .join('');
  try {
    return JSON.parse(s.slice(0, lastComplete) + closers);
  } catch {
    return null;
  }
}

function robustJsonParse(raw: string): any {
  if (!raw?.trim()) return null;
  let s = raw.trim();
  const block = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (block) s = block[1].trim();

  try { return JSON.parse(s); } catch {}

  const oa = s.indexOf('{'), ob = s.lastIndexOf('}');
  if (oa >= 0 && ob > oa) {
    try { return JSON.parse(s.slice(oa, ob + 1)); } catch {}
  }

  const repaired = repairTruncatedJson(s);
  if (repaired !== null) {
    console.warn('[Gemini] JSON output was truncated — salvaged the complete portion');
    return repaired;
  }

  console.error('❌ JSON parsing failed. Full raw response was:', raw);
  throw new Error(`Failed to parse LLM response as JSON: ${raw.slice(0, 300)}`);
}

/**
 * Downloads audio from the given URL and uploads it to the Gemini File API.
 * Returns the Gemini file URI.
 */
function detectMimeType(buffer: Buffer, fallbackUrl: string): { mimeType: string; extension: string } {
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return { mimeType: 'audio/mpeg', extension: '.mp3' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
    return { mimeType: 'audio/mpeg', extension: '.mp3' };
  }
  if (buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // RIFF
      buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) { // WAVE
    return { mimeType: 'audio/wav', extension: '.wav' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x66 && buffer[1] === 0x4c && buffer[2] === 0x61 && buffer[3] === 0x43) { // fLaC
    return { mimeType: 'audio/flac', extension: '.flac' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) { // OggS
    return { mimeType: 'audio/ogg', extension: '.ogg' };
  }
  
  const ext = fallbackUrl.split('.').pop()?.toLowerCase() ?? '';
  const MIME_MAP: Record<string, string> = {
    mp3:  'audio/mpeg',
    wav:  'audio/wav',
    m4a:  'audio/mp4',
    ogg:  'audio/ogg',
    flac: 'audio/flac',
  };
  return { mimeType: MIME_MAP[ext] ?? 'audio/mpeg', extension: ext ? `.${ext}` : '.mp3' };
}

/**
 * Downloads audio from the given URL and uploads it to the Gemini File API.
 * Returns the Gemini file URI.
 */
async function downloadAndUploadAudio(recordingUrl: string, apiKey: string): Promise<{ fileUri: string; mimeType: string; buffer: Buffer }> {
  const audioRes = await fetch(recordingUrl);
  if (!audioRes.ok) {
    throw new Error(`Failed to download audio from ${recordingUrl}: HTTP ${audioRes.status}`);
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const { mimeType, extension } = detectMimeType(buffer, recordingUrl);

  const tempDir = os.tmpdir();
  const tempFileName = `pipeline-audio-${randomUUID()}${extension}`;
  const tempFilePath = path.join(tempDir, tempFileName);

  await fs.writeFile(tempFilePath, buffer);

  const ai = new GoogleGenAI({ apiKey });
  try {
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType }
    });
    if (!uploadResult.uri) {
      throw new Error('Gemini File upload did not return a URI');
    }
    return { fileUri: uploadResult.uri, mimeType, buffer };
  } finally {
    try { await fs.unlink(tempFilePath); } catch {}
  }
}

/**
 * Full implementation of the 5-stage Call Evaluation Pipeline.
 */
export async function runCallPipeline(callId: string, options?: { forceTranscript?: boolean }): Promise<any> {
  log.info('call-pipeline', `Starting pipeline for call ${callId}`);

  // Fetch the call recording row
  const rows = await query(`
    SELECT cr.*, conv.id as linked_chat_id, conv.closed_at as chat_closed_at, conv.tags as chat_tags, conv.agent_id as conv_agent_id
    FROM call_recordings cr
    LEFT JOIN conversations conv ON conv.id = cr.chat_id
    WHERE cr.id = $1
  `, [callId]);

  if (!rows.length) {
    throw new Error(`Call recording ${callId} not found`);
  }

  const call = rows[0];
  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    throw new Error('No Gemini key configured');
  }
  const apiKey = geminiKeys[0];

  let segments = call.transcript ? (Array.isArray(call.transcript) ? call.transcript : call.transcript.segments || []) : [];
  let duration = call.duration_seconds;
  let language = call.language || 'English';
  let status = call.status;
  let speakerIdConfidence = 'low';

  // ── Stage 1 & 2: Structural Analysis & Transcription ──────────────────────
  const forceTranscript = options?.forceTranscript ?? false;
  if (forceTranscript || !segments || segments.length === 0 || status === 'received' || status === 'stored') {
    if (!call.recording_url) {
      throw new Error(`No recording URL or transcript for call ${callId}`);
    }

    log.info('call-pipeline', `Running Pass 1 & 2 analysis on audio for call ${callId}`);
    try {
      const { fileUri, mimeType, buffer } = await downloadAndUploadAudio(call.recording_url, apiKey);
      
      let pyannoteUri: string | undefined = undefined;
      const pyKey = config.pyannoteApiKey || process.env.PYANNOTE_API_KEY || '';
      if (pyKey) {
        log.info('call-pipeline', `Uploading audio bytes to Pyannote storage for diarization...`);
        try {
          const { getPyannoteUploadUrl } = await import('@/lib/pyannote');
          const pyUpload = await getPyannoteUploadUrl(pyKey);
          await fetch(pyUpload.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': mimeType },
            body: new Uint8Array(buffer)
          });
          pyannoteUri = pyUpload.pyannoteUri;
          log.info('call-pipeline', `Successfully uploaded to Pyannote: ${pyannoteUri}`);
        } catch (err: any) {
          log.warn('call-pipeline', `Failed to upload to Pyannote storage, falling back to direct URL: ${err.message}`);
        }
      }

      const analysis = await analyzeCallFromUri({
        fileUri,
        recordingUrl: call.recording_url,
        pyannoteUri,
        fileName: `call_${callId}${mimeType === 'audio/mpeg' ? '.mp3' : '.wav'}`,
        mimeType,
        apiKey
      });

      segments = analysis.segments || [];
      duration = analysis.duration_seconds;
      language = analysis.detected_language;
      speakerIdConfidence = analysis.speaker_identification_confidence || 'low';
      
      const intCount = segments.filter((s: any) => s.type === 'interruption').length;
      const daCount = segments.filter((s: any) => s.type === 'dead_air').length;

      // Update call recordings table
      await query(`
        UPDATE call_recordings
        SET transcript = $1, duration_seconds = $2, language = $3,
            interruption_count = $4, dead_air_count = $5, status = 'transcribed', updated_at = NOW()
        WHERE id = $6
      `, [JSON.stringify(segments), Math.round(duration), language, intCount, daCount, callId]);
      
      status = 'transcribed';
    } catch (err: any) {
      await query(`UPDATE call_recordings SET status = 'failed_transcription', updated_at = NOW() WHERE id = $1`, [callId]);
      throw new Error(`Transcription stage failed: ${err.message}`);
    }
  }

  // ── Stage 3: Scoreability Check ────────────────────────────────────────────
  const speechSegments = segments.filter((s: any) => s.type === 'turn' || s.type === 'speech');
  const isSystemOnly = speechSegments.every((s: any) => s.speaker === 'SYSTEM');
  const isPureSilence = speechSegments.length === 0;

  if (isSystemOnly || isPureSilence) {
    log.info('call-pipeline', `Call ${callId} marked as NOT_SCOREABLE (system only or pure silence)`);
    
    await query(`
      INSERT INTO call_evaluations (
        call_id, chat_id, agent_id, call_sequence_in_thread, scored_at, source,
        call_gate_result, gates, iqs_scores, iqs_percent, applicable_weight, verdict, status
      ) VALUES ($1, $2, $3, 1, NOW(), 'audio', 'PASS', '{}', '{}', null, 0, 'NOT_SCOREABLE', 'reviewed')
      ON CONFLICT (call_id) DO UPDATE SET verdict = 'NOT_SCOREABLE', status = 'reviewed', scored_at = NOW()
    `, [callId, call.chat_id, call.agent_id]);

    await query(`UPDATE call_recordings SET status = 'scored', updated_at = NOW() WHERE id = $1`, [callId]);
    return { callId, verdict: 'NOT_SCOREABLE', iqs: null };
  }

  // ── Stage 3b: Context Assembly ─────────────────────────────────────────────
  let chatContext: any[] | null = null;
  let priorCallTranscripts: any[] = [];
  let contextTruncated = false;

  if (call.chat_id) {
    // Scenario B: Chat-initiated call. Include chat messages before call.called_at.
    const convRows = await query(`SELECT transcript, started_at FROM conversations WHERE id = $1`, [call.chat_id]);
    if (convRows.length && convRows[0].transcript) {
      const conv = convRows[0];
      const messages = Array.isArray(conv.transcript) ? conv.transcript : conv.transcript.messages || [];
      const callTime = call.called_at ? new Date(call.called_at).getTime() : Date.now();

      const chatBefore = messages
        .filter((m: any) => {
          if (!m.timestamp) return true;
          return new Date(m.timestamp).getTime() < callTime;
        })
        .map((m: any) => ({
          ts: m.timestamp || '',
          from: m.sender_type || m.sender_name || 'rep',
          text: m.content || m.text || ''
        }));
      
      if (chatBefore.length > 0) {
        chatContext = chatBefore;
      }
    }

    // Scenario C: Prior call transcripts.
    const priorCalls = await query(`
      SELECT id, called_at, transcript
      FROM call_recordings
      WHERE chat_id = $1 AND called_at < $2 AND transcript IS NOT NULL AND status = 'scored'
      ORDER BY called_at ASC
    `, [call.chat_id, call.called_at || new Date().toISOString()]);

    priorCallTranscripts = priorCalls.map((c: any) => {
      const segs = Array.isArray(c.transcript) ? c.transcript : c.transcript.segments || [];
      const lines = segs
        .filter((s: any) => s.type === 'speech' || s.type === 'turn')
        .map((s: any) => `[${s.speaker}]: ${s.text || ''}`);

      return {
        call_id: c.id,
        started: c.called_at,
        transcript: lines.join('\n')
      };
    });

    // Size Guard: Truncate context if it exceeds model's practical budget (~50k characters)
    let totalContextLen = JSON.stringify(chatContext || []).length + JSON.stringify(priorCallTranscripts).length;
    while (totalContextLen > 50000 && priorCallTranscripts.length > 0) {
      priorCallTranscripts.shift(); // drop oldest first
      totalContextLen = JSON.stringify(chatContext || []).length + JSON.stringify(priorCallTranscripts).length;
      contextTruncated = true;
    }
  }

  // Precomputes in code
  const irTurns = speechSegments.filter((s: any) => s.speaker === 'IR_EXECUTIVE');
  const irTextCombined = irTurns.map((s: any) => s.text || '').join(' ');
  const irWordCount = irTextCombined.split(/\s+/).filter(Boolean).length;
  
  // Fillers regex count (uh/um/umm/aaa/haan variants)
  const fillerRegex = /\b(uh|um|umm|aaa|haan|ah|eh|er)\b/ig;
  const fillerCount = (irTextCombined.match(fillerRegex) || []).length;

  // Structure events mapping
  const structureEvents = segments
    .filter((s: any) => s.type === 'silence' || s.type === 'overlap')
    .map((s: any) => {
      if (s.type === 'silence') {
        return {
          type: 'silence',
          duration: s.duration,
          silence_type: s.silence_type || 'dead_air'
        };
      }
      return {
        type: 'overlap',
        interruption_by: s.interruption_by || s.interrupted_by || 'IR_EXECUTIVE'
      };
    });

  // Tone summary computation
  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const execTurns = segments.filter((s: any) => (s.speaker === 'IR_EXECUTIVE' || s.speaker === 'IR EXECUTIVE') && s.type === 'turn');
  const toneSummary = {
    executive_avg_confidence: avg(execTurns.map((s: any) => s.confidence || s.tone?.confidence || 0)),
    executive_avg_empathy: avg(execTurns.map((s: any) => s.empathy || s.tone?.empathy || 0)),
    executive_sentiment_trend: 'stable',
    talk_speed_distribution: {
      slow: execTurns.filter((s: any) => s.talk_speed === 'slow').length,
      normal: execTurns.filter((s: any) => s.talk_speed === 'normal' || !s.talk_speed).length,
      fast: execTurns.filter((s: any) => s.talk_speed === 'fast').length
    },
    dead_air_events: segments.filter((s: any) => s.type === 'silence' && s.silence_type === 'dead_air').length,
    ir_interruptions: segments.filter((s: any) => s.type === 'overlap' && (s.interruption_by === 'IR_EXECUTIVE' || s.interrupted_by === 'IR EXECUTIVE')).length
  };

  // KB context lookup
  let kbContext = '';
  const callDispo = call.call_disposition || (call.chat_tags as any)?.disposition || '';
  const callSubDispo = call.call_sub_disposition || (call.chat_tags as any)?.sub_disposition || '';
  const callTextCombined = speechSegments.map((s: any) => `[${s.speaker}]: ${s.text || ''}`).join('\n');
  
  try {
    kbContext = await getKbContextForScoring(callDispo, callSubDispo, callTextCombined, config, false);
  } catch (err: any) {
    log.warn('call-pipeline', `KB context lookup failed: ${err.message}`);
  }

  // Format transcript segments for scorer payload
  const formattedTranscript = speechSegments.map((s: any, idx: number) => ({
    index: idx + 1,
    speaker: s.speaker === 'IR_EXECUTIVE' || s.speaker === 'IR EXECUTIVE' ? 'IR_EXECUTIVE' : 'INVESTOR',
    start: s.start || 0,
    end: s.end || 0,
    text: s.text || '',
    translated: s.translated || false,
    sentiment: s.sentiment || 'neutral',
    aggression: s.aggression || 0,
    confidence: s.confidence || null,
    empathy: s.empathy || null,
    talk_speed: s.talk_speed || 'normal'
  }));

  // Construct standard payload injected into both prompts
  const payload = {
    call_id: callId,
    thread_id: call.chat_id,
    call_sequence_in_thread: 1,
    source: 'audio',
    duration_seconds: duration,
    speaker_id_confidence: speakerIdConfidence,
    transcript: formattedTranscript,
    structure_events: structureEvents,
    tone_summary: toneSummary,
    kb_context: kbContext || null,
    chat_context: chatContext,
    prior_call_transcripts: priorCallTranscripts,
    context_truncated: contextTruncated,
    filler_count_ir: fillerCount,
    ir_word_count: irWordCount
  };

  // ── Stage 4a: Prompt 1 (Critical gates pass) ───────────────────────────────
  log.info('call-pipeline', `Running Prompt 1 compliance gates for call ${callId}`);
  let gatesResult: any;
  let gatesError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rawGates = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_GATES_SYSTEM_PROMPT + '\n\n## SCORER INPUT PAYLOAD\n' + JSON.stringify(payload, null, 2) }] }],
        undefined,
        300_000
      );
      gatesResult = robustJsonParse(rawGates);
      gatesError = null;
      break;
    } catch (err: any) {
      gatesError = err;
      log.warn('call-pipeline', `Prompt 1 attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (gatesError) {
    await query(`UPDATE call_recordings SET status = 'failed_gates', updated_at = NOW() WHERE id = $1`, [callId]);
    throw new Error(`Compliance gates Prompt 1 failed after 3 attempts: ${gatesError.message}`);
  }

  // ── Stage 4b: Prompt 2 (IQS scoring pass) ───────────────────────────────────
  log.info('call-pipeline', `Running Prompt 2 parameters scoring for call ${callId}`);
  let scoresResult: any;
  let scoresError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const rawScores = await callGeminiForCall(
        geminiKeys,
        [{ role: 'user', parts: [{ text: CALL_IQS_PASS_SYSTEM_PROMPT + '\n\n## SCORER INPUT PAYLOAD\n' + JSON.stringify(payload, null, 2) }] }],
        undefined,
        300_000
      );
      scoresResult = robustJsonParse(rawScores);
      scoresError = null;
      break;
    } catch (err: any) {
      scoresError = err;
      log.warn('call-pipeline', `Prompt 2 attempt ${attempt} failed: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (scoresError) {
    await query(`UPDATE call_recordings SET status = 'failed_scoring', updated_at = NOW() WHERE id = $1`, [callId]);
    throw new Error(`Scoring Prompt 2 failed after 3 attempts: ${scoresError.message}`);
  }

  // ── Stage 5: Compute + Persist ─────────────────────────────────────────────
  log.info('call-pipeline', `Persisting results for call ${callId}`);
  
  const gateVerdict = gatesResult.call_gate_result || 'PASS';
  const { iqs_percent, applicable_weight } = computeCallIQS(scoresResult.scores || {});
  const finalVer = finalVerdict(gateVerdict, iqs_percent);

  // Write evaluation record
  await query(`
    INSERT INTO call_evaluations (
      call_id, chat_id, agent_id, call_sequence_in_thread, scored_at,
      gates_prompt_version, iqs_prompt_version, source, speaker_id_confidence, context_truncated,
      call_gate_result, gates, iqs_scores, iqs_percent, applicable_weight, verdict,
      kb_gaps, breach_mentions, borderline_items, status
    ) VALUES ($1, $2, $3, $4, NOW(), 'v3.1', 'v3.1', 'audio', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
    ON CONFLICT (call_id) DO UPDATE SET
      chat_id = EXCLUDED.chat_id,
      agent_id = EXCLUDED.agent_id,
      scored_at = NOW(),
      source = EXCLUDED.source,
      speaker_id_confidence = EXCLUDED.speaker_id_confidence,
      context_truncated = EXCLUDED.context_truncated,
      call_gate_result = EXCLUDED.call_gate_result,
      gates = EXCLUDED.gates,
      iqs_scores = EXCLUDED.iqs_scores,
      iqs_percent = EXCLUDED.iqs_percent,
      applicable_weight = EXCLUDED.applicable_weight,
      verdict = EXCLUDED.verdict,
      kb_gaps = EXCLUDED.kb_gaps,
      breach_mentions = EXCLUDED.breach_mentions,
      borderline_items = EXCLUDED.borderline_items,
      status = 'pending'
  `, [
    callId,
    call.chat_id,
    call.agent_id ?? call.conv_agent_id ?? null,
    1, // call_sequence_in_thread
    speakerIdConfidence,
    contextTruncated,
    gateVerdict,
    JSON.stringify(gatesResult.gates || {}),
    JSON.stringify(scoresResult),
    iqs_percent,
    applicable_weight,
    finalVer,
    JSON.stringify(gatesResult.kb_gaps || scoresResult.kb_gaps || []),
    JSON.stringify(scoresResult.breach_mentions || []),
    JSON.stringify(gatesResult.borderline || [])
  ]);

  // Update call recording status to scored and populate agent_id if missing
  await query(`
    UPDATE call_recordings
    SET status = 'scored',
        agent_id = COALESCE(agent_id, $2),
        updated_at = NOW()
    WHERE id = $1
  `, [callId, call.conv_agent_id ?? null]);

  log.info('call-pipeline', `Pipeline complete for call ${callId} — IQS ${iqs_percent}% — Verdict: ${finalVer}`);
  return {
    callId,
    iqs: iqs_percent,
    verdict: finalVer,
    gateVerdict
  };
}
