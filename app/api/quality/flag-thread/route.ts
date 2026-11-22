import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { storeGetFlagThread, storeAppendFlagComment } from '@/lib/store';
import type { IQSFlagComment } from '@/lib/store';
import { randomUUID } from 'crypto';

// GET — load thread for a flag
export async function GET(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const flagId = new URL(req.url).searchParams.get('flagId');
  if (!flagId) return NextResponse.json({ error: 'flagId required' }, { status: 400 });

  const comments = await storeGetFlagThread(flagId);

  // Also check pcg_call_evaluations
  try {
    const { query } = await import('@/lib/cx/db');
    const pcgRes = await query<{ dispute_comments: any }>(
      `SELECT dispute_comments FROM pcg_call_evaluations
       WHERE call_id = $1 OR call_id LIKE '%' || $1 OR id::text = $1
       LIMIT 1`,
      [flagId]
    );
    if (pcgRes.length > 0 && Array.isArray(pcgRes[0].dispute_comments)) {
      const existingIds = new Set(comments.map((c) => c.id));
      for (const pc of pcgRes[0].dispute_comments) {
        if (!existingIds.has(pc.id)) {
          comments.push(pc);
          existingIds.add(pc.id);
        }
      }
    }
  } catch (e) {}

  return NextResponse.json({ comments });
}

// POST — add a comment to a flag thread.
export async function POST(req: NextRequest) {
  const { session, response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const { flagId, content } = await req.json();
  if (!flagId || !content?.trim()) return NextResponse.json({ error: 'flagId and content required' }, { status: 400 });

  const email = (session.user as any)?.email || '';
  const role = (session.user as any)?.role || 'agent';
  const { readConfig } = await import('@/lib/config');
  const config = await readConfig();
  const configUser = config.users.find(u => (u.email || u.username || '').toLowerCase() === email.toLowerCase());
  let authorName: string = (session.user as any)?.name || configUser?.agentName || '';
  if (!authorName && email) {
    const { getUserByEmail } = await import('@/lib/users');
    const dbUser = await getUserByEmail(email).catch(() => null);
    if (dbUser?.name) authorName = dbUser.name;
  }
  if (!authorName) authorName = email.split('@')[0] || (role === 'admin' ? 'Admin' : 'User');

  const comment: IQSFlagComment = {
    id: randomUUID(),
    flagId,
    authorEmail: email,
    authorName,
    role,
    content: content.trim(),
    createdAt: new Date().toISOString(),
  };

  await storeAppendFlagComment(comment);

  // Also sync to pcg_call_evaluations if flagId is a call
  try {
    const { query } = await import('@/lib/cx/db');
    await query(
      `ALTER TABLE pcg_call_evaluations ADD COLUMN IF NOT EXISTS dispute_comments JSONB DEFAULT '[]'::jsonb`
    );
    await query(
      `UPDATE pcg_call_evaluations
       SET dispute_comments = COALESCE(dispute_comments, '[]'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE call_id = $2 OR call_id LIKE '%' || $2 OR id::text = $2`,
      [JSON.stringify([comment]), flagId]
    );
  } catch (err: any) {
    console.warn('Failed to sync dispute comment to pcg_call_evaluations:', err?.message);
  }

  return NextResponse.json({ ok: true, comment });
}
