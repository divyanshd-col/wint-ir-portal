import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { CALL_IQS_SYSTEM_PROMPT, buildCallScoringPrompt, parseCallScoringResponse, segmentsToText } from '@/lib/call-quality';
import { callGeminiForCall, getIQSGeminiKeys } from '@/lib/gemini';
import { fetchKnowledgeChunks, retrieveRelevantChunks } from '@/lib/drive';
import { readConfig } from '@/lib/config';

function qualityAccess(role: string | undefined) {
  return !!role && ['admin', 'quality', 'tl'].includes(role);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!qualityAccess(user?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { callId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { callId } = body;
  if (!callId?.trim()) return NextResponse.json({ error: 'callId is required' }, { status: 400 });

  // Load config
  const config = await readConfig();
  const geminiKeys = getIQSGeminiKeys(config);
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 503 });
  }

  // Fetch call recording
  const callRows = await query<any>(`
    SELECT id, chat_id, language, interruption_count, dead_air_count, call_disposition, transcript
    FROM call_recordings WHERE id = $1
  `, [callId.trim()]);

  if (!callRows.length) return NextResponse.json({ error: 'Call recording not found' }, { status: 404 });
  const callRec = callRows[0];

  // Parse segments
  let segments: any[] = [];
  if (callRec.transcript) {
    try {
      const t = typeof callRec.transcript === 'string' ? JSON.parse(callRec.transcript) : callRec.transcript;
      segments = Array.isArray(t.segments) ? t.segments : Array.isArray(t) ? t : [];
    } catch {}
  }

  if (!segments.length) {
    return NextResponse.json({ error: 'No transcript segments found for this call' }, { status: 422 });
  }

  const callTranscriptText = segmentsToText(segments);

  // Fetch chat transcript if linked
  let chatTranscriptRaw = '';
  let chatDisposition = '';
  if (callRec.chat_id) {
    try {
      const convRows = await query<any>(`SELECT transcript, tags FROM conversations WHERE id = $1`, [callRec.chat_id]);
      if (convRows.length) {
        const conv = convRows[0];
        const messages: any[] = Array.isArray(conv.transcript) ? conv.transcript
          : Array.isArray(conv.transcript?.messages) ? conv.transcript.messages : [];
        const lines: string[] = [];
        for (const m of messages) {
          const role = m.sender_type === 'customer' ? 'Customer' : m.sender_type === 'bot' ? 'Bot' : 'Agent';
          const content = (m.content || '').trim();
          if (content) lines.push(`${role}: ${content}`);
        }
        chatTranscriptRaw = lines.join('\n');
        chatDisposition = [
          (conv.tags as any)?.disposition || '',
          (conv.tags as any)?.sub_disposition || '',
        ].filter(Boolean).join(' > ');
      }
    } catch {}
  }

  const interruptionCount = callRec.interruption_count ?? 0;
  const deadAirCount = callRec.dead_air_count ?? 0;
  const callDisposition = callRec.call_disposition || '';

  // KB chunks for TechnicalLegal grounding
  let kbContext = '';
  const kbQuery = callDisposition || chatDisposition || callTranscriptText.slice(0, 400);
  if (kbQuery) {
    try {
      const allChunks = await fetchKnowledgeChunks();
      const relevant = retrieveRelevantChunks(allChunks, kbQuery, 5);
      if (relevant.length) {
        const docNames = config.knowledgeBaseDocNames || {};
        kbContext = relevant.map(c => {
          const driveId = c.fileName.trim();
          const label = docNames[driveId]
            || (/^[A-Za-z0-9_-]{25,}$/.test(driveId) ? (c.content.split('\n')[0].trim() || 'KB Document') : driveId);
          return `[${label}]\n${c.content}`;
        }).join('\n---\n');
      }
    } catch {}
  }

  // Score
  let raw: string;
  try {
    raw = await callGeminiForCall(
      geminiKeys,
      [{ role: 'user', parts: [{ text: CALL_IQS_SYSTEM_PROMPT + '\n\n' + buildCallScoringPrompt(
        callTranscriptText,
        chatTranscriptRaw,
        callRec.chat_id || callId,
        interruptionCount,
        deadAirCount,
        callDisposition,
        chatDisposition,
        kbContext,
      )}] }],
      undefined, 60_000,
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Gemini error: ${err.message}` }, { status: 502 });
  }

  let result: any;
  try {
    result = parseCallScoringResponse(raw);
  } catch (err: any) {
    return NextResponse.json({ error: `Parse error: ${err.message}` }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    iqs: result.iqs ?? null,
    scores: result.scores ?? {},
    reasoning: result.reasoning ?? {},
    summary: result.summary ?? '',
  });
}
