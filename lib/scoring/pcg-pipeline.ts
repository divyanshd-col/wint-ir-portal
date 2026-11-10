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
6. MANDATORY 100% ENGLISH TRANSLATION FOR ALL PARAMETERS, EVIDENCE, QUOTES & EXPLANATIONS:
   - For ANY non-English, Hindi, Hinglish, or regional dialogue cited as evidence:
     You MUST TRANSLATE the spoken dialogue turns into natural, fluent English inside the explanation and quote fields.
   - NEVER quote raw Hindi, Devanagari script, or Romanized Hinglish.
   - Example (Wrong): In Turn 50 [RM] ('Theek hai, bhaiya. Okay, aur kuch ho toh batana. Theek hai, bhaiya.'), the RM failed to use a polite Sir/Ma'am sign-off (addressed client as 'bhaiya')...
   - Example (Correct): In Turn 50 [RM] ('All right, brother. Okay, let me know if there is anything else. All right, brother.'), the RM failed to use a polite Sir/Ma'am sign-off (addressed client casually as 'brother/bhaiya')...
   - Example (Wrong): In Turn 34 [RM] ('Pura HNI ka hi aaya. Matlab humara toh 20 Cr humne jo dala tha wo tha.')...
   - Example (Correct): In Turn 34 [RM] ('It was entirely from HNIs. Meaning, our contribution that we put in was 20 Cr.')...
   - Example (Wrong): In Turn 48 [RM] ('Aap Ahaan se baat kar sakte ho is cheez ke liye')...
   - Example (Correct): In Turn 48 [RM] ('You can speak to Ahaan regarding this')...
   - Every single word of the evaluation explanation, reasoning, and cited quotes MUST be readable in fluent English by executives and auditors.

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

## SOP COMMUNICATION & CONDUCT MONITORING (AUTOMATED BREACH DETECTION)
In addition to the 11 quality parameters, you must audit the conversation for any breach of the 7 Standard Operating Procedure (SOP) Monitoring Categories defined below.
Both parties (RM and Customer) must be evaluated according to the specified direction.

### Category 1: RM Communication & Tone
Direction: "RM said this to customer"
Signals:
- "Curt or one-word replies" [Severity: MEDIUM]: Short or impatient replies (e.g., "already told you", "read my earlier message").
- "Dismissive or defensive replies" [Severity: MEDIUM]: Dismissing genuine customer concerns (e.g., "that's not my problem", "I can't do anything about it", "what do you want me to do?", "figure it out yourself").
- "Arguing back" [Severity: MEDIUM]: Bickering or fighting with customer (e.g., "you are wrong", "I never said that", "why would I lie?", "you keep asking the same thing").
- "Showing the customer isn't valued" [Severity: MEDIUM]: Belittling the customer or investment size (e.g., "I have many other clients", "you're not my only client", "this is a small amount", "I'm busy right now").
- "Blaming the customer" [Severity: MEDIUM]: Shifting blame onto customer (e.g., "you didn't read it properly", "it's your mistake", "you should have checked", "you didn't tell me").
- "Talking down to the customer" [Severity: MEDIUM]: Condescending language (e.g., "it's very simple, how don't you understand?", "I have explained so many times", "you wouldn't understand").
- "Abusive or insulting language" [Severity: CRITICAL]: Swearing, cursing, name-calling, or mocking.
- "Assuring safety or no loss" [Severity: CRITICAL]: Misleading safety guarantees (e.g., "no risk at all", "it is completely safe", "your money is totally secure", "you won't lose anything").
- "Giving a definite outcome or date the RM can't control" [Severity: MEDIUM]: Promising dates or results dependent on external teams (e.g., "it will definitely come today", "I guarantee it will be fixed", "it will be done by tomorrow, no doubt"). Note: Sharing a timeline as what the backend team shared ("we should receive an update today as per the team") is NOT flagged.

### Category 2: Professional Boundary Monitoring
Direction:
- Customer to RM ("Customer said this to RM"):
  * "Asking for RM's personal number" [Severity: CRITICAL]: Requesting personal WhatsApp or direct mobile number.
  * "Requesting off-platform discussion" [Severity: CRITICAL]: Proposing discussing unrelated or personal matters off official channels.
  * "Romantic or inappropriate comments" [Severity: CRITICAL]: Any romantic, flirtatious, or inappropriate personal comments aimed at RM.
  * "Asking RM's personal details" [Severity: MEDIUM]: Probing personal life, home address, city, family, or personal background.
  * "Requesting management/HR contacts directly" [Severity: MEDIUM]: Asking for HR head, PCG head, or executive direct personal contact info.
  * "Asking RM to connect on external social" [Severity: MEDIUM]: Asking to connect on LinkedIn, Instagram, Facebook, etc.
  * "Gifting or personal favours asked" [Severity: MEDIUM]: Offering personal gifts, hospitality, invites for coffee/meals.
