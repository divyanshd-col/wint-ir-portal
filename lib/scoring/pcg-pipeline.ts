import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { getIQSGeminiKeys, callGeminiForCall, geminiGenerate } from '@/lib/gemini';
import { DEFAULT_GEMINI_MODEL } from '@/lib/models';
import { getPcgKbContextForScoring } from '@/lib/pcg/kb';
import { GoogleGenAI } from '@google/genai';
import { log } from '@/lib/log';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

const ROUTE = 'pcg-pipeline';

// ── Canonical 11 PCG Call Quality Parameters across 3 Skill Groups ─────────────
export const PCG_QUALITY_PARAMETERS = [
  // Group 1: Process Skills — 50%
  { id: 'CallOpening', num: 1, name: 'Call Opening', weight: 5, group: 'Process Skills' },
  { id: 'CallClosing', num: 2, name: 'Call Closing', weight: 5, group: 'Process Skills' },
  { id: 'TechnicallyLegal', num: 3, name: 'Technically / Legally Correct', weight: 15, group: 'Process Skills' },
  { id: 'AllQuestions', num: 4, name: 'All Questions Addressed', weight: 10, group: 'Process Skills' },
  { id: 'Expectation', num: 5, name: 'Expectation Setting', weight: 10, group: 'Process Skills' },
  { id: 'Process', num: 6, name: 'Process / Pre-check', weight: 5, group: 'Process Skills' },
  // Group 2: Communication Skills — 30%
  { id: 'VocabularyGrammar', num: 7, name: 'Vocabulary / Sentence Structure / Grammar / Pronunciations', weight: 10, group: 'Communication Skills' },
  { id: 'FillersDeadAir', num: 8, name: 'Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air', weight: 10, group: 'Communication Skills' },
  { id: 'EnergyTone', num: 9, name: 'Warmth, Energy & Tone Modulation', weight: 10, group: 'Communication Skills' },
  // Group 3: Customer Service Skills — 20%
  { id: 'ActiveListening', num: 10, name: 'Active Listening, Interruptions & Empathy', weight: 10, group: 'Customer Service Skills' },
  { id: 'Simplifying', num: 11, name: 'Simplifying Answers', weight: 10, group: 'Customer Service Skills' },
];

import { canonicalizePcgRmName } from '@/lib/pcg/canonical-names';

