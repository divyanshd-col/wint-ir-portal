/**
 * Returns team-wide aggregate metrics (no individual agent breakdown, no entries).
 * Safe for agent role — agents can see team averages for comparison without seeing
 * other agents' individual chat data.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getAllScoredConversations } from '@/lib/robylon/db';

const SLA_SECS = 180;

function avg(nums: number[]) {
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session || !['admin', 'quality', 'tl', 'agent'].includes(role || '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Optional date range filters
  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo   = searchParams.get('dateTo') || '';

  const rawRows = await getAllScoredConversations(2000);

  // Apply date filters and map to typed fields
  let entries = rawRows.map(row => ({
    scoredAt:       row.scoredAt as string | undefined,
    iqs:            row.iqs as number,
    frt:            row.frt as number | undefined,
    resolutionTime: row.resolutionTime as number | undefined,
    botToTeamSecs:  row.botToTeamSecs as number | undefined,
    csatScore:      row.csat_score as number | null,
  }));

  if (dateFrom) entries = entries.filter(e => (e.scoredAt || '').slice(0, 10) >= dateFrom);
  if (dateTo)   entries = entries.filter(e => (e.scoredAt || '').slice(0, 10) <= dateTo);

  const resValues  = entries.map(e => e.resolutionTime).filter((v): v is number => typeof v === 'number');
  const frtValues  = entries.map(e => e.frt).filter((v): v is number => typeof v === 'number');
  const iqsVals    = entries.map(e => e.iqs).filter((v): v is number => typeof v === 'number');
  const csatScores: number[] = entries.reduce<number[]>((acc, e) => {
    if (e.csatScore === 5) acc.push(100);
    else if (e.csatScore === 3) acc.push(50);
    else if (e.csatScore === 1) acc.push(0);
    return acc;
  }, []);

  const b2tValues = entries.map(e => e.botToTeamSecs).filter((v): v is number => typeof v === 'number');
  const slaOk = b2tValues.filter(v => v <= SLA_SECS).length;

  return NextResponse.json({
    totalEntries: entries.length,
    avgIqs:        avg(iqsVals),
    avgFrt:        avg(frtValues),
    avgResolution: avg(resValues),
    avgClosure:    null, // closureTime not stored separately in pg schema
    avgCsat:       avg(csatScores),
    slaPercent:    b2tValues.length > 0 ? Math.round((slaOk / b2tValues.length) * 100) : null,
  });
}