- RM to Customer ("RM said this to customer"):
  * "RM sharing personal phone number" [Severity: CRITICAL]: Giving out personal number or asking customer to call on personal number.
  * "RM sharing personal email or social handle" [Severity: CRITICAL]: Sharing personal Gmail, LinkedIn, Instagram, etc.
  * "RM engaging in non-product personal conversation" [Severity: MEDIUM]: Lengthy personal talk about hobbies, dating, personal travel, unprompted details beyond polite rapport.

### Category 3: Returns & Benefits Negotiation
Direction: "Customer said this to RM"
Signals:
- "Asking for extra because of the amount invested" [Severity: LOW]: Pushing for extra rate/yield/privileges citing large ticket size.
- "Repeatedly negotiating the XIRR" [Severity: MEDIUM]: Continually bargaining on yield/XIRR after standard options explained.
- "Insisting on special privileges" [Severity: MEDIUM]: Demanding perks beyond standard PCG offerings.
- "Pushing for priority access beyond what is offered" [Severity: MEDIUM]: Demanding blocking of bonds or first access ahead of others.
- "Using another platform or other clients as leverage" [Severity: MEDIUM]: "Platform X gives more, match it", "My friend got a better deal".
- "Threatening to take the money elsewhere" [Severity: MEDIUM]: "Give me this or I'll stop investing / move funds".
- "Asking the RM to confirm extra returns or benefits" [Severity: CRITICAL]: Pushing RM to commit to higher returns in writing or on call.
- "Asking for a side arrangement or cashback" [Severity: CRITICAL]: Demanding cashbacks, under-the-table kickbacks, or off-platform adjustments.

### Category 4: Out-of-Scope Queries
Direction: "Customer said this to RM"
Signals:
- "Asking for share or stock tips" [Severity: MEDIUM]: Asking RM which stocks to buy, equity predictions, or market trading advice.
- "Asking about real estate" [Severity: MEDIUM]: Asking whether property/real estate is a good investment.
- "Asking about mutual funds, FDs, gold or insurance" [Severity: LOW]: Asking which external FD, mutual fund, gold, or insurance policy to pick.
- "Comparing our products with ones we don't offer" [Severity: LOW]: Pushing RM to compare with real estate, crypto, or unoffered products.
- "Asking where interest rates are headed" [Severity: LOW]: Demanding macro predictions on RBI policy or rate cycles.
- "Asking RM to invest or hold money outside our products" [Severity: CRITICAL]: Offering to transfer money for RM to personally invest or handle.

### Category 5: Internal Tools Probing
Direction: "Customer said this to RM"
Signals:
- "Asking what apps or systems the team uses" [Severity: CRITICAL]: Probing into internal CRM, portfolio trackers, or proprietary software.
- "Asking how the RM sees their details" [Severity: CRITICAL]: Asking how client data, screens, or account details are viewed internally.
- "Asking what apps are used for information and coordination" [Severity: CRITICAL]: Asking which internal tools team uses to communicate or sync.
- "Referring to an internal app by name" [Severity: CRITICAL]: Naming internal tools or inquiring if specific internal software is used.
- "Asking what is used to message clients" [Severity: LOW]: Inquiring about dialer tools, automated messaging tools, or chatbots.

### Category 6: Customer Behaviour & Hostility
Direction: "Customer said this to RM"
Signals:
- "Repeated pings for a quick reply / impatience" [Severity: LOW]: Aggressive impatience, shouting in tone.
- "Demanding an instant fix" [Severity: LOW]: Unreasonable demands for instant resolution on dependencies outside RM control.
- "Sarcastic or rude remarks" [Severity: MEDIUM]: Sarcastic commentary, questioning RM competence ("do you even know your job?").
- "Blaming the RM personally" [Severity: MEDIUM]: Directing hostility or blame at the RM ("you are useless", "this is all your fault").
- "Threatening to complain to the manager" [Severity: MEDIUM]: Using manager escalation as a threat/pressure tactic.
- "Abusive or insulting language" [Severity: CRITICAL]: Direct insults, derogatory remarks, foul language.
- "Accusing the RM of cheating or fraud" [Severity: CRITICAL]: "You are scamming me", "You cheated me", "Fraudulent company".
- "Threatening public posts or media" [Severity: CRITICAL]: Threatening to smear on Twitter/LinkedIn, go to newspapers, or blast online.
- "Threatening legal action or a regulator complaint" [Severity: CRITICAL]: Threatening SEBI complaint, police FIR, or lawsuits as pressure.
- "Threatening the RM personally" [Severity: CRITICAL]: Safety threats, career threats ("I'll make sure you lose your job", "You will regret this").