// ── Known RM to Team Lead Mappings (Default fallbacks) ─────────────────────────
const PCG_RM_TL_MAP: Record<string, { rm: string; tl: string }> = {
  // Team Tanisha Mittal
  'samskrithi rao n': { rm: 'Samskrithi Rao N', tl: 'Team Tanisha Mittal' },
  'samskriti rao': { rm: 'Samskrithi Rao N', tl: 'Team Tanisha Mittal' },
  'samskriti': { rm: 'Samskrithi Rao N', tl: 'Team Tanisha Mittal' },
  'maniyar kriya jignesh': { rm: 'Maniyar Kriya Jignesh', tl: 'Team Tanisha Mittal' },
  'kriya maniyar': { rm: 'Maniyar Kriya Jignesh', tl: 'Team Tanisha Mittal' },
  'antara chakraborty': { rm: 'Antara Chakraborty', tl: 'Team Tanisha Mittal' },
  'antara chakrabarty': { rm: 'Antara Chakraborty', tl: 'Team Tanisha Mittal' },
  'deshna dugar': { rm: 'Deshna Dugar', tl: 'Team Tanisha Mittal' },
  'harshita dhona': { rm: 'Harshita Dhona', tl: 'Team Tanisha Mittal' },
  'keshvi suresh thacker': { rm: 'Keshvi Suresh Thacker', tl: 'Team Tanisha Mittal' },
  'nischay manish jain': { rm: 'Nischay Manish Jain', tl: 'Team Tanisha Mittal' },

  // Team Dheeraj Bhojwani
  'ramita kapoor': { rm: 'Ramita Kapoor', tl: 'Team Dheeraj Bhojwani' },
  'shrey jain': { rm: 'Shrey jain', tl: 'Team Dheeraj Bhojwani' },
  'ishaan kapoor': { rm: 'Ishaan Kapoor', tl: 'Team Dheeraj Bhojwani' },
  'yaashvi arora': { rm: 'Yaashvi Arora', tl: 'Team Dheeraj Bhojwani' },
  'paritosh ashiya': { rm: 'Paritosh Ashiya', tl: 'Team Dheeraj Bhojwani' },
  'shivam kumar baghel': { rm: 'Shivam Kumar Baghel', tl: 'Team Dheeraj Bhojwani' },
  'sargun singh': { rm: 'Sargun Singh', tl: 'Team Dheeraj Bhojwani' },

  // Team Swetha
  'sujal dadwani': { rm: 'Sujal Dadwani', tl: 'Team Swetha' },
  'vaishnavi n j': { rm: 'Vaishnavi N J', tl: 'Team Swetha' },
  'vaishnavi naghat': { rm: 'Vaishnavi Naghat', tl: 'Team Swetha' },
  'vaishnavi': { rm: 'Vaishnavi N J', tl: 'Team Swetha' },
  'diya sharma': { rm: 'Diya Sharma', tl: 'Team Swetha' },
  'vidisha jaiswal': { rm: 'Vidisha Jaiswal', tl: 'Team Swetha' },
  'nishtha veerwani': { rm: 'Nishtha Veerwani', tl: 'Team Swetha' },
  'suryansh sharma': { rm: 'Suryansh Sharma', tl: 'Team Swetha' },
  'ankita agarwal': { rm: 'Ankita Agarwal', tl: 'Team Swetha' },
  'vishyata tulsani': { rm: 'Vishyata Tulsani', tl: 'Team Swetha' },

  // Team Saiyam Rastogi
  'vishal kumar yadav': { rm: 'Vishal Kumar Yadav', tl: 'Team Saiyam Rastogi' },
  'vishal yadav': { rm: 'Vishal Kumar Yadav', tl: 'Team Saiyam Rastogi' },
  'gaurav nautiyal': { rm: 'Gaurav Nautiyal', tl: 'Team Saiyam Rastogi' },
  'shruti sharma': { rm: 'Shruti Sharma', tl: 'Team Saiyam Rastogi' },
  'shruti': { rm: 'Shruti Sharma', tl: 'Team Saiyam Rastogi' },
  'sahil joshi': { rm: 'Sahil Joshi', tl: 'Team Saiyam Rastogi' },
  'ayan kumar garg': { rm: 'Ayan Kumar Garg', tl: 'Team Saiyam Rastogi' },
  'rukmini mundhara': { rm: 'Rukmini Mundhara', tl: 'Team Saiyam Rastogi' },
  'mahi agarwal': { rm: 'Mahi Agarwal', tl: 'Team Saiyam Rastogi' },
  'nandini': { rm: 'Nandini', tl: 'Team Saiyam Rastogi' },
  'nandani': { rm: 'Nandini', tl: 'Team Saiyam Rastogi' },

  // Admin / General
  'aahan thaker': { rm: 'Aahan Thaker', tl: 'Team Admin' },
  'aahan': { rm: 'Aahan Thaker', tl: 'Team Admin' },
  'aahan pcg': { rm: 'Aahan Thaker', tl: 'Team Admin' },
  'dhanush': { rm: 'Dhanush', tl: 'Team Admin' },
};

export function resolvePcgAgent(rawAgentName: any, customTeamMap?: Record<string, string>): { rm: string; tl: string } {
  if (!rawAgentName) return { rm: 'Unassigned RM', tl: 'PCG Team' };
  const rawStr = typeof rawAgentName === 'object'
    ? (rawAgentName.called_by || rawAgentName.agent_name || '')
    : String(rawAgentName);
  if (!rawStr || !rawStr.trim()) return { rm: 'Unassigned RM', tl: 'PCG Team' };
  const canonical = canonicalizePcgRmName(rawStr.trim());
  const clean = canonical.trim().toLowerCase();

  if (customTeamMap && customTeamMap[clean]) {
    return { rm: canonical, tl: `Team ${customTeamMap[clean]}` };
  }

  for (const [key, val] of Object.entries(PCG_RM_TL_MAP)) {
    if (clean === key || clean.includes(key)) {
      return { rm: canonical, tl: val.tl };
    }
  }
  return { rm: canonical, tl: 'PCG Team' };
}

// ── Detect MIME type from audio buffer or extension ─────────────────────────
function detectMimeType(buffer: Buffer, url: string): { mimeType: string; extension: string } {
  const lowerUrl = url.toLowerCase();
  if (buffer.length >= 4) {
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return { mimeType: 'audio/aac', extension: '.aac' };
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return { mimeType: 'audio/mpeg', extension: '.mp3' };
    if (buffer.toString('ascii', 0, 4) === 'RIFF') return { mimeType: 'audio/wav', extension: '.wav' };
    if (buffer.toString('ascii', 4, 8) === 'ftyp') return { mimeType: 'audio/mp4', extension: '.m4a' };
    if (buffer.toString('ascii', 0, 4) === 'OggS') return { mimeType: 'audio/ogg', extension: '.ogg' };
  }
  if (lowerUrl.includes('.aac')) return { mimeType: 'audio/aac', extension: '.aac' };
  if (lowerUrl.includes('.mp3')) return { mimeType: 'audio/mpeg', extension: '.mp3' };
  if (lowerUrl.includes('.wav')) return { mimeType: 'audio/wav', extension: '.wav' };
  if (lowerUrl.includes('.m4a')) return { mimeType: 'audio/mp4', extension: '.m4a' };
  if (lowerUrl.includes('.ogg')) return { mimeType: 'audio/ogg', extension: '.ogg' };
  return { mimeType: 'audio/aac', extension: '.aac' };
}

