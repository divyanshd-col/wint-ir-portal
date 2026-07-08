import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/api-guard';
import { readLogs } from '@/lib/log';

export async function GET(request: Request) {
  const { session, response } = await requireRole('admin');
  if (response) return response;

  const logs = await readLogs();

  const { searchParams } = new URL(request.url);
  if (searchParams.get('format') === 'csv') {
    const header = 'timestamp,username,query,model';
    const rows = logs.map(l =>
      [l.timestamp, l.username, `"${(l.query ?? '').replace(/"/g, '""')}"`, l.model].join(',')
    );
    const csv = [header, ...rows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="wint-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ logs });
}
