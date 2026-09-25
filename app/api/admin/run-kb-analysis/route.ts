import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { runKBAgendaAnalysis } from '@/lib/kb-analyzer/agent';
import { log } from '@/lib/log';

export async function POST(req: NextRequest) {
  const { response, session } = await requireRole(['admin']);
  if (response) return response;
  const user = session!.user as any;

  try {
    const body = await req.json().catch(() => ({}));
    const daysBack = body.daysBack || 14;
    const limitChats = body.limitChats || 50;

    log.info('admin-api', 'Triggered background KB Gap Analysis', { user: user.email, daysBack, limitChats });

    // Run non-blocking background analysis
    runKBAgendaAnalysis({ daysBack, limitChats }).catch((err) => {
      log.error('admin-api', 'Background KB Gap Analysis failed', { err: err?.message ?? String(err) });
    });

    return NextResponse.json({
      success: true,
      message: 'KB Gap Analysis started in background. Rows will appear in real-time as chats are analyzed.',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
