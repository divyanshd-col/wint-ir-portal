import { query } from '@/lib/cx/db';
import { readConfig, type PortalConfig } from '@/lib/config';
import { getIQSGeminiKeys, callGeminiForCall, geminiGenerate } from '@/lib/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { analyzeCallFromUri, getMimeType } from '@/lib/call-analyzer';
import { getKbContextForScoring } from './engine';
import { GoogleGenAI } from '@google/genai';
import { log } from '@/lib/log';
import { promptOrDefault } from '@/lib/prompt-overrides';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

// ── PROMPT 1: Critical gates pass system prompt ──────────────────────────────
import { CALL_GATES_SYSTEM_PROMPT, CALL_IQS_PASS_SYSTEM_PROMPT } from './prompts/call';
export { CALL_GATES_SYSTEM_PROMPT, CALL_IQS_PASS_SYSTEM_PROMPT };

// ── PROMPT 2: IQS scoring pass system prompt ─────────────────────────────────

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
    let s = scores[param];
    if (typeof s === 'object' && s !== null) {
      s = s.score;
    }
    if (s === 'NA' || s === 'na' || s === null || s === undefined || s === '') continue;
    applicable += weight;
    let numericScore = 0;
    if (s === 2 || s === '2' || s === 'Yes' || s === 'yes' || s === 'PASS' || s === 'pass' || s === true) {
      numericScore = 2;
    } else if (s === 1 || s === '1' || s === 'Part' || s === 'part' || s === 'Half' || s === 'half' || s === 'Partial' || s === 'partial' || s === 0.5 || s === '0.5') {
      numericScore = 1;
    } else if (s === 0 || s === '0' || s === 'No' || s === 'no' || s === 'FAIL' || s === 'fail' || s === false) {
      numericScore = 0;
    } else {
      const parsed = parseFloat(String(s));
      numericScore = isNaN(parsed) ? 0 : parsed;
    }
    earned += weight * (numericScore / 2);
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
export async function runCallPipeline(callId: string, options?: { forceTranscript?: boolean; forceReevaluate?: boolean; skipSlackAlert?: boolean }): Promise<any> {
  log.info('call-pipeline', `Starting pipeline for call ${callId}`);

  // ── Guard: Skip already-reviewed calls unless explicitly forced ──────────────
  const existingEvalRows = await query<any>(
    `SELECT call_id, verdict, iqs_percent, status FROM call_evaluations WHERE call_id = $1`,
    [callId]
  );
  if (existingEvalRows.length && existingEvalRows[0].status === 'reviewed' && !options?.forceTranscript && !options?.forceReevaluate) {
    log.info('call-pipeline', `Call ${callId} is already reviewed (status='reviewed'). Skipping automated pipeline.`);
    return { callId, verdict: existingEvalRows[0].verdict, iqs: existingEvalRows[0].iqs_percent };
  }

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

  const rawTranscript = typeof call.transcript === 'string'
    ? (() => { try { return JSON.parse(call.transcript); } catch { return call.transcript; } })()
    : call.transcript;

  let segments = Array.isArray(rawTranscript)
    ? rawTranscript
    : (rawTranscript && typeof rawTranscript === 'object' && Array.isArray(rawTranscript.segments) ? rawTranscript.segments : []);
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
    let transcriptionSuccess = false;
    let transcriptionError: any;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
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
        transcriptionSuccess = true;
        transcriptionError = null;
        break;
      } catch (err: any) {
        transcriptionError = err;
        log.warn('call-pipeline', `Transcription attempt ${attempt} failed: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
      }
    }

    if (!transcriptionSuccess) {
      const existingSegments = call.transcript ? (Array.isArray(call.transcript) ? call.transcript : call.transcript.segments || []) : [];
      if (existingSegments.length > 0) {
        log.warn('call-pipeline', `Transcription failed (${transcriptionError.message}), falling back to existing transcript with ${existingSegments.length} segments`);
        segments = existingSegments;
        duration = call.duration_seconds || duration;
        language = call.language || language;
      } else {
        await query(`UPDATE call_recordings SET status = 'failed_transcription', updated_at = NOW() WHERE id = $1`, [callId]);
        throw new Error(`Transcription stage failed after 3 attempts: ${transcriptionError.message}`);
      }
    }
  }

  // ── Stage 3: Scoreability Check ────────────────────────────────────────────
  const speechSegments = segments.filter((s: any) => s.type === 'turn' || s.type === 'speech');
  const isSystemOnly = speechSegments.every((s: any) => s.speaker === 'SYSTEM');
  const isPureSilence = speechSegments.length === 0;
  const isJunkCall = Boolean(
    (call.call_disposition && call.call_disposition.toLowerCase().includes('junk')) ||
    (call.call_sub_disposition && call.call_sub_disposition.toLowerCase().includes('junk'))
  );

  if (isSystemOnly || isPureSilence || isJunkCall) {
    log.info('call-pipeline', `Call ${callId} marked as NOT_SCOREABLE (${isJunkCall ? 'junk call' : 'system only or pure silence'})`);
    
    await query(`
      INSERT INTO call_evaluations (
        call_id, chat_id, agent_id, call_sequence_in_thread, scored_at, source,
        call_gate_result, gates, iqs_scores, iqs_percent, applicable_weight, verdict, status
      ) VALUES ($1, $2, $3, 1, NOW(), 'audio', 'PASS', '{}', '{}', null, 0, 'NOT_SCOREABLE', 'reviewed')
      ON CONFLICT (call_id) DO UPDATE SET verdict = 'NOT_SCOREABLE', status = 'reviewed', scored_at = NOW(), iqs_percent = null, applicable_weight = 0
      WHERE call_evaluations.status != 'reviewed'
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
      const raw = typeof c.transcript === 'string'
        ? (() => { try { return JSON.parse(c.transcript); } catch { return c.transcript; } })()
        : c.transcript;
      const segs = Array.isArray(raw) ? raw : (raw?.segments || []);
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
        [{ role: 'user', parts: [{ text: promptOrDefault(config.callGatesPrompt, CALL_GATES_SYSTEM_PROMPT) + '\n\n## SCORER INPUT PAYLOAD\n' + JSON.stringify(payload, null, 2) }] }],
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
        [{ role: 'user', parts: [{ text: promptOrDefault(config.callIqsPrompt, CALL_IQS_PASS_SYSTEM_PROMPT) + '\n\n## SCORER INPUT PAYLOAD\n' + JSON.stringify(payload, null, 2) }] }],
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
    ${options?.forceReevaluate ? '' : "WHERE call_evaluations.status != 'reviewed'"}
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

  const effectiveCallAgentId = call.agent_id ?? call.conv_agent_id ?? null;

  // Update call recording status to scored and populate agent_id if missing
  await query(`
    UPDATE call_recordings
    SET status = 'scored',
        agent_id = COALESCE(agent_id, $2),
        updated_at = NOW()
    WHERE id = $1
  `, [callId, effectiveCallAgentId]);

  log.info('call-pipeline', `Pipeline complete for call ${callId} — IQS ${iqs_percent}% — Verdict: ${finalVer}`);

  // Trigger compliance alert for call if call gate failed (suppressed during QA re-evaluations or if already alerted)
  if (gateVerdict === 'FAIL' && !options?.skipSlackAlert) {
    try {
      // Check if compliance alert was already dispatched for this call in PostgreSQL
      const prevAlert = await query<{ compliance_alerted_at: string | null; status: string | null }>(
        `SELECT compliance_alerted_at, status FROM call_evaluations WHERE call_id = $1`,
        [callId]
      );
      if (prevAlert[0]?.compliance_alerted_at) {
        log.info('call-pipeline', `Skipping duplicate compliance alert for call ${callId} — already alerted at ${prevAlert[0].compliance_alerted_at}`);
      } else if (prevAlert[0]?.status === 'reviewed') {
        // QA already reviewed this call, so the write above was skipped and this AI result was discarded: nothing to alert on.
        log.info('call-pipeline', `Skipping compliance alert for call ${callId} — evaluation already reviewed by QA`);
      } else {
        const { fireQualityAlert, summariseEvidence } = await import('@/lib/quality-alert');
        const { getAgentName } = await import('@/lib/robylon/db');
        const agentId = call.agent_id ?? call.conv_agent_id;
        const agentName = agentId ? await getAgentName(agentId) : '';

        const breaches: Array<{ type: string; quote: string; note: string }> = [];
        const gates = gatesResult.gates || {};
        for (const [gKey, gObj] of Object.entries<any>(gates)) {
          if (gObj?.status === 'fail') {
            const quote = summariseEvidence(gObj.evidence);
            breaches.push({
              type: gKey,
              quote,
              note: gObj.reason_code ? `Reason code: ${gObj.reason_code}` : 'Call gate failure',
            });
          }
        }

        await fireQualityAlert({
          callId: String(callId),
          chatId: call.chat_id ? String(call.chat_id) : undefined,
          channel: 'call',
          agentName,
          scores: {},
          reasoning: {},
          iqs: iqs_percent ?? undefined,
          breaches: breaches.length ? breaches : [{ type: 'CALL_GATE_FAILURE', quote: 'Call compliance gate audit failed' }],
          complianceFlag: true,
        });

        // Mark in database that compliance alert was dispatched for this call
        await query(
          `UPDATE call_evaluations SET compliance_alerted_at = NOW() WHERE call_id = $1 AND compliance_alerted_at IS NULL`,
          [callId]
        );
      }
    } catch (alertErr: any) {
      log.error('call-pipeline', `Failed to fire compliance alert for call ${callId}: ${alertErr.message}`);
    }
  }

  return {
    callId,
    iqs: iqs_percent,
    verdict: finalVer,
    gateVerdict
  };
}