### Category 7: Business Information Probing
Direction: "Customer said this to RM"
Signals:
- "Asking how Wint earns or its margin" [Severity: LOW]: Probing Wint's spread, revenue cut, or margins.
- "Asking about cost price, issuer charges or bargaining" [Severity: MEDIUM]: Asking what Wint bought the bond at or issuer fees.
- "Asking for AUM, revenue or valuation" [Severity: MEDIUM]: Asking company financial metrics (valuation, revenue, GMV, profitability).
- "Asking about RM commission / incentives" [Severity: LOW]: Asking RM's payout, commissions, or sales targets.
- "Asking about inventory & sourcing" [Severity: MEDIUM]: How much inventory Wint holds, who sold it, sourcing partners.
- "Asking about upcoming bonds" [Severity: LOW]: Probing unreleased pipeline or unannounced issues.
- "Asking about client tiers / rates for others" [Severity: LOW]: Probing what rates other HNIs get.
- "Seeking unpublished issuer information" [Severity: CRITICAL]: Insider info, rating changes before announcement, non-public leaks.
- "Asking who else holds a bond / client lists" [Severity: CRITICAL]: Asking other client names, holding sizes, or introductions.
- "Asking what other clients are buying" [Severity: CRITICAL]: Probing other client behavior or portfolio compositions.
- "Asking about team size" [Severity: LOW]: Probing headcount, hierarchy, or team structure.
- "Asking about internal process, tech & vendors" [Severity: CRITICAL]: Probing order routing, backend tech, or vendor partnerships.
- "Asking about funding, roadmap & future plans" [Severity: MEDIUM]: Asking if Wint is raising funds, IPO plans, or M&A.
- "Asking about audits, notices or complaints data" [Severity: MEDIUM]: Regulatory notices, audit records, or complaint statistics.
- "Asking to speak to senior management" [Severity: LOW]: Asking for founder/CXO personal access outside channels.
- "Requesting access, logins or data exports" [Severity: CRITICAL]: Asking for API keys, dashboard access, or raw internal data exports.
- "Claiming a research / media / competitor role" [Severity: CRITICAL]: Claiming journalist/competitor status seeking information.

IMPORTANT RULES FOR SOP BREACH DETECTION:
1. ONLY flag genuine occurrences matching the above criteria. If NO breach occurred, return an empty array "sop_triggers": [].
2. Do not flag normal, polite financial questions, standard polite follow-ups, or standard product discussions.
3. Every flagged item MUST have:
   - "category": Exact category name matching one of the 7:
     "RM Communication & Tone" | "Professional Boundary Monitoring" | "Returns & Benefits Negotiation" | "Out-of-Scope Queries" | "Internal Tools Probing" | "Customer Behaviour & Hostility" | "Business Information Probing"
   - "severity": "CRITICAL" | "MEDIUM" | "LOW"
   - "direction": Exactly "Customer said this to RM" or "RM said this to customer"
   - "signal": The specific signal description
   - "timestamp": Spoken timestamp of the turn (e.g. "02:15") or null if unavailable
   - "turn_index": Integer turn number (e.g. 8)
   - "quote": The verbatim quote translated into fluent English.

---

