import { getPyannoteUploadUrl, diarizeAudioWithPyannote, type PyannoteSegment } from '@/lib/pyannote';
import { geminiGenerate } from '@/lib/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { log } from '@/lib/log';

const ROUTE = 'pcg-speaker-diarization';

export interface PcgTranscriptTurn {
  speaker: 'RM' | 'Customer';
  text: string;
  time: string;
  turnIndex: number;
  speakerId?: string;
}

export interface PyannoteTimelineResult {
  speakerIds: string[];
  mergedSegments: Array<{ speaker: string; start: number; end: number }>;
  timelineText: string;
  rawSegmentCount: number;
  durationSeconds: number;
}

export interface SpeakerVerificationResult {
  turns: PcgTranscriptTurn[];
  swapped: boolean;
  method: 'deterministic' | 'llm_sanity_check' | 'none';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function formatMmSs(totalSecs: number): string {
  const safe = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Merges consecutive Pyannote segments belonging to the same speaker separated by small pauses
 * so Gemini receives a clean, compact acoustic timeline.
 */
export function buildPyannoteTimeline(
  rawSegments: PyannoteSegment[],
  maxLines = 220
): PyannoteTimelineResult | null {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) return null;

  const sorted = [...rawSegments]
    .filter((s) => s && typeof s.start === 'number' && typeof s.end === 'number' && s.speaker)
    .sort((a, b) => a.start - b.start);

  if (sorted.length === 0) return null;

  const mergeWithGap = (gapSec: number) => {
    const merged: Array<{ speaker: string; start: number; end: number }> = [];
    for (const seg of sorted) {
      const prev = merged[merged.length - 1];
      if (prev && prev.speaker === seg.speaker && seg.start - prev.end <= gapSec) {
        prev.end = Math.max(prev.end, seg.end);
      } else {
        merged.push({ speaker: seg.speaker, start: seg.start, end: seg.end });
      }
    }
    return merged;
  };

  let mergedSegments = mergeWithGap(0.8);
  if (mergedSegments.length > maxLines) {
    mergedSegments = mergeWithGap(1.6);
  }
  if (mergedSegments.length > maxLines) {
    mergedSegments = mergeWithGap(3.0);
  }

  const speakerIds = Array.from(new Set(mergedSegments.map((s) => s.speaker)));
  const durationSeconds = Math.max(...mergedSegments.map((s) => s.end), 0);
  const timelineText = mergedSegments
    .map((s) => `[${formatMmSs(s.start)} - ${formatMmSs(s.end)}] ${s.speaker}`)
    .join('\n');

  return {
    speakerIds,
    mergedSegments,
    timelineText,
    rawSegmentCount: sorted.length,
    durationSeconds,
  };
}

// Short in-memory circuit breaker when Pyannote returns 401/402 (no credits / auth error)
// so batch cron jobs don't waste round-trips on every call, while self-healing automatically once topped up.
let pyannotePausedUntilMs = 0;
const PYANNOTE_AUTH_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * Uploads an audio buffer to Pyannote temporary storage and runs Pyannote `precision-2` diarization.
 * Strictly bounded (30s upload timeout, 90s diarization cap) and never throws — returns `null` on failure
 * so the pipeline can gracefully fall back to metadata-anchored Gemini diarization.
 */
export async function runPyannoteForPcgBuffer(
  buffer: Buffer,
  mimeType: string,
  pyannoteApiKey: string | undefined,
  callId: string
): Promise<PyannoteTimelineResult | null> {
  const key = (pyannoteApiKey || '').trim();
  if (!key) {
    log.info(ROUTE, `Pyannote API key not configured; skipping Pass 1 diarization for call ${callId}.`);
    return null;
  }
  if (Date.now() < pyannotePausedUntilMs) {
    log.info(ROUTE, `Pyannote temporarily paused due to recent 401/402 credit/auth response; using Gemini-only diarization for call ${callId}.`);
    return null;
  }

  try {
    log.info(ROUTE, `Uploading audio (${buffer.length} bytes) to Pyannote storage for PCG call ${callId}...`);
    const { pyannoteUri, uploadUrl } = await getPyannoteUploadUrl(key);

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType || 'audio/aac' },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploadRes.ok) {
      throw new Error(`Pyannote audio upload failed (HTTP ${uploadRes.status})`);
    }