async function fetchAudioBuffer(recordingUrl: string): Promise<Buffer> {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_S3_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'ap-south-1';

  // 1. If it's an S3 URL and AWS credentials exist, use S3 SDK
  if (accessKeyId && secretAccessKey) {
    try {
      const urlObj = new URL(recordingUrl);
      if (urlObj.hostname.includes('.s3.') || urlObj.hostname.endsWith('.s3.amazonaws.com')) {
        const parts = urlObj.hostname.split('.');
        const bucket = parts[0];
        const key = urlObj.pathname.replace(/^\/+/, '');

        const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = new S3Client({
          region,
          credentials: { accessKeyId, secretAccessKey },
        });

        const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const stream = resp.Body as any;
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      }
    } catch (s3Err: any) {
      log.warn(ROUTE, `S3 SDK fetch failed for ${recordingUrl}, falling back to fetch: ${s3Err.message}`);
    }
  }

  // 2. Direct fetch fallback
  const audioRes = await fetch(recordingUrl);
  if (!audioRes.ok) {
    throw new Error(`Failed to download audio from ${recordingUrl}: HTTP ${audioRes.status}`);
  }
  const arrayBuffer = await audioRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function downloadAndUploadAudio(recordingUrl: string, apiKey: string): Promise<{ fileUri: string; mimeType: string; buffer: Buffer }> {
  const buffer = await fetchAudioBuffer(recordingUrl);
  const { mimeType, extension } = detectMimeType(buffer, recordingUrl);

  const tempDir = os.tmpdir();
  const tempFileName = `pcg-audio-${randomUUID()}${extension}`;
  const tempFilePath = path.join(tempDir, tempFileName);

  await fs.writeFile(tempFilePath, buffer);
  const ai = new GoogleGenAI({ apiKey });
  try {
    const uploadResult = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType },
    });
    if (!uploadResult.uri) throw new Error('Gemini File upload did not return a URI');
    return { fileUri: uploadResult.uri, mimeType, buffer };
  } finally {
    try { await fs.unlink(tempFilePath); } catch { }
  }
}

