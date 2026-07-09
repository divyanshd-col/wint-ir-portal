/**
 * POST /api/seed — seeds Upstash KV with the bundled portal-config.json.
 * Protected by SEED_SECRET env var. Call once after first deploy.
 */
import { NextRequest, NextResponse } from 'next/server';
import { storeSetConfig } from '@/lib/store';

export async function POST(req: NextRequest) {
  const secret = process.env.SEED_SECRET;
  if (!secret) return NextResponse.json({ error: 'SEED_SECRET not set' }, { status: 500 });

  const { secret: provided } = await req.json().catch(() => ({}));
  if (provided !== secret) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(process.cwd(), 'portal-config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    await storeSetConfig(config);
    return NextResponse.json({ success: true, message: 'Config seeded to Upstash' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
