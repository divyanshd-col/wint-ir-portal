/**
 * POST /api/webhooks/chat
 *
 * Webhook endpoint for Robylon (or any chat platform) to push transcripts
 * immediately after a chat closes. Automatically scores via IQS pipeline
 * and stores the result in KV.
 *
 * Authentication: Bearer token in Authorization header
 *   Authorization: Bearer <WEBHOOK_SECRET>
 * Or as a query param: ?secret=<WEBHOOK_SECRET>
 *
 * Expected payload (all fields optional except one of transcript/messages):
 * {
 *   "chat_id": "18967",
 *   "conversation_id": "uuid",          // optional
 *   "agent_name": "Bhavana",            // optional — enriches the score entry
 *   "tags": "App Issue",                // optional — issue category
 *   "csat": "Good" | "Could be better" | "Bad" | "5" | "3" | "1",
 *   "conversation_started": "ISO8601",  // optional date
 *   "channel": "chat" | "call",         // optional — defaults to "chat"
 *
 *   // Either structured messages (preferred):
 *   "messages": [
 *     { "sender": "User",    "content": "Hi I have a query" },
 *     { "sender": "Bhavana", "content": "Good afternoon!" }
 *   ],
 *
 *   // Or a flat transcript string:
 *   "transcript": "Customer: Hi...\nAgent: Good afternoon..."
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import { IQS_SYSTEM_PROMPT, buildScoringPrompt, parseScoringResponse } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';
import { storeAppendIQSScore } from '@/lib/store';
import Anthropic from '@anthropic-ai/sdk';

// ── CSAT normalisation ────────────────────────────────────────────────────────
function normaliseCsat(raw: string | undefined): string {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase();
  if (v === 'good' || v === '5') return '5';
  if (v === 'could be better' || v === 'ok' || v === 'okay' || v === '3') return '3';
  if (v === 'bad' || v === '1') return '1';
  return raw; // pass through unknown values
}

// ── Messages → transcript text ────────────────────────────────────────────────
interface RobyMessage { sender?: string; content?: string; role?: string; text?: string; }

function messagesToTranscript(messages: RobyMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const sender = m.sender || m.role || '';
    const content = (m.content || m.text || '').trim();
    if (!content) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
        low.includes('waiting to assign') || low.includes('please rate your experience') ||
        (m as any).buttons) continue;
    const role = sender === 'User' || sender === 'user' || sender === 'customer'
      ? 'Customer'
      : sender === 'Bot' || sender === 'bot'
      ? 'Bot'
      : 'Agent';
    lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

// ── Auth check ────────────────────────────────────────────────────────────────
function isAuthorised(req: NextRequest): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    // If no secret is set, log a warning but allow (easier dev setup)
    console.warn('[webhook] WEBHOOK_SECRET not set — accepting all requests');
    return true;
  }
  // Check Authorization: Bearer <secret>
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader === `Bearer ${secret}`) return true;
  // Check ?secret= query param as fallback
  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;
  return false;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    chat_id,
    conversation_id,
    agent_name,
    tags = '',
    csat,
    conversation_started,
    channel = 'chat',
    messages,
    transcript: rawTranscript,
  } = body;

  // Build transcript text
  let transcript = '';
  if (rawTranscript) {
    transcript = String(rawTranscript).trim();
  } else if (Array.isArray(messages) && messages.length) {
    transcript = messagesToTranscript(messages);
  }

  if (!transcript) {
    return NextResponse.json(
      { error: 'Payload must include either "transcript" (string) or "messages" (array)' },
      { status: 400 }
    );
  }

  const chatId    = String(chat_id || conversation_id || `wh_${Date.now()}`);
  const agentName = String(agent_name || '');
  const csatNorm  = normaliseCsat(csat);
  const date      = conversation_started
    ? String(conversation_started).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Add channel note to transcript for call scoring
  const transcriptForScoring = channel === 'call'
    ? `[CHANNEL: PHONE CALL]\n${transcript}`
    : transcript;

  const config = await readConfig();
  const provider = config.llmProvider || 'gemini';
  const geminiKeys = getOrderedGeminiKeys(config);

  const userPrompt = buildScoringPrompt(transcriptForScoring, tags, chatId);

  let rawResponse: string;
  try {
    if (provider === 'claude' && config.anthropicApiKey) {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: IQS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
    } else if (geminiKeys.length) {
      rawResponse = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: IQS_SYSTEM_PROMPT + '\n\n' + userPrompt }] }],
        {},
        60000
      );
    } else {
      return NextResponse.json({ error: 'No LLM API key configured' }, { status: 500 });
    }
  } catch (err: any) {
    console.error('[webhook] LLM error:', err.message);
    return NextResponse.json({ error: `LLM error: ${err.message}` }, { status: 500 });
  }

  try {
    const parsed = parseScoringResponse(rawResponse, chatId);

    const entry: IQSScoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scoredAt: new Date().toISOString(),
      provider,
      model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash',
      scoredBy: `webhook:${channel}`,   // marks this as auto-scored
      agentName: agentName || (parsed as any).extractedAgentName || '',
      date,
      tags,
      csat: csatNorm,
      slackUrl: '',
      transcript,
      ...parsed,
    };

    await storeAppendIQSScore(entry);

    console.log(`[webhook] Scored chat ${chatId} → IQS ${entry.iqs}% (${agentName || 'unknown agent'})`);

    return NextResponse.json({
      ok: true,
      chat_id: chatId,
      iqs: entry.iqs,
      agent: agentName,
      scored_at: entry.scoredAt,
    });
  } catch (err: any) {
    console.error('[webhook] Parse error:', err.message);
    return NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 500 });
  }
}
