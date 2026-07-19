import Anthropic from '@anthropic-ai/sdk';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';
import { PASCAL_TO_DB } from '@/lib/param-keys';
import { geminiGenerate, callGeminiForCall, getIQSGeminiKeys, fetchAndTranscribeAudio } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { fireQualityAlert } from '@/lib/quality-alert';
import {
  getSystemPrompt, buildScoringPrompt, parseScoringResponse,
  analyzeConversationTiming,
} from '@/lib/quality';
import { buildScoringPrompt as buildScoringPromptV4, parseAndScore } from '@/lib/scoring/prompt_v4';
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
    score: score === 'Yes' ? true : score === 'No' ? false : score === 'Half' ? 0.5 : null,
    reasoning,
  };
}

// ── Shared KB Context Retrieval helper ───────────────────────────────────────────────
export async function getKbContextForScoring(
  disposition: string,
  subDisposition: string,
  transcriptText: string,
  config: any,
  requireDisposition = false
): Promise<string> {
  try {
    const searchQuery = disposition
      ? `${disposition} ${subDisposition}`.trim()
      : (requireDisposition ? '' : extractQueryFromTranscript(transcriptText));

    if (!searchQuery) return '';

    const allChunks = await fetchKnowledgeChunks();
    const relevant  = retrieveRelevantChunks(allChunks, searchQuery, 5);
    if (!relevant.length) return '';

    const docNames = config.knowledgeBaseDocNames || {};
    return relevant.map(c => {
      const driveId = c.fileName.trim();
      const label = docNames[driveId] || (/^[A-Za-z0-9_-]{25,}$/.test(driveId) ? (c.content.split('\n')[0].trim() || 'KB Document') : driveId);
      return `[${label}]\n${c.content}`;
    }).join('\n---\n');
  } catch (err: any) {
    console.warn('[scoring-engine] KB context retrieval failed:', err.message);
    return '';
  }
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

  const kbContext = await getKbContextForScoring(disposition, subDisposition, chatTranscriptText, config, true);

  const promises = calls.map(async (call) => {
    let segments = Array.isArray(call.transcript) ? call.transcript : [];
    let callText  = segmentsToText(segments);

    if (!callText && call.recording_url) {
      console.log(`[scoring-engine] Call ${call.id} transcript is empty/null. Attempting auto-transcription on the fly before scoring...`);
      try {
        const parsed = await fetchAndTranscribeAudio(call.recording_url, geminiKeys);
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
      } catch (err: any) {
        console.error(`[scoring-engine] scoreLinkedCalls auto-transcription failed for call ${call.id}:`, err.message);
      }
    }

    if (!callText) {
      await updateCallRecordingStatus(call.id, 'scored');
      return;
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
      true,
    );

    try {
      const iqsSystemPrompt = getSystemPrompt('agent', config.iqsScoringPrompt);
      const raw = await geminiGenerate(
        geminiKeys,
        'gemini-3.5-flash',
        [{ role: 'user', parts: [{ text: iqsSystemPrompt + '\n\n' + scoringPrompt }] }],
        {},
        60_000,
      );

      const parsed = parseScoringResponse(raw, chatId, 'agent');
      const parameters: Record<string, IQSParameterResult> = {};
      for (const [k, val] of Object.entries(parsed.scores || {})) {
        const key = PASCAL_TO_DB[k] || k.toLowerCase();
        parameters[key] = toParamResult(val as ParamScore, (parsed.reasoning || {})[k] || (parsed.reasoning || {})[key] || '');
      }

      // Persist transcript
      await insertCallRecording({
        id: call.id,
        transcript: segments,
      });

      await updateCallIQSScore({ chatId, callIqsScore: parsed.iqs, callParameters: parameters, callModelVersion: 'gemini-3.5-flash' });
      await updateCallRecordingStatus(call.id, 'scored');
      console.log(`[scoring-engine] Scored combined chat+call for ${chatId} → IQS ${parsed.iqs}`);

      try {
        const { runCallPipeline } = await import('@/lib/scoring/call-pipeline');
        await runCallPipeline(call.id);
        console.log(`[scoring-engine] Automatically executed call-pipeline for call ${call.id}`);
      } catch (pipelineErr: any) {
        console.error(`[scoring-engine] Call pipeline trigger failed for call ${call.id}:`, pipelineErr.message);
      }
    } catch (err: any) {
      console.error(`[scoring-engine] Combined IQS scoring failed for call ${call.id}:`, err.message);
    }
  });

  await Promise.allSettled(promises);
}

