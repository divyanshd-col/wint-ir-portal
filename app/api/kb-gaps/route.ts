import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { query } from '@/lib/cx/db';

export async function GET(req: NextRequest) {
  const { response } = await requireRole(['admin', 'quality', 'tl', 'agent']);
  if (response) return response;

  const url = new URL(req.url);
  const tag = url.searchParams.get('tag') || 'all';
  const category = url.searchParams.get('category') || 'all';
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);

  const conditions: string[] = ['1=1'];
  const params: any[] = [];

  if (tag !== 'all') {
    params.push(tag);
    conditions.push(`tag = $${params.length}`);
  }

  if (category !== 'all') {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  params.push(limit);
  const limitParamIndex = params.length;

  try {
    const rows = await query<any>(
      `SELECT 
        week_number,
        category,
        question,
        chat_ids,
        agent_answer,
        suggested_kb_content,
        target_kb,
        tag,
        created_at::text AS created_at
       FROM kb_draft_suggestions
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${limitParamIndex}`,
      params
    );

    // Parse chat_ids JSON if string
    const formattedRows = rows.map((r: any) => ({
      ...r,
      chat_ids: typeof r.chat_ids === 'string' ? JSON.parse(r.chat_ids) : r.chat_ids || [],
    }));

    return NextResponse.json({ ok: true, rows: formattedRows });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
