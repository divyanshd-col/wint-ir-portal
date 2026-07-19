import { NextResponse } from 'next/server';
import { query } from '@/lib/cx/db';

export async function GET() {
  const res = await query('SELECT parameters FROM iqs_scores WHERE parameters IS NOT NULL LIMIT 1');
  return NextResponse.json(res[0]);
}