// ── Core scoring (called from webhook + cron) ────────────────────────────────────
export async function executeScoring(
  conv: ConversationRow,
  agentName: string,
  disposition: string,
  subDisposition: string,
  contactPhone?: string,
): Promise<{ chatId: string; iqs: number; botIqs?: number } | null> {
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
  const kbContext = await getKbContextForScoring(disposition, subDisposition, transcriptText, config, false);

  let callTranscripts: string[] = [];
  try {
    const calls = await query<any>('SELECT transcript FROM call_recordings WHERE chat_id = $1 ORDER BY called_at ASC', [chatId]);
    callTranscripts = calls.map(c => typeof c.transcript === 'string' ? c.transcript : transcriptFromJsonb(c.transcript)).filter(Boolean);
  } catch (err) {
    console.error(`[scoring-engine] executeScoring error checking calls:`, err);
  }

  const runLeg = async (legType: 'bot' | 'human') => {
    const { system, user } = buildScoringPromptV4(effectiveTranscript, {
      kbContext,
      callTranscripts,
      leg: legType,
      channel: timing.conversationType === 'bot' ? 'bot' : 'human'
    });
    let raw = '';
    if (provider === 'claude' && anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 2000,
        system, messages: [{ role: 'user', content: user }],
      });
      raw = resp.content[0].type === 'text' ? resp.content[0].text : '';
    } else if (geminiKeys.length) {
      raw = await geminiGenerate(
        geminiKeys, 'gemini-3.5-flash',
        [{ role: 'user', parts: [{ text: system + '\\n\\n' + user }] }],
        {}, 60000,
      );
    } else {
      throw new Error('No LLM API key configured');
    }
    return parseAndScore(raw);
  };

  let botPass: any = null;
  let humanPass: any = null;

  try {
    if (timing.conversationType === 'bot') {
      botPass = await runLeg('bot');
    } else if (timing.conversationType === 'agent') {
      humanPass = await runLeg('human');
    } else {
      botPass = await runLeg('bot');
      humanPass = await runLeg('human');
    }
  } catch (e: any) {
    console.error(`[scoring-engine] LLM generation failed for ${chatId}:`, e);
    return null;
  }

  const modelVersion = provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-3.5-flash';

  const convertParameters = (parsed: any): Record<string, IQSParameterResult> => {
    if (!parsed || !parsed.parameters) return {};
    const out: Record<string, IQSParameterResult> = {};
    for (const [k, cell] of Object.entries(parsed.parameters)) {
      const typedCell = cell as any;
      const key = PASCAL_TO_DB[k] || k.toLowerCase();
      out[key] = {
        score: typedCell.score === 1 ? true : typedCell.score === 0 ? false : typedCell.score === 0.5 ? 0.5 : null,
        reasoning: typedCell.comment || ''
      };
    }
    return out;
  };

  const primaryPass = humanPass || botPass;
  if (!primaryPass) return null;

  const parameters = convertParameters(primaryPass);
  const botParameters = humanPass && botPass ? convertParameters(botPass) : undefined;
  
  const uncertainParameters = primaryPass.review_parameters.map((p: string) => ({ 
    parameter: p, 
    question: primaryPass.parameters[p]?.comment || '' 
  }));

  await insertIQSScore({
    chatId,
    iqsScore: primaryPass.iqs_score || 0,
    parameters,
    modelVersion,
    uncertainParameters,
    botIqsScore: botPass && humanPass ? (botPass.iqs_score || 0) : undefined,
    botParameters,
    botModelVersion: botPass && humanPass ? modelVersion : undefined,
    breaches: primaryPass.breaches?.map((b: any) => `${b.type}: ${b.quote}`),
    answerChanges: primaryPass.answer_changes?.map((b: any) => `${b.type}: ${b.quote}`),
    unrelatedCallFlag: primaryPass.unrelated_call_flag
  });

  // Update timing on conversation row
  await upsertConversation({
    id: chatId,
    conversationType: timing.conversationType,
    frtSeconds: timing.frt ?? null,
    botToTeamSeconds: timing.botToTeamSecs ?? null,
    resolutionSeconds: timing.resolutionTime ?? null,
  });

  const finalAgentName = effectiveAgentName;
  console.log(`[scoring-engine] Scored chat ${chatId} → IQS ${primaryPass.iqs_score}% type=${timing.conversationType}`);

  // Audit: log every scoring event for full traceability
  storeAppendAuditEntry({
    id: crypto.randomUUID(),
    action: 'bot_scored',
    chatId,
    actorEmail: 'bot',
    actorRole: 'system',
    ts: new Date().toISOString(),
    meta: { iqs: primaryPass.iqs_score, agentName: finalAgentName, model: modelVersion },
  }).catch(() => {});

  // ── Slack + Sheet alert — deduplicated via KV ─────────────────────────────────────────
  fireQualityAlert({
    chatId,
    agentName:           finalAgentName,
    contactPhone,
    scores:              Object.fromEntries(Object.entries(parameters).map(([k,v]) => [k, String(v.score)])),
    reasoning:           Object.fromEntries(Object.entries(parameters).map(([k,v]) => [k, v.reasoning])),
    iqs:                 primaryPass.iqs_score || 0,
    disposition,
    subDisposition,
    uncertainParameters,
  }).catch(() => {});

  return { 
    chatId, 
    iqs: primaryPass.iqs_score || 0,
    botIqs: botPass && humanPass ? (botPass.iqs_score || 0) : undefined
  };
}
