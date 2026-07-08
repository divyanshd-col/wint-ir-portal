import Anthropic from '@anthropic-ai/sdk';
import { readConfig } from '@/lib/config';
import { geminiGenerate, callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { fireQualityAlert } from '@/lib/quality-alert';
import {
  IQS_SYSTEM_PROMPT, buildScoringPrompt, parseScoringResponse,
  analyzeConversationTiming,
} from '@/lib/quality';
import type { TimedMessage, ParamScore } from '@/lib/quality';
import {
  CALL_TRANSCRIPTION_PROMPT,
  CALL_DISPOSITION_CLASSIFY_PROMPT,
  parseTranscriptionResponse,
  parseCallDispositionClassified,
  segmentsToText,
} from '@/lib/call-quality';
import {
  upsertConversation,
  insertIQSScore,
  updateCallIQSScore,
  getLinkedUnscoredCallsForChat,
  updateCallRecordingStatus,
  insertCallRecording,
  updateCallRecordingMetrics,
  type ConversationRow,
  type IQSParameterResult,
} from '@/lib/robylon/db';
import { storeAcquireScoringLock, storeAppendAuditEntry } from '@/lib/store';
import { transcriptFromJsonb, extractQueryFromTranscript } from './transcript';

// ── Convert ParamScore → IQSParameterResult ───────────────────────────────────────────
function toParamResult(score: ParamScore, reasoning: string): IQSParameterResult {
  return {
    score: score === 'Yes' ? true : score === 'No' ? false : null,
    reasoning,
  };
}

// ── Call IQS scoring for calls linked to a chat ─────────────────────────────────────
export async function scoreLinkedCallsForChat(
  chatId: string,
  chatTranscriptText: string,
  disposition: string,
  subDisposition: string,
  config: any,
): Promise<void> {
  const calls = await getLinkedUnscoredCallsForChat(chatId);
  if (!calls.length) return;

  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) return;

  let kbContext = '';
  try {
    const searchQuery = disposition ? `${disposition} ${subDisposition}`.trim() : '';
    if (searchQuery) {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, searchQuery, 5);
      if (relevant.length) {
        const docNames = config.knowledgeBaseDocNames || {};
        kbContext = relevant.map(c => {
          const driveId = c.fileName.trim();
          const label = docNames[driveId] || (/^[A-Za-z0-9_-]{25,}$/.test(driveId) ? (c.content.split('\n')[0].trim() || 'KB Document') : driveId);
          return `[${label}]\n${c.content}`;
        }).join('\n---\n');
      }
    }
  } catch {}

  for (const call of calls) {
    let segments = Array.isArray(call.transcript) ? call.transcript : [];
    let callText  = segmentsToText(segments);

    if (!callText && call.recording_url) {
      console.log(`[scoring-engine] Call ${call.id} transcript is empty/null. Attempting auto-transcription on the fly before scoring...`);
      try {
        const audioRes = await fetch(call.recording_url);
        if (audioRes.ok) {
          let mimeType = 'audio/wav';
          const u = call.recording_url.toLowerCase().split('?')[0];
          if (u.endsWith('.mp3'))  mimeType = 'audio/mpeg';
          if (u.endsWith('.wav'))  mimeType = 'audio/wav';
          if (u.endsWith('.m4a'))  mimeType = 'audio/mp4';
          if (u.endsWith('.ogg'))  mimeType = 'audio/ogg';
          if (u.endsWith('.flac')) mimeType = 'audio/flac';
          
          const contentType = audioRes.headers.get('content-type');
          if (contentType) mimeType = contentType.split(';')[0].trim() || mimeType;
          
          const audioBase64 = Buffer.from(await audioRes.arrayBuffer()).toString('base64');
          
          const raw = await callGeminiForCall(
            geminiKeys,
            [{ parts: [
              { inline_data: { mime_type: mimeType, data: audioBase64 } },
              { text: CALL_TRANSCRIPTION_PROMPT },
            ]}],
            undefined,
            270_000,
          );
          
          const parsed = parseTranscriptionResponse(raw);
          const intCount = parsed.segments.filter(s => s.type === 'interruption').length;
          const daCount  = parsed.segments.filter(s => s.type === 'dead_air').length;
          
          await insertCallRecording({
            id: call.id,
            chatId: call.chat_id,
            agentId: call.agent_id,
            contactId: call.contact_id,
            recordingUrl: call.recording_url,
            durationSeconds: call.duration_seconds,
            calledAt: call.called_at,
            language: parsed.language,
            transcript: parsed.segments,
          });
          await updateCallRecordingMetrics({ id: call.id, interruptionCount: intCount, deadAirCount: daCount, status: 'linked' });
          
          segments = parsed.segments;
          callText = segmentsToText(segments);
          call.interruption_count = intCount;
          call.dead_air_count = daCount;
        }
      } catch (err: any) {
        console.error(`[scoring-engine] scoreLinkedCalls auto-transcription failed for call ${call.id}:`, err.message);
      }
    }

    if (!callText) {
      await updateCallRecordingStatus(call.id, 'scored');
      continue;
    }

    const combinedTranscript = `--- WHATSAPP CHAT TRANSCRIPT ---\n${chatTranscriptText}\n\n--- TELEPHONE CALL TRANSCRIPT ---\n${callText}`;
    const scoringPrompt = buildScoringPrompt(
      combinedTranscript,
      disposition,
      chatId,
      '',
      kbContext,
      subDisposition,
      'agent',
    );

    try {
      const iqsSystemPrompt = config.iqsScoringPrompt?.trim() || IQS_SYSTEM_PROMPT;
      const raw = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: iqsSystemPrompt + '\n\n' + scoringPrompt }] }],
        {},
        60_000,
      );

      const parsed = parseScoringResponse(raw, chatId, 'agent');
      const parameters: Record<string, IQSParameterResult> = {};
      for (const [key, val] of Object.entries(parsed.scores || {})) {
        parameters[key] = toParamResult(val as ParamScore, (parsed.reasoning || {})[key] || '');
      }

      // Persist transcript
      await insertCallRecording({
        id: call.id,
        transcript: segments,
      });

      await updateCallIQSScore({ chatId, callIqsScore: parsed.iqs, callParameters: parameters, callModelVersion: 'gemini-2.5-flash' });
      await updateCallRecordingStatus(call.id, 'scored');
      console.log(`[scoring-engine] Scored combined chat+call for ${chatId} → IQS ${parsed.iqs}`);
    } catch (err: any) {
      console.error(`[scoring-engine] Combined IQS scoring failed for call ${call.id}:`, err.message);
    }
  }
}

