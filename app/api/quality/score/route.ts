import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import { getSystemPrompt, buildScoringPrompt, parseScoringResponse, trimTranscript, IQSScoreEntry } from '@/lib/quality';
import { storeSetTranscript, storeAppendCallSkipped } from '@/lib/store';
import { hasCallInteraction, fireQualityAlert } from '@/lib/quality-alert';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl']);
  if (response) return response;

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
    conversationType = '',
  } = body;

  if (!transcript?.trim()) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
  }

  const config       = await readConfig();
  const provider     = config.llmProvider || 'gemini';
  const geminiKeys   = getIQSGeminiKeys(config);
  const anthropicKey = config.iqsAnthropicApiKey || config.anthropicApiKey;

  const userPrompt = buildScoringPrompt(trimTranscript(transcript), tags, chatId, '', '', '', conversationType || undefined);
  const iqsSystemPrompt = getSystemPrompt(conversationType || undefined, config.iqsScoringPrompt);

  let rawResponse: string;
  try {
    if (provider === 'claude' && anthropicKey) {
      const client = new Anthropic({ apiKey: anthropicKey });
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: iqsSystemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });
      rawResponse = resp.content[0].type === 'text' ? resp.content[0].text : '';
    } else if (geminiKeys.length > 0) {
      rawResponse = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: iqsSystemPrompt + '\n\n' + userPrompt }] }],
        {},
        60000,
      );
    } else {
      return NextResponse.json({ error: 'No API key configured' }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: `LLM error: ${err.message}` }, { status: 500 });
  }

  try {
    const parsed = parseScoringResponse(rawResponse, chatId || `chat_${Date.now()}`, conversationType || undefined);

    const now = new Date().toISOString();
    const entry: IQSScoreEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scoredAt: now,
      updatedAt: now,
      provider,
      model: provider === 'claude' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash',
      scoredBy: session.user?.email || session.user?.name || 'unknown',
      agentName: agentName || (parsed as any).extractedAgentName || '',
      date,
      tags,
      csat,
      slackUrl,
      ...parsed,
    };

    // Ensure agent and conversation exist in Postgres
    let agentId: number | null = null;
    if (entry.agentName) {
      const { upsertAgent } = await import('@/lib/robylon/db');
      agentId = await upsertAgent(entry.agentName);
    }
    const { upsertConversation, insertIQSScore } = await import('@/lib/robylon/db');
    await upsertConversation({
      id: entry.chatId,
      agentId,
      conversationType: entry.conversationType || 'agent',
      tags: entry.tags,
    });

    // Map entry.scores & entry.reasoning from PascalCase to DB format
    const { PASCAL_TO_DB } = await import('@/lib/param-keys');
    const parameters: Record<string, any> = {};
    for (const [k, val] of Object.entries(entry.scores || {})) {
      const dbKey = PASCAL_TO_DB[k] || k.toLowerCase();
      parameters[dbKey] = {
        score: val === 'Yes' ? true : val === 'No' ? false : val === 'Half' ? 0.5 : null,
        reasoning: (entry.reasoning || {})[k] || '',
      };
    }

    // Insert score into Postgres
    await insertIQSScore({
      chatId: entry.chatId,
      iqsScore: entry.iqs,
      parameters,
      modelVersion: entry.model,
      uncertainParameters: entry.uncertainParameters,
    });

    // If manual CSAT is set, update conversation CSAT too
    if (entry.csat) {
      const csatNum = parseInt(entry.csat, 10);
      if ([1, 3, 5].includes(csatNum)) {
        const { updateConversationCsat } = await import('@/lib/robylon/db');
        const csatLabel = csatNum === 5 ? 'good' : csatNum === 3 ? 'could_be_better' : 'bad';
        await updateConversationCsat(entry.chatId, csatNum, csatLabel);
      }
    }

    if (transcript && chatId) {
      await storeSetTranscript(chatId, { rawTranscript: transcript });
    }

    // Slack + Sheet alert — deduplicated via KV (one alert per chat per 24 h)
    fireQualityAlert({
      chatId,
      agentName:           entry.agentName || agentName,
      contactPhone:        contactPhone || undefined,
      scores:              entry.scores    as Record<string, string>,
      reasoning:           entry.reasoning as Record<string, string>,
      iqs:                 entry.iqs,
      csat:                csat || undefined,
      disposition:         typeof tags === 'object' ? (tags as any)?.disposition  : (tags || undefined),
      subDisposition:      typeof tags === 'object' ? (tags as any)?.sub_disposition : undefined,
      uncertainParameters: entry.uncertainParameters,
    }).catch(() => {});

    return NextResponse.json({ ok: true, entry });
  } catch (err: any) {
    return NextResponse.json({ error: `Parse error: ${err.message}`, raw: rawResponse }, { status: 500 });
  }
}
