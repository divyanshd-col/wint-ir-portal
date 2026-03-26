import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readLogs } from '@/lib/logger';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
