/**
 * POST /api/admin/backfill-call-dispositions
 *
 * Classifies disposition + chunks transcripts for existing call_recordings rows
 * that have a transcript but no call_disposition yet (historical calls).
 *
 * Body: { limit?: number, call_id?: string }
 *   - call_id: process a single specific call (for testing)
 *   - limit:   max calls to process in one run (default 10, max 50)
 *
 * Auth: admin only
 * Safe to re-run — skips calls that already have call_disposition set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { geminiGenerate, getIQSGeminiKeys } from '@/lib/gemini';
import {
  CALL_DISPOSITION_CLASSIFY_PROMPT,
  CALL_CHUNK_PROMPT,
  parseCallDispositionClassified,
  parseCallChunks,
  segmentsToText,
  type CallSegment,
} from '@/lib/call-quality';
import {
  updateCallDisposition,
  insertCallTranscriptChunks,
} from '@/lib/robylon/db';
import { query } from '@/lib/cx/db';

interface CallRow {
  id: string;
  contact_id: number | null;
  agent_id: number | null;
  called_at: string | null;
  transcript: any;
  language: string | null;
}

async function getPendingCalls(callId?: string, limit = 10): Promise<CallRow[]> {
  if (callId) {
    return query<CallRow>(
      `SELECT id, contact_id, agent_id, called_at, transcript, language
       FROM call_recordings
       WHERE id = $1 AND transcript IS NOT NULL`,
      [callId],
    );
  }
  return query<CallRow>(
    `SELECT id, contact_id, agent_id, called_at, transcript, language
     FROM call_recordings
     WHERE transcript IS NOT NULL
       AND call_disposition IS NULL
     ORDER BY called_at DESC NULLS LAST
     LIMIT $1`,
    [Math.min(limit, 50)],
  );
}

function parseSegments(transcript: any): CallSegment[] {
  if (!transcript) return [];
  const t = typeof transcript === 'string' ? JSON.parse(transcript) : transcript;
  return Array.isArray(t.segments) ? t.segments : Array.isArray(t) ? t : [];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  let body: { limit?: number; call_id?: string } = {};
  try { body = await req.json(); } catch {}

  const limit  = Math.min(Number(body.limit ?? 10), 50);
  const callId = body.call_id?.trim() || undefined;

  let geminiKeys: string[];
  try {
    const config = await readConfig();
    geminiKeys   = getIQSGeminiKeys(config);
  } catch (err: any) {
    return NextResponse.json({ error: `Config error: ${err.message}` }, { status: 500 });
  }
  if (!geminiKeys.length) {
    return NextResponse.json({ error: 'No Gemini API key configured' }, { status: 503 });
  }

  const calls = await getPendingCalls(callId, limit);
  if (!calls.length) {
    return NextResponse.json({ ok: true, message: 'No calls pending backfill', processed: 0 });
  }

  const results: Array<{ callId: string; disposition?: string; subDisposition?: string; chunks: number; error?: string }> = [];

  for (const call of calls) {
    const segments = parseSegments(call.transcript);
    const transcriptText = segmentsToText(segments);

    if (!transcriptText.trim()) {
      results.push({ callId: call.id, chunks: 0, error: 'Empty transcript' });
      continue;
    }

    let disposition = '';
    let subDisposition = '';
    let chunkCount = 0;

    // Step 1: Classify disposition
    try {
      const rawDisp = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: CALL_DISPOSITION_CLASSIFY_PROMPT + '\n\n## CALL TRANSCRIPT\n' + transcriptText }] }],
        { responseMimeType: 'application/json' },
        30_000,
      );
      const classified = parseCallDispositionClassified(rawDisp);
      disposition    = classified.disposition;
      subDisposition = classified.subDisposition;

      if (disposition) {
        await updateCallDisposition(call.id, disposition, subDisposition);
      }
    } catch (err: any) {
      results.push({ callId: call.id, chunks: 0, error: `Classification failed: ${err.message}` });
      continue;
    }

    // Step 2: Chunk transcript
    try {
      const rawChunks = await geminiGenerate(
        geminiKeys,
        'gemini-2.5-flash',
        [{ role: 'user', parts: [{ text: CALL_CHUNK_PROMPT + '\n\n## CALL TRANSCRIPT\n' + transcriptText }] }],
        { responseMimeType: 'application/json' },
        30_000,
      );
      const chunks = parseCallChunks(rawChunks);
      if (chunks.length > 0) {
        await insertCallTranscriptChunks(chunks.map((c, i) => ({
          callId: call.id,
          chatId: null,
          contactId: call.contact_id ?? null,
          agentId: call.agent_id ?? null,
          calledAt: call.called_at ?? null,
          topic: c.topic,
          summary: c.summary,
          content: c.content,
          chunkIndex: i,
        })));
        chunkCount = chunks.length;
      }
    } catch (err: any) {
      // Chunking failure doesn't block — disposition was already stored
      results.push({ callId: call.id, disposition, subDisposition, chunks: 0, error: `Chunking failed: ${err.message}` });
      continue;
    }

    results.push({ callId: call.id, disposition, subDisposition, chunks: chunkCount });
  }

  const succeeded = results.filter(r => !r.error).length;
  const failed    = results.filter(r => r.error).length;

  return NextResponse.json({
    ok: true,
    processed: calls.length,
    succeeded,
    failed,
    results,
  });
}

// GET: preview how many calls are pending backfill
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const user = session.user as any;
  if (!user?.isAdmin && user?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  }

  const rows = await query<{ count: string; oldest: string | null; newest: string | null }>(`
    SELECT COUNT(*)::text AS count,
           MIN(called_at)::text AS oldest,
           MAX(called_at)::text AS newest
    FROM call_recordings
    WHERE transcript IS NOT NULL
      AND call_disposition IS NULL
  `, []);

  return NextResponse.json({
    ok: true,
    pendingCount: parseInt(rows[0]?.count ?? '0', 10),
    oldest: rows[0]?.oldest ?? null,
    newest: rows[0]?.newest ?? null,
  });
}