    const segments = await diarizeAudioWithPyannote(pyannoteUri, key, undefined, {
      entityId: callId,
      maxWaitMs: 90_000,
    });

    const timeline = buildPyannoteTimeline(segments);
    if (!timeline) {
      log.warn(ROUTE, `Pyannote returned 0 segments for call ${callId}; falling back to Gemini-only diarization.`);
      return null;
    }

    log.info(
      ROUTE,
      `Pyannote precision-2 succeeded for PCG call ${callId}: ${timeline.speakerIds.length} speaker(s), ${timeline.rawSegmentCount} raw -> ${timeline.mergedSegments.length} merged segments.`
    );
    return timeline;
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('(402)') || msg.includes('(401)') || msg.toLowerCase().includes('no credit')) {
      pyannotePausedUntilMs = Date.now() + PYANNOTE_AUTH_COOLDOWN_MS;
    }
    log.warn(ROUTE, `Pyannote diarization failed for PCG call ${callId} (${msg}); falling back to Gemini-only diarization.`);
    return null;
  }
}

/**
 * Builds the metadata-anchored transcription & diarization prompt for PCG calls.
 * When a Pyannote timeline is provided, Gemini follows Pyannote's acoustic speaker IDs
 * and maps each speaker ID globally to "RM" or "Customer" using the RM's name, call direction,
 * and full conversation context.
 */
