import { NextRequest, NextResponse } from 'next/server';
import { readConfig, writeConfig } from '@/lib/config';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { resetKBCache } from '@/lib/drive';

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) return null;
  return session;
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { url } = await req.json();
  if (!url?.trim()) return NextResponse.json({ error: 'URL required' }, { status: 400 });

  const config = await readConfig();
  if (config.knowledgeBaseUrls.includes(url.trim())) {
    return NextResponse.json({ error: 'URL already exists' }, { status: 400 });
  }

  const updated = { ...config, knowledgeBaseUrls: [...config.knowledgeBaseUrls, url.trim()] };
  await writeConfig(updated);
  await resetKBCache();

  return NextResponse.json({ success: true, knowledgeBaseUrls: updated.knowledgeBaseUrls });
}

export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { url } = await req.json();
  const config = await readConfig();
  const updated = { ...config, knowledgeBaseUrls: config.knowledgeBaseUrls.filter(u => u !== url) };
  await writeConfig(updated);
  await resetKBCache();

  return NextResponse.json({ success: true, knowledgeBaseUrls: updated.knowledgeBaseUrls });
}