// ── Master System Prompt for PCG 11-Parameter Quality Evaluation ──────────────
export const PCG_QUALITY_SYSTEM_PROMPT = `You are a Senior Quality Assurance and Compliance Auditor for Wint Wealth's Private Client Group (PCG) Relationship Managers (RMs).

You will evaluate ONE recorded client call. Evaluate STRICTLY from the perspective of the RM (speaker RM). Never penalize the RM for the client's behaviour, questions, or objections.

You must evaluate the call on the following 11 Quality Parameters, divided across three skill groups.
Each parameter must be evaluated INDEPENDENTLY using one of:
- "Yes": The RM fully met the requirement
- "No": The RM did not meet the requirement
- "NA": The situation covered by the parameter did not occur during the call

## MANDATORY EXPLANATION REQUIREMENT FOR EVERY PARAMETER (CX QUALITY STANDARD):
For EVERY parameter without exception, you MUST provide a detailed, context-specific "explanation" field supported by exact conversation turns and spoken facts:
1. If "Yes": Cite the exact turn(s) (e.g. 'Turn 1 [RM]: ...') and detail specifically what the RM said or did that satisfied the criteria.
2. If "No": Cite the exact turn(s) where the failure occurred or was missing, explain specifically what the RM failed to do or said incorrectly, and state what should have been done instead.
3. If "NA": Explicitly justify why this parameter does not apply to this specific conversation.
4. STRICT PARAMETER ISOLATION: The explanation for parameter X must ONLY discuss criteria defined for parameter X.
   - NEVER evaluate Grammar or Tone inside Call Opening or Call Closing.
   - NEVER evaluate Product Accuracy inside Active Listening or Simplifying.
   - NEVER evaluate Questions Addressed inside Expectation Setting.
5. NEVER return generic boilerplate or vague one-liners (such as "Parameter satisfied", "Good call", or "All product information consistent"). Provide thorough, real, context-specific analysis citing spoken facts.

---

## GROUP 1: PROCESS SKILLS (50%)

### 1. Call Opening (Weight: 5%) — key: CallOpening
- Criteria:
  * RM opens warmly and respectfully, addressing the client as Sir or Ma'am.
  * Identifies self and Wint Wealth (or Wint Wealth PCG) clearly in the opening few seconds.
  * Explicitly checks client availability to talk before starting the agenda ("Is this a good time to speak?", "Do you have 2 minutes?").
- Explanation Standard:
  * Yes: State exact Turn X [RM], detailing the respectful salutation (Sir/Ma'am), brand identification (Wint Wealth), and the exact availability question asked before starting the agenda.
  * No: State exact Turn X [RM] and pinpoint what was missing — e.g. skipped checking availability and jumped straight into the pitch, omitted Wint Wealth brand, or lacked respectful greeting.
  * NA: Explain why opening was not applicable (e.g. client called in and launched immediately into agenda, or immediate reconnection within minutes of a dropped call).

### 2. Call Closing (Weight: 5%) — key: CallClosing
- Criteria:
  * RM closes warmly, leaving client with a clear sense of what happens next.
  * Summarizes agreed next steps / follow-ups, thanks client for their time, offers ongoing availability, and ends with polite Sir/Ma'am sign-off.
- Explanation Standard:
  * Yes: State exact Turn X [RM], detailing how next steps were confirmed, client thanked, and polite sign-off delivered.
  * No: State exact Turn X [RM], detailing what was missing — e.g. abrupt disconnect, left next steps unconfirmed, rushed off without thanking client.
  * NA: Explain why closing could not occur (e.g. client abruptly hung up mid-sentence or sudden technical disconnect).

### 3. Technically / Legally Correct (Weight: 15% - HIGHEST PRIORITY) — key: TechnicallyLegal
- Criteria:
  * Technical and legal correctness is of utmost importance for PCG HNI investors.
  * All statements regarding AIF (Wint Wealth Debt Fund), MLDs, PMS, and Bonds must match official KB_CONTEXT, PMS Disclosure Document, AIF PPM, and SEBI regulations.
  * AUTOMATIC NO and COMPLIANCE TRIPWIRE if RM:
    - Promises or implies guaranteed, assured, or fixed returns on AIF, MLDs, or bonds.
    - Compares market-linked debt or AIF returns to risk-free bank FDs without highlighting credit/market risks.
    - Quotes past performance without stating the disclaimer that past performance does not guarantee future returns.
    - Misrepresents fees, hurdle rate, lock-in, tenure, or taxation (e.g. claiming AIF returns are tax-free or MLD is senior secured by default).
    - Gives unauthorized personalized investment advice beyond permitted SEBI execution/distribution scope.
- Explanation Standard:
  * Yes: State exact Turn X [RM], explicitly naming the product, targeted yield/XIRR, tenure, lock-in, taxation, or risk discussed, cite the specific KB document / section verifying these facts, and confirm no guaranteed returns were promised.
  * No: Quote exact Turn X [RM], pinpoint the specific factual error or SEBI regulatory violation, cite contradicting KB guidance, and explain what should have been stated instead. Set "compliance_breach": true and specify "breach_reason".
  * NA: Explain specifically why NA applies (e.g. purely administrative callback scheduling; zero discussion of products, yields, or financial mechanics).

### 4. All Questions Addressed (Weight: 10%) — key: AllQuestions
- Criteria:
  * Every single client query, objection, or clarification asked during the call is answered clearly and accurately.
  * If RM cannot answer live on call, handles transparently: confirms and clarifies the question, acknowledges needing to check with ops or fund management team (does not guess), and commits to a specific follow-up timeline.
- Explanation Standard:
  * Yes: Enumerate each question asked by the investor (e.g. Turn X [Customer]) and detail how the RM answered each accurately or deferred with an agreed timeline.
  * No: Cite Turn X [Customer] and pinpoint which specific question was ignored, brushed aside, guessed incorrectly, or left hanging without an answer or follow-up path.
  * NA: State that the customer asked zero questions during this call.

### 5. Expectation Setting (Weight: 10%) — key: Expectation
- Criteria:
  * On open items or pending requests (drawdown, allotment, onboarding, account statements, redemption, ops tickets), RM provides a clear timeline or takes clear ownership to coordinate with backend team and provide an update.
  * Providing an exact TAT is not always mandatory if the RM clearly takes ownership, commits to coordinate with backend team, and promises an update as soon as possible.
- Explanation Standard:
  * Yes: Cite Turn X [RM], detailing the exact timeline, next step, or backend escalation commitment provided to the client.
  * No: Cite Turn X [Customer] & Turn Y [RM], explaining that client had an open item or asked for a timeline, but RM gave no timeline, no ownership, or vague next steps ("I'll see").
  * NA: Explain that all matters were resolved live on the call with no open items or timeline-sensitive follow-ups.

### 6. Process / Pre-check (Weight: 5%) — key: Process
- Criteria:
  * RM is prepared with client context (holdings, prior calls, recent transactions, CRM notes) from CRM/PCG Finder.
  * Does not ask the client to repeat known information already on record; avoids unnecessary hold time.
- Explanation Standard:
  * Yes: Cite Turn X [RM], detailing how the RM demonstrated preparation by referencing existing holdings, prior discussions, or account details without making the client repeat themselves.
  * No: Cite Turn X [RM], pinpointing where the RM showed a lack of preparation (e.g. asked client to repeat basic holdings/ticket details on record, or took prolonged unannounced holds to check basic details).
  * NA: Explain why NA applies (e.g. brand new inbound/outbound lead with zero prior CRM history on record).

---

## GROUP 2: COMMUNICATION SKILLS (30%)

### 7. Vocabulary / Sentence Structure / Grammar / Pronunciations (Weight: 10%) — key: VocabularyGrammar
- Criteria:
  * Professional vocabulary, correct pronunciation of fund names and financial terms (e.g., AIF, MLD, debentures, XIRR). Comfortable code-switching between English and Hindi is acceptable. Minor slips excused. Focus purely on language, tone, and grammar. (Financial concept simplification is judged under Parameter 11).
  * Each speaker turn is an utterance — evaluate grammar per utterance.
- Explanation Standard:
  * Yes: Detail the linguistic execution — e.g. "RM maintained polished, professional vocabulary and correct sentence construction throughout turns 1–18, with accurate pronunciation of fund and financial terms."
  * No: Cite Turn X [RM], quoting specific repeated grammatical breakdowns, broken phrasing, or mispronunciations that caused confusion or impaired professionalism.
  * NA: Explain why communication could not be evaluated.

### 8. Fillers, Fumbling & Speech Clarity / Avoid Dead Air (Weight: 10%) — key: FillersDeadAir
- Criteria:
  * Clear, steady delivery without excessive fillers ("uh", "um", "matlab", "like").
  * Avoids awkward dead air. Announced pauses ("Please give me a moment while I pull up your statement") are HOLDS, NOT dead air. Dead air >5s without hold announcement is penalized.
- Explanation Standard:
  * Yes: Detail delivery fluency — e.g. "Fluent and confident delivery with minimal filler words; all system lookup pauses were clearly announced to the client."
  * No: Cite Turn X [RM], detailing frequent filler words, noticeable stammering/fumbling, or citing duration of unannounced dead air.
  * NA: Explain why fluency could not be evaluated.

### 9. Warmth, Energy & Tone Modulation (Weight: 10%) — key: EnergyTone
- Criteria:
  * Evaluated from audio. Attentive, calm, composed energy suited to HNI wealth management (not high-pressure aggressive pitching). Modulates tone: reassuring on market volatility, upbeat on payouts.
- Explanation Standard:
  * Yes: Detail vocal demeanor — e.g. "RM maintained a calm, composed, and courteous tone suited to HNI wealth advisory, remaining patient and welcoming throughout."
  * No: Detail vocal issues — e.g. "RM sounded flat, bored, monotone, or overly aggressive/rushed during turns 3–12."
  * NA: State that audio was unavailable (transcript-only scoring).

---

## GROUP 3: CUSTOMER SERVICE SKILLS (20%)

### 10. Active Listening, Interruptions & Empathy (Weight: 10%) — key: ActiveListening
- Criteria:
  * Listens attentively without interrupting, talking over client, or having parallel background conversations.
  * Demonstrates genuine empathy when client raises concerns (delays, volatility, statements) before jumping to explanations.
- Explanation Standard:
  * Yes: Cite Turn X [RM], detailing how RM listened patiently without interrupting and demonstrated empathy when client voiced concerns.
  * No: Cite Turn X [RM], pinpointing where RM interrupted, talked over client, dismissed concerns, or showed lack of empathy.
  * NA: Explain why active listening could not be evaluated.

### 11. Simplifying Answers (Weight: 10%) — key: Simplifying
- Criteria:
  * Explains complex terms (hurdle rate, high-water mark, drawdown, carried interest, NAV, pass-through taxation, Senior Secured) in plain language matched to client understanding. Avoids over-explaining to savvy HNIs.
- Explanation Standard:
  * Yes: Cite Turn X [RM], detailing how RM explained complex financial concepts using plain language or concrete numerical examples.
  * No: Cite Turn X [RM], pinpointing where RM used heavy, unexplained jargon that left the investor confused.
  * NA: State that no complex financial or technical concepts were discussed during the call.

---

## OUTPUT FORMAT
Return ONLY valid JSON matching this schema:
{
  "call_category": "13_pitching" | "upselling" | "support",
  "parameters": {
    "CallOpening": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation citing Turn X [RM]: ...",
      "quote": "Short exact dialogue quote"
    },
    "CallClosing": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation citing Turn X [RM]: ...",
      "quote": "Short exact dialogue quote"
    },
    "TechnicallyLegal": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation citing Turn X [RM]: ... and KB doc/section",
      "quote": "Short exact dialogue quote",
      "compliance_breach": false,
      "breach_reason": null
    },
    "AllQuestions": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation enumerating questions and answers citing Turn X...",
      "quote": "Short exact dialogue quote"
    },
    "Expectation": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of timeline/next steps citing Turn X [RM]...",
      "quote": "Short exact dialogue quote"
    },
    "Process": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of pre-check context citing Turn X [RM]...",
      "quote": "Short exact dialogue quote"
    },
    "VocabularyGrammar": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of grammar and language quality...",
      "quote": "Short exact dialogue quote"
    },
    "FillersDeadAir": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of delivery fluency and dead air...",
      "quote": "Short exact dialogue quote"
    },
    "EnergyTone": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of vocal demeanor and composure...",
      "quote": "Short exact dialogue quote"
    },
    "ActiveListening": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of listening patience and empathy citing Turn X [RM]...",
      "quote": "Short exact dialogue quote"
    },
    "Simplifying": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of financial simplification citing Turn X [RM]...",
      "quote": "Short exact dialogue quote"
    }
  },
  "compliance_tripwire": false,
  "compliance_reason": null
}
`;