export function buildPcgDiarizationPrompt(opts: {
  formattedDuration: string;
  durationSeconds: number;
  rmName: string;
  callType?: string | null;
  pyannoteTimeline?: PyannoteTimelineResult | null;
}): string {
  const { formattedDuration, durationSeconds, rmName, callType, pyannoteTimeline } = opts;
  const cleanRm = (rmName || 'Wint Wealth RM').trim();
  const rmFirstName = cleanRm.split(/\s+/)[0] || cleanRm;

  const lowerType = String(callType || '').toLowerCase();
  const directionHint = lowerType.includes('incoming')
    ? 'INCOMING (the investor called the RM; the RM typically answers as Wint Wealth)'
    : lowerType.includes('outgoing')
      ? 'OUTGOING (the RM dialed the investor; the investor typically answers "Hello?" first, and the RM introduces themselves as calling from Wint Wealth)'
      : 'UNKNOWN (determine from who introduces themselves as Wint Wealth / provides platform servicing vs who is the investor)';

  const pyannoteSection = pyannoteTimeline
    ? `
ACOUSTIC SPEAKER DIARIZATION TIMELINE (from Pyannote precision-2):
The audio has already been acoustically diarized into distinct voice IDs (${pyannoteTimeline.speakerIds.join(', ')}).
${pyannoteTimeline.timelineText}

CRITICAL SPEAKER-MAPPING RULES (USING PYANNOTE TIMELINE):
1. Respect Pyannote's acoustic voice boundaries (${pyannoteTimeline.speakerIds.join(', ')}) so speakers NEVER drift, merge, or flip mid-call.
2. Listen to the ENTIRE call first to determine globally which Pyannote voice ID is the Wint Wealth RM ("${cleanRm}") and which voice ID is the Investor ("Customer"):
   - The voice that introduces themselves as "${rmFirstName}" / "${cleanRm}" or "calling from Wint Wealth", checks KYC/Demat/ops, or pitches/explains Wint Wealth bonds/FDs/13% Club is ALWAYS "RM".
   - The voice that is addressed as Sir/Ma'am, asks about their investments/portfolio/transfers/returns, or greets "${rmFirstName}" is ALWAYS "Customer".
   - If a voice says "I'm ${rmFirstName}" or "This is ${rmFirstName} from Wint Wealth", that speaker ID MUST be mapped to "RM" for the ENTIRE call (and the other speaker ID to "Customer").
3. Apply your global speaker_map consistently to every single turn and include "speaker_id" (e.g. "SPEAKER_00") on every turn.
`
    : `
CRITICAL SPEAKER-IDENTIFICATION RULES:
1. First separate the two distinct voices consistently across the ENTIRE recording before assigning roles.
2. Do NOT guess roles blindly on Turn 1 ("Hello?" / "Hi"). Use the full conversation to lock which voice is "RM" and which is "Customer":
   - The voice that introduces themselves as "${rmFirstName}" / "${cleanRm}" or "calling from Wint Wealth", checks KYC/Demat/ops, or pitches/explains Wint Wealth bonds/FDs/13% Club is ALWAYS "RM".
   - The voice that is addressed as Sir/Ma'am, asks about their investments/portfolio/transfers/returns, or greets "${rmFirstName}" is ALWAYS "Customer".
   - Keep the two voice roles 100% consistent from 00:00 to ${formattedDuration} — NEVER swap speakers mid-call or merge both speakers into one turn.
`;

  return `Listen carefully to this phone call between a Wint Wealth Relationship Manager (RM) and an investor (Customer).

KNOWN CALL METADATA:
- Wint Wealth RM Name: ${cleanRm} (First name: ${rmFirstName})
- Call Direction: ${directionHint}
- Exact Audio Duration: ${formattedDuration} (${durationSeconds || 0} seconds)
${pyannoteSection}
Transcribe the entire call into chronological speaker dialogue turns from 00:00 to the very last second of the audio (${formattedDuration}).

CRITICAL COMPLETION & END-OF-CALL REQUIREMENTS (ABSOLUTELY NO CUTTING OFF):
- You MUST transcribe the entire conversation from beginning to the absolute end of the audio file.
- ABSOLUTELY DO NOT STOP EARLY or truncate the transcript. Every second of audio up to ${formattedDuration} must be listened to and transcribed.
- THE FINAL INSTANCES OF THE CALL ARE MANDATORY:
  * Capture all closing statements, next-step summaries, customer confirmation, closing pleasantries, 'thank you', 'take care', 'okay bye', and disconnection sign-offs in full detail.
  * Do not stop transcribing when the main discussion winds down. The final 30–60 seconds of wrap-up and farewell dialogue MUST appear in the transcript.
  * If there is a brief silence or lookup pause near the end, continue listening until the call terminates.
- The timestamp of your last transcript turn MUST be near the end of the call (${formattedDuration}).

CRITICAL LANGUAGE & TRANSLATION REQUIREMENT:
- Detect the primary spoken language (e.g. English, Hindi, Hinglish, Tamil, Telugu, Marathi, Gujarati, etc.).
- TRANSLATE ALL NON-ENGLISH AND REGIONAL SPEECH DIRECTLY INTO FLUENT, NATURAL ENGLISH.
- The returned transcript turns must be entirely in English so that quality evaluators, TLs, and managers can read and audit the dialogue clearly.
- Preserve proper nouns, entity names, and financial terms accurately:
  * Representative names and investor names (e.g., ${cleanRm}, Sreeram, Nandini, Vishal, Sahil, Shruti, Gaurav, etc.)
  * "Wint Wealth" or "Wint Wealth PCG" brand mentions
  * Financial products, bond names, interest/yield rates, fixed deposit mentions, and specific numbers (e.g. "9 to 12%", "13% Club", "Senior Secured Bonds").
- Provide the timestamp in "MM:SS" format for each turn.

Return valid JSON matching:
{
  "detected_language": "English" | "Hindi" | "Hinglish" | "Tamil" | "Telugu" | "Marathi" | "Gujarati" | "Other",
  "dead_air_count": number,
  "interruption_count": number,
  "speaker_map": { "SPEAKER_00": "RM" | "Customer", "SPEAKER_01": "RM" | "Customer" },
  "speaker_id_confidence": "high" | "medium" | "low",
  "speaker_id_reasoning": "Brief 1-sentence justification of why RM vs Customer voices were assigned.",
  "turns": [
    { "speaker": "RM" | "Customer", "speaker_id": "SPEAKER_00", "time": "MM:SS", "text": "fluent English dialogue..." }
  ]
}`;
}

/**
 * Normalizes a word phonetically for Indian English name matching
 * (e.g. Samskrithi ~= Samskriti, Richa ~= Rucha, Yaashvi ~= Yashvi, Sreeram ~= Sriram).
 */
function phoneticNorm(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/th/g, 't')
    .replace(/dh/g, 'd')
    .replace(/bh/g, 'b')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/ch/g, 'c')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/y/g, 'i')
    .replace(/v/g, 'w')
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = dp[i];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  return dp[a.length];
}

function tokenMatchesRmName(word: string, rmNameTokens: string[]): boolean {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length < 3) return false;
  const pWord = phoneticNorm(clean);
  for (const rmTok of rmNameTokens) {
    const pRm = phoneticNorm(rmTok);
    if (clean === rmTok || pWord === pRm) return true;
    if (pWord.length >= 4 && pRm.length >= 4 && levenshtein(pWord, pRm) <= 1) {
      return true;
    }
  }
  return false;
}

