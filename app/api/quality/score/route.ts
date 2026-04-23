import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { IQS_SYSTEM_PROMPT, buildScoringPrompt, parseScoringResponse, calculateIQS, trimTranscript, IQSScoreEntry } from '@/lib/quality';
import { storeAppendIQSScore, storeSetTranscript } from '@/lib/store';
import { sendSlackMessage } from '@/lib/slack';
import Anthropic from '@anthropic-ai/sdk';

// Parameters that trigger a Slack alert when they fail
const CRITICAL_PARAMS: { key: string; label: string }[] = [
  { key: 'Technical',    label: 'Technically / Legally Incorrect' },
  { key: 'AllQuestions', label: 'All Questions Not Answered' },
  { key: 'Process',      label: 'Process Incorrect' },
];

function fireQualityAlert(
  chatId: string,
  agentName: string,
  contactPhone: string,
  failedParams: { label: string; reasoning: string }[],
) {
  const token   = process.env.SLACK_BOT_TOKEN || '';
  const channel = process.env.QUALITY_SLACK_CHANNEL || '';
  if (!token || !channel || !failedParams.length) return;

  const chatLink = /^\d+$/.test(chatId.trim())
    ? `<https://app.robylon.ai/unified-inbox/share/${chatId}|${chatId}>`
    : chatId;

  const failLines = failedParams
    .map(p => `• *${p.label}*: ${p.reasoning}`)
    .join('\n');

  const text = [
    `⚠️ *Quality Flag — Parameter Failure*`,
    `*Chat:* ${chatLink}`,
    contactPhone ? `*Phone:* ${contactPhone}` : null,
    `*Agent:* ${agentName || 'Unknown'}`,
    ``,
    `*Failed parameters:*`,
    failLines,
  ].filter(l => l !== null).join('\n');

  sendSlackMessage(channel, text, token).catch(() => {});
}

function qualityAccess(session: any): boolean {
  const role = session?.user?.role;
  return !!role && ['admin', 'quality', 'tl'].includes(role);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !qualityAccess(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const {
    transcript,
    chatId = '',
    agentName = '',
    tags = '',
    date = '',
    csat = '',
    slackUrl = '',
    contactPhone = '',
  } = body;

  if (!transcript?.trim()) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  const config       = await readConfig();
  const provider     = config.llmProvider || 'gemini';
  const geminiKeys   = getIQSGeminiKeys(config);
  const anthropicKey = config.iqsAnthropicApiKey || config.anthropicApiKey;

  const userPrompt = buildScoringPrompt(trimTranscript(transcript), tags, chatId);

  let rawResponse: string;

  try {
    if (provider === 'claude' && anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: IQS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });
      rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
    } else if (geminiKeys.length > 0) {
      rawResponse = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [
          { role: 'user', parts: [{ text: IQS_SYSTEM_PROMPT + '\n\n' + userPrompt }] },
        ],
        {},
        60000
      );
    } else {
      return NextResponse.json({ error: 'No API key configured' }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: `LLM error: ${err.message}` }, { status: 500 });
  }

  try {
    const parsed = parseScoringResponse(rawResponse, chatId || `chat_${Date.now()}`);

    const now = new Date().toISOString();
    const entry: IQSScoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scoredAt: now,
      updatedAt: now,
      provider,
      model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash',
      scoredBy: session.user?.email || session.user?.name || 'unknown',
      // Use passed agentName if available; fall back to what the LLM extracted from the transcript
      agentName: agentName || (parsed as any).extractedAgentName || '',
      date,
      tags,
      csat,
      slackUrl,
      // transcript omitted from stored entry — kept small for Redis list
      ...parsed,
    };

    await storeAppendIQSScore(entry);
    if (transcript && chatId) {
      await storeSetTranscript(chatId, { rawTranscript: transcript });
    }

    // Slack alert for critical parameter failures
    const failedParams = CRITICAL_PARAMS
      .filter(p => entry.scores?.[p.key] === 'No')
      .map(p => ({ label: p.label, reasoning: (entry.reasoning as any)?.[p.key] || 'No reasoning provided' }));
    fireQualityAlert(chatId, entry.agentName || agentName, contactPhone, failedParams);

    return NextResponse.json({ ok: true, entry });
  } catch (err: any) {
    return NextResponse.json({ error: `Parse error: ${err.message}`, raw: rawResponse }, { status: 500 });
  }
}
