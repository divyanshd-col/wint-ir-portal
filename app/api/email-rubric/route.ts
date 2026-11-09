import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { resolveEmailParameters } from '@/lib/email/context-builder';

/** GET /api/email-rubric: the email QA parameters as the admin has set them (defaults + edits), for the QA / TL / IR email pages. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const config = await readConfig().catch(() => null);
  return NextResponse.json({ parameters: resolveEmailParameters(config?.emailRubric) }, { headers: { 'Cache-Control': 'no-store' } });
}