function extractRmNameTokens(rmName: string): string[] {
  const ignore = new Set(['team', 'admin', 'pcg', 'unassigned', 'unknown', 'rao', 'kumar', 'singh', 'sharma', 'patel', 'gupta', 'jain', 'agarwal']);
  const tokens = String(rmName || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3 && !ignore.has(t));
  // Always keep the first token even if it's a common surname (e.g. "Mishra Richa")
  const first = String(rmName || '').toLowerCase().split(/[^a-z]+/)[0];
  if (first && first.length >= 3 && !tokens.includes(first)) {
    tokens.unshift(first);
  }
  return tokens;
}

/**
 * Deterministic role-signal scoring across transcript turns.
 * Checks strictly first-person RM self-introductions and Wint Wealth caller cues
 * (avoiding false positives like a customer saying "some madam from Wint Wealth called me").
 */
export function detectDeterministicSpeakerSwap(
  turns: PcgTranscriptTurn[],
  rmName: string
): {
  rmScoreForCurrentRm: number;
  rmScoreForCurrentCustomer: number;
  cuesForCurrentRm: string[];
  cuesForCurrentCustomer: string[];
} {
  const rmTokens = extractRmNameTokens(rmName);
  let rmScoreForCurrentRm = 0;
  let rmScoreForCurrentCustomer = 0;
  const cuesForCurrentRm: string[] = [];
  const cuesForCurrentCustomer: string[] = [];

  // Only examine the opening 14 turns + closing 4 turns for intro/addressing cues
  const inspected = turns.length <= 18 ? turns : [...turns.slice(0, 14), ...turns.slice(-4)];

  for (const turn of inspected) {
    const text = String(turn.text || '').trim();
    if (!text) continue;
    const lower = text.toLowerCase();

    let selfRmPoints = 0;
    let selfRmReason = '';
    let addressingRmPoints = 0;
    let addressingRmReason = '';

    // 1. First-person Wint Wealth caller introduction (strictly first-person so third-person mentions like
    //    "some madam was speaking from Wint Wealth" never trigger a false match)
    const isThirdPersonMention = /\b(was|were|she|he|they|someone|somebody|madam|ma'am|lady|guy|person|agent|rm)\s+(was\s+)?(calling|speaking)\s+from\s+wint/i.test(text);
    const firstPersonWint =
      !isThirdPersonMention &&
      (/\b(i'm|i am|this is|myself|my name is)\b[^.?!]{0,45}\b(from|with)\s+wint(\s+wealth)?\b/i.test(text) ||
        /\b(i'm|i am)\s+(calling|speaking)\s+from\s+wint(\s+wealth)?\b/i.test(text) ||
        /\b(i'm|i am|this is)\b[^.?!]{0,35}\byour\s+(dedicated\s+)?(relationship\s+manager|rm)\b/i.test(text) ||
        /\bi\s+will\s+be\s+your\s+(dedicated\s+)?(relationship\s+manager|rm)\b/i.test(text));

    if (firstPersonWint) {
      selfRmPoints += 8;
      selfRmReason = `first-person Wint Wealth intro ("${text.slice(0, 60)}")`;
    }

    // 2. First-person self-introduction with RM's name ("I'm Samskriti", "This is Sahil", "Diya speaking")
    if (rmTokens.length > 0) {
      const selfIntroPatterns = [
        /\b(?:i'm|i am|this is|my name is|myself)\s+([a-z]{3,20})\b/gi,
        /\b([a-z]{3,20})\s+(?:here|speaking|calling|this side|from wint)\b/gi,
      ];
      for (const re of selfIntroPatterns) {
        let m: RegExpExecArray | null;
        while ((m = re.exec(lower)) !== null) {
          if (tokenMatchesRmName(m[1], rmTokens)) {
            selfRmPoints += 10;
            selfRmReason = `RM name self-intro "${m[0]}"`;
            break;
          }
        }
        if (selfRmPoints >= 10) break;
      }

      // 3. Addressing the OTHER speaker by the RM's name ("Samskriti, huh. Yes, go ahead" / "Hi Samskriti" / "Okay Paritosh")
      if (selfRmPoints === 0) {
        const words = lower.split(/[^a-z']+/).filter(Boolean);
        for (let i = 0; i < words.length; i++) {
          if (!tokenMatchesRmName(words[i], rmTokens)) continue;
          const prev = words[i - 1] || '';
          const prev2 = words[i - 2] || '';
          const next = words[i + 1] || '';
          // Skip if preceded by self-intro words
          if (['am', "i'm", 'is', 'myself', 'name'].includes(prev)) continue;
          if (prev2 === 'this' && prev === 'is') continue;
          // Confirm it looks like direct address
          const directBefore = ['hi', 'hello', 'hey', 'yes', 'yeah', 'okay', 'ok', 'thanks', 'thank', 'bye', 'tell', 'listen'].includes(prev);
          const directAfter = ['huh', 'yes', 'yeah', 'go', 'tell', 'please', 'actually', 'ji', 'madam', 'ma', 'sir', 'right'].includes(next);
          if (directBefore || directAfter) {
            addressingRmPoints += 6;
            addressingRmReason = `addressed RM by name "${words[i]}"`;
            break;
          }
        }
      }
    }

    if (selfRmPoints > 0) {
      if (turn.speaker === 'RM') {
        rmScoreForCurrentRm += selfRmPoints;
        cuesForCurrentRm.push(`Turn ${turn.turnIndex} [RM]: ${selfRmReason}`);
      } else {
        rmScoreForCurrentCustomer += selfRmPoints;
        cuesForCurrentCustomer.push(`Turn ${turn.turnIndex} [Customer]: ${selfRmReason}`);
      }
    }

    if (addressingRmPoints > 0) {
      // If `RM` addressed the other person by the RM's name, that's evidence the OTHER side (Customer) is actually RM!
      if (turn.speaker === 'RM') {
        rmScoreForCurrentCustomer += addressingRmPoints;
        cuesForCurrentCustomer.push(`Turn ${turn.turnIndex} [RM]: ${addressingRmReason}`);
      } else {
        rmScoreForCurrentRm += addressingRmPoints;
        cuesForCurrentRm.push(`Turn ${turn.turnIndex} [Customer]: ${addressingRmReason}`);
      }
    }
  }

  return {
    rmScoreForCurrentRm,
    rmScoreForCurrentCustomer,
    cuesForCurrentRm,
    cuesForCurrentCustomer,
  };
}

function swapAllTurns(turns: PcgTranscriptTurn[]): PcgTranscriptTurn[] {
  return turns.map((t) => ({
    ...t,
    speaker: t.speaker === 'RM' ? 'Customer' : 'RM',
  }));
}

/**
 * Two-stage post-transcription speaker verification & auto-swap guard:
 *  1. Deterministic check (0 LLM cost): detects clear RM name / Wint Wealth self-introductions.
 *  2. Text-only LLM sanity check (only when deterministic check is inconclusive): verifies roles
 *     across the full dialogue and swaps only on `COMPLETELY_SWAPPED` + `high` confidence.
 */
export async function verifyAndFixPcgSpeakerLabels(
  turns: PcgTranscriptTurn[],
  opts: {
    rmName: string;
    callType?: string | null;
    callId: string;
    geminiKeys: string[];
    diarizationConfidence?: string;
  }
): Promise<SpeakerVerificationResult> {
  if (!Array.isArray(turns) || turns.length < 2) {
    return {
      turns,
      swapped: false,
      method: 'none',
      confidence: 'low',
      reason: 'Too few turns to verify speaker roles.',
    };
  }

  const hasRm = turns.some((t) => t.speaker === 'RM');
  const hasCustomer = turns.some((t) => t.speaker === 'Customer');
  if (!hasRm && !hasCustomer) {
    return { turns, swapped: false, method: 'none', confidence: 'low', reason: 'Empty speakers.' };
  }

  // Stage A: Deterministic role check (0 LLM cost)
  const det = detectDeterministicSpeakerSwap(turns, opts.rmName);

  if (
    det.rmScoreForCurrentCustomer >= 6 &&
    (det.rmScoreForCurrentRm === 0 || det.rmScoreForCurrentCustomer >= det.rmScoreForCurrentRm + 8)
  ) {
    const reason = `Auto-swapped RM ⇄ Customer (deterministic: customerScore=${det.rmScoreForCurrentCustomer} vs rmScore=${det.rmScoreForCurrentRm}; ${det.cuesForCurrentCustomer.join('; ')})`;
    log.info(ROUTE, `[Call ${opts.callId}] ${reason}`);
    return {
      turns: swapAllTurns(turns),
      swapped: true,
      method: 'deterministic',
      confidence: 'high',
      reason,
    };
  }

  if (det.rmScoreForCurrentRm >= 6 && det.rmScoreForCurrentCustomer === 0) {
    const reason = `Speaker labels confirmed (deterministic: rmScore=${det.rmScoreForCurrentRm}; ${det.cuesForCurrentRm.join('; ')})`;
    log.info(ROUTE, `[Call ${opts.callId}] ${reason}`);
    return {
      turns,
      swapped: false,
      method: 'deterministic',
      confidence: 'high',
      reason,
    };
  }

  // Stage B: Ambiguous call (no clear intro spoken, e.g., follow-up call) -> fast text-only LLM sanity check
  if (!opts.geminiKeys || opts.geminiKeys.length === 0) {
    return {
      turns,
      swapped: false,
      method: 'none',
      confidence: 'low',
      reason: 'Deterministic check inconclusive and no Gemini keys available for sanity check.',
    };
  }

  try {
    const excerptTurns = turns.length <= 24 ? turns : [...turns.slice(0, 16), ...turns.slice(-8)];
    const transcriptExcerpt = excerptTurns
      .map((t) => `Turn ${t.turnIndex} [${t.speaker} - ${t.time}]: ${t.text}`)
      .join('\n');

    const verifyPrompt = `You are a QA Speaker Diarization Auditor for Wint Wealth PCG.
Review this call transcript between a Wint Wealth Relationship Manager ("RM", named "${opts.rmName}") and an Investor ("Customer").
Call Direction: ${opts.callType || 'unknown'}

TRANSCRIPT:
${transcriptExcerpt}

TASK:
Determine whether the "RM" and "Customer" speaker labels are CORRECT or COMPLETELY_SWAPPED across the call.
Look for clear role clues:
- The RM represents Wint Wealth, introduces themselves as ${opts.rmName} / Wint Wealth, explains bonds/FDs/13% Club/KYC/Demat processes, says "I will check with our ops/backend team", or addresses the client respectfully as Sir/Ma'am.
- The Customer/Investor asks about their own money, portfolio, transfers, returns, KYC status, or says "I want to invest / redeem".

Be conservative: ONLY return "COMPLETELY_SWAPPED" with "high" confidence when the evidence is unmistakable.

Return valid JSON only:
{
  "verdict": "CORRECT" | "COMPLETELY_SWAPPED" | "UNCERTAIN",
  "confidence": "high" | "medium" | "low",
  "reason": "Concise 1-sentence explanation citing a specific turn."
}`;

    const raw = await geminiGenerate(
      opts.geminiKeys,
      DEFAULT_GEMINI_MODEL,
      [{ role: 'user', parts: [{ text: verifyPrompt }] }],
      { responseMimeType: 'application/json' },
      30_000
    );

    const parsed = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());
    const verdict = String(parsed.verdict || 'UNCERTAIN').toUpperCase();
    const confidence = String(parsed.confidence || 'low').toLowerCase() as 'high' | 'medium' | 'low';
    const reason = String(parsed.reason || '').trim();

    if (verdict === 'COMPLETELY_SWAPPED' && confidence === 'high') {
      log.info(ROUTE, `[Call ${opts.callId}] Auto-swapped RM ⇄ Customer via LLM sanity check: ${reason}`);
      return {
        turns: swapAllTurns(turns),
        swapped: true,
        method: 'llm_sanity_check',
        confidence: 'high',
        reason,
      };
    }

    log.info(ROUTE, `[Call ${opts.callId}] LLM speaker sanity check result: ${verdict} (${confidence}) — ${reason}`);
    return {
      turns,
      swapped: false,
      method: 'llm_sanity_check',
      confidence,
      reason: reason || `LLM verification returned ${verdict}`,
    };
  } catch (err: any) {
    log.warn(ROUTE, `[Call ${opts.callId}] Speaker sanity check failed (${err?.message || err}); preserving original labels.`);
    return {
      turns,
      swapped: false,
      method: 'none',
      confidence: 'low',
      reason: `Sanity check error: ${err?.message || err}`,
    };
  }
}