// ── Core scoring (called from webhook + cron) ────────────────────────────────────
export async function executeScoring(
  conv: ConversationRow,
  agentName: string,
  disposition: string,
  subDisposition: string,
  contactPhone?: string,
): Promise<{ chatId: string; iqs: number } | null> {
  const chatId = conv.id;

  // Atomic lock — prevents concurrent duplicate scorings when Robylon fires
  // multiple CLASSIFICATION_UPDATED events before any LLM call completes.
  const acquired = await storeAcquireScoringLock(chatId);
  if (!acquired) {
    console.log(`[scoring-engine] Scoring lock held for chat ${chatId} — skipping duplicate`);
    return null;
  }

  // Build transcript from JSONB array or fall back to plain text if stored differently
  let transcriptMessages: any[] = [];
  if (Array.isArray(conv.transcript)) {
    transcriptMessages = conv.transcript;
  } else if (conv.transcript && typeof conv.transcript === 'object' && Array.isArray((conv.transcript as any).messages)) {
    transcriptMessages = (conv.transcript as any).messages;
  }

  let transcriptText = transcriptFromJsonb(transcriptMessages);
  if (!transcriptText) {
    console.warn(`[scoring-engine] executeScoring: empty transcript for chat ${chatId}`);
    return null;
  }

  // Determine conversation type from stored timed messages
  const timedMessages: TimedMessage[] = transcriptMessages.map((m: any) => ({
    sender: m.sender_type === 'customer' ? 'user'
          : m.sender_type === 'bot'      ? 'bot'
          : (m.sender_name || 'Agent'),
    content: m.content || '',
    timestamp: m.timestamp,
  }));

  const timing = timedMessages.length
    ? analyzeConversationTiming(timedMessages, conv.closed_at ?? undefined)
    : { conversationType: 'agent' as const, frt: undefined, botToTeamSecs: undefined, resolutionTime: undefined, closureTime: undefined };

  const effectiveAgentName = agentName || (timing.conversationType === 'bot' ? 'Myra' : '');
  const effectiveTranscript = timing.conversationType === 'bot'
    ? `[BOT-HANDLED CHAT — No human agent involved. Score Opening, Call, Empathy as NA unless the bot explicitly performed them.]\n\n${transcriptText}`
    : transcriptText;

  const config       = await readConfig();
  const provider     = config.llmProvider || 'gemini';
  const geminiKeys   = getIQSGeminiKeys(config);
  const anthropicKey = config.iqsAnthropicApiKey || config.anthropicApiKey;

  // ── Fetch relevant KB chunks to ground the Technical scoring parameter ──────
  let kbContext = '';
  try {
    const searchQuery = disposition
      ? `${disposition} ${subDisposition}`.trim()
      : extractQueryFromTranscript(transcriptText);

    if (searchQuery) {
      const allChunks = await fetchKnowledgeChunks();
      const relevant  = retrieveRelevantChunks(allChunks, searchQuery, 5);
      if (relevant.length) {
        const docNames = config.knowledgeBaseDocNames || {};
        kbContext = relevant.map(c => {
          const driveId = c.fileName.trim();
          const label = docNames[driveId] || (/^[A-Za-z0-9_-]{25,}$/.test(driveId) ? (c.content.split('\n')[0].trim() || 'KB Document') : driveId);
          return `[${label}]\n${c.content}`;
        }).join('\n---\n');
        console.log(`[scoring-engine] KB context: ${relevant.length} chunks for query "${searchQuery}"`);
      }
    }
  } catch (err: any) {
    console.warn('[scoring-engine] KB fetch failed, scoring without context:', err.message);
  }

  const userPrompt = buildScoringPrompt(effectiveTranscript, disposition, chatId, '', kbContext, subDisposition, timing.conversationType);
  const iqsSystemPrompt = config.iqsScoringPrompt?.trim() || IQS_SYSTEM_PROMPT;

  let rawResponse: string;
  if (provider === 'claude' && anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 2000,
      system: iqsSystemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
  } else if (geminiKeys.length) {
    rawResponse = await geminiGenerate(
      geminiKeys, 'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: iqsSystemPrompt + '\n\n' + userPrompt }] }],
      {}, 60000,
    );
  } else {
    throw new Error('No LLM API key configured');
  }

  const parsed = parseScoringResponse(rawResponse, chatId, timing.conversationType);
  const modelVersion = provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash';

  // Convert ParamScore → IQSParameterResult for PostgreSQL storage
  const parameters: Record<string, IQSParameterResult> = {};
  for (const [key, val] of Object.entries(parsed.scores || {})) {
    parameters[key] = toParamResult(val as ParamScore, (parsed.reasoning || {})[key] || '');
  }

  await insertIQSScore({
    chatId,
    iqsScore: parsed.iqs,
    parameters,
    modelVersion,
    uncertainParameters: parsed.uncertainParameters,
  });

  // Update timing on conversation row
  await upsertConversation({
    id: chatId,
    conversationType: timing.conversationType,
    frtSeconds: timing.frt ?? null,
    botToTeamSeconds: timing.botToTeamSecs ?? null,
    resolutionSeconds: timing.resolutionTime ?? null,
  });

  const finalAgentName = effectiveAgentName || (parsed as any).extractedAgentName || '';
  console.log(`[scoring-engine] Scored chat ${chatId} → IQS ${parsed.iqs}% (${finalAgentName || 'unknown'}) type=${timing.conversationType}${timing.conversationType === 'bot' ? ' [bot-handled]' : ''}`);

  // Audit: log every scoring event for full traceability
  storeAppendAuditEntry({
    id: crypto.randomUUID(),
    action: 'bot_scored',
    chatId,
    actorEmail: 'bot',
    actorRole: 'system',
    ts: new Date().toISOString(),
    meta: { iqs: parsed.iqs, agentName: finalAgentName, model: modelVersion },
  }).catch(() => {});

  // ── Slack + Sheet alert — deduplicated via KV ─────────────────────────────────────────
  fireQualityAlert({
    chatId,
    agentName:           finalAgentName,
    contactPhone,
    scores:              parsed.scores    as Record<string, string>,
    reasoning:           parsed.reasoning as Record<string, string>,
    iqs:                 parsed.iqs,
    disposition,
    subDisposition,
    uncertainParameters: parsed.uncertainParameters,
  }).catch(() => {});

  return { chatId, iqs: parsed.iqs };
}