## OUTPUT FORMAT
Return ONLY valid JSON matching this schema:
{
  "call_category": "13_pitching" | "upselling" | "support",
  "parameters": {
    "CallOpening": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation citing Turn X [RM]: ... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "CallClosing": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation citing Turn X [RM]: ... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "TechnicallyLegal": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation citing Turn X [RM]: ... and KB doc/section (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English",
      "compliance_breach": false,
      "breach_reason": null
    },
    "AllQuestions": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation enumerating questions and answers citing Turn X... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "Expectation": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of timeline/next steps citing Turn X [RM]... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "Process": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of pre-check context citing Turn X [RM]... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "VocabularyGrammar": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of grammar and language quality... (100% in English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "FillersDeadAir": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of delivery fluency and dead air... (100% in English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "EnergyTone": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of vocal demeanor and composure... (100% in English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "ActiveListening": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of listening patience and empathy citing Turn X [RM]... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    },
    "Simplifying": {
      "rating": "Yes" | "No" | "NA",
      "explanation": "Thorough, context-specific explanation of financial simplification citing Turn X [RM]... (ALL cited dialogue TRANSLATED to fluent English)",
      "quote": "Short dialogue quote translated into fluent English"
    }
  },
  "compliance_tripwire": false,
  "compliance_reason": null,
  "sop_triggers": [
    {
      "category": "Customer Behaviour & Hostility",
      "severity": "CRITICAL",
      "direction": "Customer said this to RM",
      "signal": "Threatening legal action or a regulator complaint",
      "timestamp": "02:15",
      "turn_index": 8,
      "quote": "If you don't credit my money today, I will file a complaint with SEBI and take legal action against you."
    }
  ]
}
`;

// ── Call Category Types & Definitions ──────────────────────────────────────────
export type PcgCallCategory =
  | '13_pitching'
  | 'upselling'
  | 'support'
  | 'hiring'
  | 'telemarketing'
  | 'delivery_logistics'
  | 'wrong_number'
  | 'internal_personal';

export interface SopTrigger {
  category: string;
  severity: 'CRITICAL' | 'MEDIUM' | 'LOW';
  direction: 'Customer said this to RM' | 'RM said this to customer';
  signal: string;
  timestamp?: string;
  turn_index?: number;
  quote: string;
}

export interface PcgCallTriageResult {
  detected_category: PcgCallCategory;
  is_evaluable: boolean;
  confidence: number;
  opening_quote: string;
  reason: string;
}

export const PCG_CLASSIFICATION_SYSTEM_PROMPT = `You are a Call Purpose & Nature Classifier for Wint Wealth's Private Client Group (PCG) Relationship Managers (RMs).

Your mission is to analyze the OPENING 45–60 SECONDS of a recorded phone call and determine its exact nature.
Not every call made or received by an RM is a client business call. RMs frequently receive delivery calls, recruitment screenings, telemarketing/loan spam, wrong numbers, or make personal/internal calls.

You must categorize the call into EXACTLY ONE of the following 8 categories:

=== GROUP A: EVALUABLE CLIENT CALLS (is_evaluable = true) ===
1. "13_pitching":
   - The RM is introducing, pitching, or discussing Wint Wealth's 13% Debt Fund, AIF offerings, or new bond investment opportunities to a prospective HNI investor.
   - Mention of Wint Wealth, 13% fund, debt opportunities, high-yield bonds, or wealth portfolio.

2. "upselling":
   - The RM is contacting an existing investor to discuss additional investments, bond reinvestment, upcoming maturity proceeds, fresh bond tranches, or Market Linked Debentures (MLDs).

3. "support":
   - General investor servicing: Demat accounts, KYC, withdrawals, interest payouts, TDS queries, Form 121, Form 26AS, or order placement support for Wint Wealth platform.

=== GROUP B: EXCLUDED NON-CLIENT CALLS (is_evaluable = false) ===
4. "hiring":
   - Recruitment or job screening discussions. Discussions about resumes, interviews, job openings, CTC, notice periods, or candidate evaluation.
   - Spoken examples: "I am calling regarding your application for the IR / RM role", "Are you available for an interview?", "What is your current CTC?", "Notice period".

5. "telemarketing":
   - Inbound unsolicited sales, spam, or telemarketing from banks, NBFCs, or third parties trying to sell personal loans, credit cards, insurance policies, or real estate to the RM.
   - Spoken examples: "Sir, are you looking for a pre-approved personal loan?", "Calling from HDFC credit card division".

6. "delivery_logistics":
   - Delivery agents, courier executives, or logistics personnel delivering packages or food.
   - Spoken examples: "Courier parcel delivery", "I am standing at your gate/office", "Please confirm OTP for delivery", "Amazon / Flipkart / Blue Dart / Ecom Delivery".

7. "wrong_number":
   - Misdialed numbers where the caller or RM realizes they reached the wrong person.
   - Spoken examples: "Galat number hai", "Wrong number", "Sorry, whom were you trying to call?", "I dialed the wrong person".

8. "internal_personal":
   - Internal colleague discussions unrelated to client servicing, or personal/family phone calls.
   - Spoken examples: Talking to colleagues (e.g. Rupika, team members) about personal catchups, lunch, internal logistics, WhatsApp testing, or speaking to family/friends.

=== CRITICAL SAFEGUARD ===
If the opening 45–60 seconds is ambiguous, unclear, or you are not completely sure whether it is a business call or not:
- Set detected_category to "support"
- Set is_evaluable to true
- Set confidence below 0.65
NEVER wrongly exclude a genuine investor conversation! Only exclude when the conversation clearly and unambiguously belongs to one of the 5 excluded categories (hiring, telemarketing, delivery_logistics, wrong_number, internal_personal).

=== OUTPUT SCHEMA (JSON ONLY) ===
{
  "detected_category": "13_pitching" | "upselling" | "support" | "hiring" | "telemarketing" | "delivery_logistics" | "wrong_number" | "internal_personal",
  "is_evaluable": boolean,
  "confidence": number,
  "opening_quote": "Exact spoken quote from opening dialogue demonstrating the classification (TRANSLATED into fluent English)",
  "reason": "Concise justification in English for why this call belongs to the detected category"
}
`;

export async function classifyPcgCallOpening(
  openingDialogueText: string,
  geminiKeys: string[]
): Promise<PcgCallTriageResult> {
  const prompt = `OPENING 45–60 SECONDS CALL TRANSCRIPT:
${openingDialogueText}

Analyze this opening portion and classify the call purpose according to the instructions. Return valid JSON only.`;

  try {
    const rawResponse = await geminiGenerate(
      geminiKeys,
      DEFAULT_GEMINI_MODEL,
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        systemInstruction: PCG_CLASSIFICATION_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
      }
    );

    const parsed = JSON.parse(rawResponse.replace(/```json/g, '').replace(/```/g, '').trim());
    const validCategories: PcgCallCategory[] = [
      '13_pitching', 'upselling', 'support',
      'hiring', 'telemarketing', 'delivery_logistics', 'wrong_number', 'internal_personal'
    ];

    let category = (parsed.detected_category || 'support') as PcgCallCategory;
    if (!validCategories.includes(category)) {
      category = 'support';
    }

    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
    const isExcluded = ['hiring', 'telemarketing', 'delivery_logistics', 'wrong_number', 'internal_personal'].includes(category);

    // Safeguard: If confidence is low or doubtful, do NOT exclude genuine investors
    if (isExcluded && confidence < 0.65) {
      log.warn(ROUTE, `Triage confidence too low (${confidence}) for exclusion (${category}). Defaulting to evaluable support call.`);
      return {
        detected_category: 'support',
        is_evaluable: true,
        confidence,
        opening_quote: parsed.opening_quote || '',
        reason: `Ambiguous opening defaulted to support call (confidence ${confidence})`,
      };
    }

    const isEvaluable = !isExcluded;

    return {
      detected_category: category,
      is_evaluable: isEvaluable,
      confidence,
      opening_quote: parsed.opening_quote || '',
      reason: parsed.reason || 'Classification complete',
    };
  } catch (err: any) {
    log.error(ROUTE, `Failed to classify call opening: ${err.message}. Defaulting to evaluable support call.`);
    return {
      detected_category: 'support',
      is_evaluable: true,
      confidence: 0.5,
      opening_quote: '',
      reason: 'Classifier error fallback to support',
    };
  }
}

// ── Non-English Text Detection & Parameter Translation ─────────────────────────
export function hasNonEnglishText(text: string): boolean {
  if (!text) return false;
  if (/[\u0900-\u0D7F]/.test(text)) return true;
  const hinglishPattern = /\b(haan|nahi|nahin|kya|toh|karna|bol raha|accha|theek|bhi|aur|kaise|mera|aapka|sir ji|bataiye|samajh|paise|rupaye|boliye|kariye|dekh lijiye|batata hoon|kar deta hoon|bhaiya|bhai|humne|humara|dala|matlab|kaunse|apne|baat kar|is cheez|hume pata)\b/i;
  return hinglishPattern.test(text);
}

export async function translateParametersToEnglish(
  params: any[],
  geminiKeys: string[]
): Promise<any[]> {
  if (!Array.isArray(params) || params.length === 0) return params;
  const needsTranslation = params.some(
    (p) => hasNonEnglishText(p.explanation || '') || hasNonEnglishText(p.quote || '') || hasNonEnglishText(p.reasoning || '')
  );
  if (!needsTranslation) return params;

  log.info(ROUTE, `Non-English dialogue quotes detected in parameter explanations. Running translation pass to English...`);
  const prompt = `You are a QA Auditor translation specialist for Wint Wealth.
The following QA evaluation parameter objects contain dialogue citations in Hindi, Hinglish, or regional speech in their "explanation", "reasoning", or "quote" fields (e.g., 'Theek hai, bhaiya', 'Pura HNI ka hi aaya', 'Aap Ahaan se baat kar sakte ho', etc.).

TASK:
- Translate all non-English / Hindi / Hinglish dialogue quotes, phrases, and words into fluent, natural English.
- Example: "Turn 50 [RM] ('Theek hai, bhaiya. Okay, aur kuch ho toh batana.')" -> "Turn 50 [RM] ('All right, brother. Okay, let me know if there is anything else.')"
- Example: "Turn 34 [RM] ('Pura HNI ka hi aaya. Matlab humara toh 20 Cr humne jo dala tha wo tha.')" -> "Turn 34 [RM] ('It was entirely from HNIs. Meaning, the 20 Cr that we had contributed was that.')"
- Example: "Turn 48 [RM] ('Aap Ahaan se baat kar sakte ho is cheez ke liye')" -> "Turn 48 [RM] ('You can speak to Ahaan regarding this')"
- Keep all parameter IDs, names, maxScores, earnedScores, and statuses ('Yes', 'Half', 'No', 'NA') exactly unchanged.
- Return ONLY the updated JSON array matching the input schema.

INPUT PARAMETERS:
${JSON.stringify(params, null, 2)}`;

  try {
    const raw = await geminiGenerate(
      geminiKeys,
      DEFAULT_GEMINI_MODEL,
      [{ role: 'user', parts: [{ text: prompt }] }],
      { responseMimeType: 'application/json' }
    );
    const translated = JSON.parse(raw.replace(/```json/g, '').replace(/```/g, '').trim());
    if (Array.isArray(translated) && translated.length === params.length) {
      log.info(ROUTE, `Successfully translated all parameter explanations to English.`);
      return translated;
    }
  } catch (err: any) {
    log.warn(ROUTE, `Parameter translation pass failed: ${err.message}. Preserving original parameters.`);
  }
  return params;
}

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
        verdict, is_evaluable, parameters, transcript_turns, sop_triggers, compliance_tripwire, scored_at
      ) VALUES ($1, $2, $3, $4, 'support', $5, null, null, null, null, 0, 'NOT_SCOREABLE', true, $6, '[]'::jsonb, '[]'::jsonb, false, NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        verdict = 'NOT_SCOREABLE', is_evaluable = true, sop_triggers = '[]'::jsonb, scored_at = NOW()
    `, [call.call_id, resolvedRm, resolvedTl, call.phone_number, call.duration_seconds || 0, JSON.stringify(paramsMap)]);

    return { callId: call.call_id, verdict: 'NOT_SCOREABLE', iqs: null, sopTriggers: [] };
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

    // If existing transcript still contains non-English dialogue, translate it into English before scoring
    const hasRegionalSpeech = transcriptTurns.some(t => hasNonEnglishText(t.text));
    if (hasRegionalSpeech) {
      log.info(ROUTE, `Existing transcript turns contain non-English dialogue. Translating dialogue to English...`);
      try {
        const transPrompt = `Translate the following dialogue turns into fluent, natural English.
Preserve speaker ('RM' vs 'Customer'), timestamps ('time'), turn indices ('turnIndex'), and financial/brand terms ('Wint Wealth', bond names, percentages).
Return valid JSON array matching the exact input structure:
${JSON.stringify(transcriptTurns, null, 2)}`;
        const rawTrans = await geminiGenerate(
          geminiKeys,
          DEFAULT_GEMINI_MODEL,
          [{ role: 'user', parts: [{ text: transPrompt }] }],
          { responseMimeType: 'application/json' }
        );
        const parsed = JSON.parse(rawTrans.replace(/```json/g, '').replace(/```/g, '').trim());
        if (Array.isArray(parsed) && parsed.length === transcriptTurns.length) {
          transcriptTurns = parsed;
        }
      } catch (err: any) {
        log.warn(ROUTE, `Dialogue translation failed: ${err.message}. Proceeding with existing turns.`);
      }
    }
  } else {
    log.info(ROUTE, `Transcribing audio from S3 for PCG call ${call.call_id}: ${call.recording_url}`);
    const { fileUri, mimeType, buffer } = await downloadAndUploadAudio(call.recording_url, apiKey);

    const durationMins = Math.floor((call.duration_seconds || 0) / 60);
    const durationSecs = ((call.duration_seconds || 0) % 60).toString().padStart(2, '0');
    const formattedDuration = `${durationMins}:${durationSecs}`;

    const diarizationPrompt = `Listen carefully to this phone call between a Wint Wealth Relationship Manager (RM) and an investor (Customer).
The total duration of this audio recording is exactly ${formattedDuration} (${call.duration_seconds || 0} seconds).

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
  * Representative names and investor names (e.g., Sreeram, Nandini, Vishal, Sahil, Shruti, Gaurav, etc.)
  * "Wint Wealth" or "Wint Wealth PCG" brand mentions
  * Financial products, bond names, interest/yield rates, fixed deposit mentions, and specific numbers (e.g. "9 to 12%", "13% Club", "Senior Secured Bonds").
- Identify whether each speaker is "RM" (the Wint Wealth representative) or "Customer" (the client/investor).
- Provide the timestamp in "MM:SS" format for each turn.

Return valid JSON matching:
{
  "detected_language": "English" | "Hindi" | "Hinglish" | "Tamil" | "Telugu" | "Marathi" | "Gujarati" | "Other",
  "dead_air_count": number,
  "interruption_count": number,
  "turns": [
    { "speaker": "RM" | "Customer", "time": "MM:SS", "text": "fluent English dialogue..." }
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

      // ── Automated Tail Verification & Recovery Pass ─────────────────────────
      // If the transcript stopped prematurely (>20s before call duration ends),
      // execute a targeted closing pass to capture the final instances of the call.
      const parseTsSecs = (ts: string): number => {
        if (!ts) return 0;
        const parts = ts.trim().split(':');
        if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        if (parts.length === 3) return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
        return 0;
      };

      const lastTurn = transcriptTurns[transcriptTurns.length - 1];
      const lastTurnSecs = lastTurn ? parseTsSecs(lastTurn.time) : 0;
      const callDurationSecs = call.duration_seconds || 0;
      const missingTailSeconds = callDurationSecs - lastTurnSecs;

      if (callDurationSecs > 45 && missingTailSeconds > 20) {
        log.info(ROUTE, `Transcript stopped early at ${lastTurn?.time || '00:00'} (${lastTurnSecs}s), but call duration is ${formattedDuration} (${callDurationSecs}s). Missing ${missingTailSeconds}s. Running tail recovery pass to capture final instances...`);
        try {
          const tailPrompt = `The previous transcription of this phone call ended early at timestamp ${lastTurn?.time || '00:00'}, but the call audio continues until ${formattedDuration} (${callDurationSecs} seconds).
The final instances of the call (closing pleasantries, wrap-up discussion, next steps, 'thank you', 'take care', 'okay bye', and call disconnect) were cut off and must be captured.

Listen to the audio starting from ${lastTurn?.time || '00:00'} until the very end of the recording (${formattedDuration}).
Transcribe ALL remaining turns of conversation until the call ends into fluent English.

Return valid JSON:
{
  "tail_turns": [
    { "speaker": "RM" | "Customer", "time": "MM:SS", "text": "fluent English dialogue..." }
  ]
}`;

          const tailRaw = await callGeminiForCall(
            geminiKeys,
            [{
              parts: [
                { file_data: { mime_type: mimeType, file_uri: fileUri } },
                { text: tailPrompt },
              ]
            }],
            undefined,
            120_000
          );

          const parsedTail = JSON.parse(tailRaw.replace(/```json/g, '').replace(/```/g, '').trim());
          const newTurns = parsedTail.tail_turns || parsedTail.turns || [];
          if (Array.isArray(newTurns) && newTurns.length > 0) {
            let nextIdx = transcriptTurns.length + 1;
            for (const nt of newTurns) {
              const ntSecs = parseTsSecs(nt.time);
              if (ntSecs > lastTurnSecs || (ntSecs === lastTurnSecs && nt.text !== lastTurn?.text)) {
                transcriptTurns.push({
                  speaker: nt.speaker === 'Customer' ? 'Customer' : 'RM',
                  text: nt.text || '',
                  time: nt.time || formattedDuration,
                  turnIndex: nextIdx++,
                });
              }
            }
            log.info(ROUTE, `Successfully recovered ${newTurns.length} closing turns. Transcript now has ${transcriptTurns.length} turns ending at ${transcriptTurns[transcriptTurns.length - 1]?.time}.`);
          }
        } catch (tailErr: any) {
          log.warn(ROUTE, `Tail recovery pass encountered error: ${tailErr.message}. Keeping initial ${transcriptTurns.length} turns.`);
        }
      }
    } finally {
      // Clean up Gemini File API upload
      try {
        const fileNameMatch = fileUri.split('/files/')[1];
        if (fileNameMatch) await ai.files.delete({ name: `files/${fileNameMatch}` });
      } catch { }
    }
  }

  const transcriptText = transcriptTurns.map((t) => `Turn ${t.turnIndex} [${t.speaker} - ${t.time}]: ${t.text}`).join('\n');

  // 4. Stage 1: Initial Call Classification & Triage (Opening 45-60 seconds)
  const openingTurns = transcriptTurns.slice(0, 8);
  const openingDialogueText = openingTurns.map((t) => `Turn ${t.turnIndex} [${t.speaker} - ${t.time}]: ${t.text}`).join('\n');
  const triage = await classifyPcgCallOpening(openingDialogueText, [apiKey]);

  log.info(ROUTE, `Stage 1 Triage for call ${call.call_id}: category=${triage.detected_category}, is_evaluable=${triage.is_evaluable}, confidence=${triage.confidence}`);

  // If excluded: immediately store as EXCLUDED_NON_CLIENT with NULL IQS score and abort evaluation
  if (!triage.is_evaluable) {
    const exclusionText = `${triage.reason}${triage.opening_quote ? ` (Quote: "${triage.opening_quote}")` : ''}`;
    log.info(ROUTE, `Call ${call.call_id} excluded from quality evaluation: ${exclusionText}`);

    await query(`
      INSERT INTO pcg_call_evaluations (
        call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
        iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
        verdict, is_evaluable, exclusion_reason, parameters, transcript_turns, sop_triggers, compliance_tripwire, scored_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, null, null, null, null, 0, 'EXCLUDED_NON_CLIENT', false, $7, '[]'::jsonb, $8, '[]'::jsonb, false, NOW(), NOW())
      ON CONFLICT (call_id) DO UPDATE SET
        rm_name = EXCLUDED.rm_name,
        tl_name = EXCLUDED.tl_name,
        customer_phone = EXCLUDED.customer_phone,
        call_category = EXCLUDED.call_category,
        duration_seconds = EXCLUDED.duration_seconds,
        iqs_score = null,
        process_score = null,
        communication_score = null,
        customer_service_score = null,
        applicable_weight = 0,
        verdict = 'EXCLUDED_NON_CLIENT',
        is_evaluable = false,
        exclusion_reason = EXCLUDED.exclusion_reason,
        parameters = '[]'::jsonb,
        transcript_turns = EXCLUDED.transcript_turns,
        sop_triggers = '[]'::jsonb,
        compliance_tripwire = false,
        compliance_reason = null,
        scored_at = NOW(),
        updated_at = NOW()
    `, [
      call.call_id,
      resolvedRm,
      resolvedTl,
      call.phone_number,
      triage.detected_category,
      call.duration_seconds,
      exclusionText,
      JSON.stringify(transcriptTurns),
    ]);

    await query(`
      UPDATE pcg_call_recordings
      SET
        call_nature = 'non_client',
        exclusion_reason = $1,
        call_category = $1,
        category_source = 'ai_triage'
      WHERE call_id = $2
    `, [triage.detected_category, call.call_id]);

    return {
      callId: call.call_id,
      rmName: resolvedRm,
      tlName: resolvedTl,
      category: triage.detected_category,
      isEvaluable: false,
      verdict: 'EXCLUDED_NON_CLIENT',
      exclusionReason: exclusionText,
      iqs: null,
      parameters: [],
      transcriptTurns,
      sopTriggers: [],
    };
  }

  // 5. Retrieve PCG-Exclusive KB Context
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

Please evaluate this PCG call strictly against the 11 parameters, compliance gates, and the 7 SOP conduct/communication monitoring categories. Output valid JSON only.`;

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

  const category = (evalJson.call_category && ['13_pitching', 'upselling', 'support'].includes(evalJson.call_category))
    ? evalJson.call_category
    : (triage.detected_category || '13_pitching');

  // 6b. Mandatory English Translation Guard: Ensure all cited parameter quotes & explanations are 100% in English
  const cleanedParameters = await translateParametersToEnglish(formattedParameters, [apiKey, ...geminiKeys]);

  // 6c. Parse & Sanitize SOP Triggers (7 Communication & Conduct Monitoring Categories)
  const rawSopTriggers = Array.isArray(evalJson.sop_triggers) ? evalJson.sop_triggers : [];
  const validCategories = new Set([
    'RM Communication & Tone',
    'Professional Boundary Monitoring',
    'Returns & Benefits Negotiation',
    'Out-of-Scope Queries',
    'Internal Tools Probing',
    'Customer Behaviour & Hostility',
    'Business Information Probing',
  ]);

  const sanitizedSopTriggers: SopTrigger[] = rawSopTriggers
    .filter((tr: any) => tr && typeof tr === 'object' && (tr.quote || tr.signal))
    .map((tr: any) => {
      const cat = String(tr.category || '').trim();
      const category = validCategories.has(cat) ? cat : 'Customer Behaviour & Hostility';
      const sev = String(tr.severity || '').toUpperCase().trim();
      const severity: 'CRITICAL' | 'MEDIUM' | 'LOW' =
        sev === 'CRITICAL' ? 'CRITICAL' : sev === 'LOW' ? 'LOW' : 'MEDIUM';
      const dirStr = String(tr.direction || '').trim().toLowerCase();
      const direction: 'Customer said this to RM' | 'RM said this to customer' =
        dirStr.includes('rm said') || dirStr.includes('rm to customer')
          ? 'RM said this to customer'
          : 'Customer said this to RM';

      const turnIdx = typeof tr.turn_index === 'number'
        ? tr.turn_index
        : typeof tr.turnIndex === 'number'
        ? tr.turnIndex
        : undefined;

      return {
        category,
        severity,
        direction,
        signal: String(tr.signal || category).trim(),
        timestamp: tr.timestamp ? String(tr.timestamp).trim() : undefined,
        turn_index: turnIdx,
        quote: String(tr.quote || '').trim(),
      };
    });

  // 7. Store Result in pcg_call_evaluations
  await query(`
    INSERT INTO pcg_call_evaluations (
      call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
      iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
      verdict, is_evaluable, exclusion_reason, parameters, compliance_tripwire, compliance_reason, ai_coaching_tip,
      transcript_turns, sop_triggers, scored_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, null, $13, $14, $15, null, $16, $17, NOW(), NOW())
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
      is_evaluable = true,
      exclusion_reason = null,
      parameters = EXCLUDED.parameters,
      compliance_tripwire = EXCLUDED.compliance_tripwire,
      compliance_reason = EXCLUDED.compliance_reason,
      ai_coaching_tip = null,
      transcript_turns = EXCLUDED.transcript_turns,
      sop_triggers = EXCLUDED.sop_triggers,
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
    JSON.stringify(cleanedParameters),
    complianceTripwire,
    complianceReason,
    JSON.stringify(transcriptTurns),
    JSON.stringify(sanitizedSopTriggers),
  ]);

  await query(`
    UPDATE pcg_call_recordings
    SET
      call_nature = 'client',
      call_category = $1,
      category_source = 'ai_triage'
    WHERE call_id = $2
  `, [category, call.call_id]);

  log.info(ROUTE, `Successfully evaluated PCG call ${call.call_id} — IQS: ${iqsScore}%, Verdict: ${verdict}, SOP Triggers: ${sanitizedSopTriggers.length}`);

  return {
    callId: call.call_id,
    rmName: resolvedRm,
    tlName: resolvedTl,
    category,
    isEvaluable: true,
    iqs: iqsScore,
    verdict,
    parameters: cleanedParameters,
    transcriptTurns,
    sopTriggers: sanitizedSopTriggers,
  };
}

