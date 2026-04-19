import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { appendCorrection, getCorrections, CorrectionEntry } from '@/lib/corrections';

// POST — any logged-in agent submits a correction
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { originalQuery, originalAnswer, correctedAnswer, agentNote, sourceChunks, formAnswers, category } = body;

  if (!originalQuery || !originalAnswer || !correctedAnswer?.trim()) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const entry: CorrectionEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    submittedBy: session.user?.name || 'unknown',
    originalQuery,
    originalAnswer,
    correctedAnswer: correctedAnswer.trim(),
    agentNote: agentNote?.trim() || undefined,
    sourceChunks: sourceChunks || [],
    formAnswers: formAnswers || {},
    category: category || undefined,
    status: 'pending',
  };

  await appendCorrection(entry);
  console.log(`[corrections] New correction submitted by ${entry.submittedBy} (id: ${entry.id})`);
  return NextResponse.json({ ok: true, id: entry.id });
}

// GET — admin lists corrections (optionally filtered by ?status=pending)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status');

  let corrections = await getCorrections();
  if (statusFilter && statusFilter !== 'all') {
    corrections = corrections.filter(c => c.status === statusFilter);
  }

  // Newest-first
  corrections.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return NextResponse.json({ corrections });
}