// ── Run Evaluation Pipeline for a Single PCG Call ─────────────────────────────
export async function runPcgCallPipeline(callId: string, options?: { forceTranscript?: boolean }): Promise<any> {
  log.info(ROUTE, `Starting PCG evaluation pipeline for callId: ${callId}`);

  // 1. Fetch raw call recording from pcg_call_recordings
  const rows = await query(`
    SELECT * FROM pcg_call_recordings WHERE call_id = $1 OR id::text = $1
  `, [callId]);

  if (!rows.length) {
    throw new Error(`PCG call recording ${callId} not found in pcg_call_recordings`);
  }

  const call = rows[0];
  const caller = (call.called_by && call.called_by.trim() && call.called_by.toLowerCase() !== 'unknown')
    ? call.called_by.trim()
    : (call.agent_name && call.agent_name.trim() && call.agent_name.toLowerCase() !== 'unknown' ? call.agent_name.trim() : 'Unassigned RM');
  const { rm: resolvedRm, tl: resolvedTl } = resolvePcgAgent(caller);

  // If call is unopened / zero duration, mark as NOT_SCOREABLE immediately
  if (!call.duration_seconds || call.duration_seconds < 15 || !call.recording_url) {
    log.info(ROUTE, `Call ${callId} has zero or negligible duration (<15s). Marking as NOT_SCOREABLE.`);
    const paramsMap: Record<string, any> = {};
    PCG_QUALITY_PARAMETERS.forEach(p => {
      paramsMap[p.id] = { id: p.id, name: p.name, maxScore: p.weight, earnedScore: 0, status: 'NA', quote: 'Unanswered / Zero duration call' };
    });

    await query(`
      INSERT INTO pcg_call_evaluations (
        call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
        iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
        verdict, parameters, transcript_turns, compliance_tripwire, scored_at
      ) VALUES ($1, $2, $3, $4, 'support', $5, null, null, null, null, 0, 'NOT_SCOREABLE', $6, '[]'::jsonb, false, NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        verdict = 'NOT_SCOREABLE', scored_at = NOW()
    `, [call.call_id, resolvedRm, resolvedTl, call.phone_number, call.duration_seconds || 0, JSON.stringify(paramsMap)]);

    return { callId: call.call_id, verdict: 'NOT_SCOREABLE', iqs: null };
  }

  // 2. Fetch Gemini API configuration
  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    throw new Error('No Gemini API key configured for IQS scoring');
  }
  const apiKey = geminiKeys[0];

  // 3. Audio Ingestion & Diarization (or reuse existing transcript if already transcribed)
  let transcriptTurns: Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; turnIndex: number }> = [];
  let detectedLanguage = 'English';
  let deadAirCount = 0;
  let interruptionCount = 0;

  let existingTurns: any = null;
  if (!options?.forceTranscript) {
    const existingEvalRows = await query(`
      SELECT transcript_turns FROM pcg_call_evaluations WHERE call_id = $1
    `, [call.call_id]);
    existingTurns = existingEvalRows[0]?.transcript_turns;
    if (typeof existingTurns === 'string') {
      try { existingTurns = JSON.parse(existingTurns); } catch { existingTurns = null; }
    }
  }

  if (Array.isArray(existingTurns) && existingTurns.length > 0) {
    log.info(ROUTE, `Reusing existing ${existingTurns.length} transcript turns for call ${call.call_id} (skipping S3 download and re-transcription).`);
    transcriptTurns = existingTurns.map((t: any, idx: number) => ({
      speaker: t.speaker === 'Customer' ? ('Customer' as const) : ('RM' as const),
      text: t.text || '',
      time: t.time || '00:00',
      turnIndex: t.turnIndex || (idx + 1),
    }));
  } else {
    log.info(ROUTE, `Transcribing audio from S3 for PCG call ${call.call_id}: ${call.recording_url}`);
    const { fileUri, mimeType, buffer } = await downloadAndUploadAudio(call.recording_url, apiKey);

    const diarizationPrompt = `Listen carefully to this phone call between a Wint Wealth Relationship Manager (RM) and an investor (Customer).
Transcribe the entire call verbatim into chronological speaker dialogue turns.
Identify whether each speaker is "RM" (the Wint Wealth representative) or "Customer" (the client/investor).
Return JSON matching:
{
  "detected_language": "English" | "Hindi" | "Hinglish",
  "dead_air_count": number,
  "interruption_count": number,
  "turns": [
    { "speaker": "RM" | "Customer", "time": "MM:SS", "text": "..." }
  ]
}`;

    const ai = new GoogleGenAI({ apiKey });
    try {
      const diarizationRaw = await callGeminiForCall(
        geminiKeys,
        [{
          parts: [
            { file_data: { mime_type: mimeType, file_uri: fileUri } },
            { text: diarizationPrompt },
          ]
        }],
        undefined,
        180_000
      );

      const parsedDiarization = JSON.parse(diarizationRaw.replace(/```json/g, '').replace(/```/g, '').trim());
      detectedLanguage = parsedDiarization.detected_language || 'English';
      deadAirCount = parsedDiarization.dead_air_count || 0;
      interruptionCount = parsedDiarization.interruption_count || 0;

      transcriptTurns = (parsedDiarization.turns || []).map((t: any, idx: number) => ({
        speaker: t.speaker === 'Customer' ? ('Customer' as const) : ('RM' as const),
        text: t.text || '',
        time: t.time || '00:00',
        turnIndex: idx + 1,
      }));
    } finally {
      // Clean up Gemini File API upload
      try {
        const fileNameMatch = fileUri.split('/files/')[1];
        if (fileNameMatch) await ai.files.delete({ name: `files/${fileNameMatch}` });
      } catch { }
    }
  }

  const transcriptText = transcriptTurns.map((t) => `Turn ${t.turnIndex} [${t.speaker} - ${t.time}]: ${t.text}`).join('\n');

  // 4. Retrieve PCG-Exclusive KB Context
  const kbContext = await getPcgKbContextForScoring(transcriptText.slice(0, 800), 6);

  // 5. LLM Quality & Compliance Evaluation
  const userPrompt = `CALL TRANSCRIPT:
${transcriptText}

AUDIO SIGNALS:
- Duration: ${call.duration_seconds} seconds
- Detected Language: ${detectedLanguage}
- Dead Air Events: ${deadAirCount}
- Interruption Overlaps: ${interruptionCount}

VERIFIED PCG KNOWLEDGE BASE CONTEXT (Strict Source of Truth for AIF & MLDs):
${kbContext || 'No specific KB excerpts retrieved.'}

Please evaluate this PCG call strictly against the 11 parameters and compliance gates. Output valid JSON only.`;

  const responseText = await geminiGenerate(
    [apiKey],
    DEFAULT_GEMINI_MODEL,
    [{ role: 'user', parts: [{ text: userPrompt }] }],
    {
      systemInstruction: PCG_QUALITY_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
    }
  );

  let evalJson: any;
  try {
    evalJson = JSON.parse(responseText.replace(/```json/g, '').replace(/```/g, '').trim());
  } catch (err: any) {
    throw new Error(`Failed to parse PCG evaluation LLM output: ${err.message}. Raw: ${responseText}`);
  }

  // 6. Deterministic Score Calculation
  const evaluatedParams = evalJson.parameters || {};
  let totalEarned = 0;
  let totalApplicable = 0;
  let processEarned = 0;
  let processApplicable = 0;
  let commEarned = 0;
  let commApplicable = 0;
  let csEarned = 0;
  let csApplicable = 0;

  const formattedParameters: any[] = [];

  for (const paramDef of PCG_QUALITY_PARAMETERS) {
    const res = evaluatedParams[paramDef.id] || { rating: 'No', quote: 'No evaluation provided.' };
    const rating: 'Yes' | 'Half' | 'No' = res.rating === 'Yes' ? 'Yes' : res.rating === 'NA' ? 'Half' : 'No';
    const isApplicable = res.rating !== 'NA';

    let earned = 0;
    if (res.rating === 'Yes') {
      earned = paramDef.weight;
      totalEarned += earned;
    }

    if (isApplicable) {
      totalApplicable += paramDef.weight;
      if (paramDef.group === 'Process Skills') {
        processEarned += earned;
        processApplicable += paramDef.weight;
      } else if (paramDef.group === 'Communication Skills') {
        commEarned += earned;
        commApplicable += paramDef.weight;
      } else if (paramDef.group === 'Customer Service Skills') {
        csEarned += earned;
        csApplicable += paramDef.weight;
      }
    }

    const explanationText = (res.explanation || res.reasoning || res.quote || 'No explanation provided.').trim();

    formattedParameters.push({
      id: paramDef.id,
      name: `${paramDef.num}. ${paramDef.name}`,
      maxScore: paramDef.weight,
      earnedScore: earned,
      status: res.rating === 'Yes' ? 'Yes' : res.rating === 'NA' ? 'NA' : 'No',
      quote: explanationText,
      explanation: explanationText,
      reasoning: explanationText,
    });
  }

  const iqsScore = totalApplicable > 0 ? Math.round((totalEarned / totalApplicable) * 100) : 0;
  const processScore = processApplicable > 0 ? parseFloat(((processEarned / processApplicable) * 100).toFixed(1)) : 100;
  const commScore = commApplicable > 0 ? parseFloat(((commEarned / commApplicable) * 100).toFixed(1)) : 100;
  const csScore = csApplicable > 0 ? parseFloat(((csEarned / csApplicable) * 100).toFixed(1)) : 100;

  const complianceTripwire = !!evalJson.compliance_tripwire || evaluatedParams.TechnicallyLegal?.compliance_breach === true;
  const complianceReason = evalJson.compliance_reason || evaluatedParams.TechnicallyLegal?.breach_reason || null;

  let verdict: 'PASS' | 'COMPLIANCE_BREACH' = 'PASS';
  if (complianceTripwire) {
    verdict = 'COMPLIANCE_BREACH';
  }

  const category = evalJson.call_category || call.call_category || '13_pitching';

  // 7. Store Result in pcg_call_evaluations
  await query(`
    INSERT INTO pcg_call_evaluations (
      call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
      iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
      verdict, parameters, compliance_tripwire, compliance_reason, ai_coaching_tip,
      transcript_turns, scored_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, null, $16, NOW(), NOW())
    ON CONFLICT (call_id) DO UPDATE SET
      rm_name = EXCLUDED.rm_name,
      tl_name = EXCLUDED.tl_name,
      customer_phone = EXCLUDED.customer_phone,
      call_category = EXCLUDED.call_category,
      duration_seconds = EXCLUDED.duration_seconds,
      iqs_score = EXCLUDED.iqs_score,
      process_score = EXCLUDED.process_score,
      communication_score = EXCLUDED.communication_score,
      customer_service_score = EXCLUDED.customer_service_score,
      applicable_weight = EXCLUDED.applicable_weight,
      verdict = EXCLUDED.verdict,
      parameters = EXCLUDED.parameters,
      compliance_tripwire = EXCLUDED.compliance_tripwire,
      compliance_reason = EXCLUDED.compliance_reason,
      ai_coaching_tip = null,
      transcript_turns = EXCLUDED.transcript_turns,
      scored_at = NOW(),
      updated_at = NOW()
  `, [
    call.call_id,
    resolvedRm,
    resolvedTl,
    call.phone_number,
    category,
    call.duration_seconds,
    iqsScore,
    processScore,
    commScore,
    csScore,
    totalApplicable,
    verdict,
    JSON.stringify(formattedParameters),
    complianceTripwire,
    complianceReason,
    JSON.stringify(transcriptTurns),
  ]);

  log.info(ROUTE, `Successfully evaluated PCG call ${call.call_id} — IQS: ${iqsScore}%, Verdict: ${verdict}`);

  return {
    callId: call.call_id,
    rmName: resolvedRm,
    tlName: resolvedTl,
    iqs: iqsScore,
    verdict,
    parameters: formattedParameters,
    transcriptTurns,
  };
}

