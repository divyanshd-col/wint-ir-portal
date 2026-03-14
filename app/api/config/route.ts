import { NextRequest, NextResponse } from 'next/server';
import { readConfig, writeConfig, PortalConfig } from '@/lib/config';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import bcrypt from 'bcryptjs';

async function getAdminSession() {
  const session = await getServerSession(authOptions);
  return session?.user?.isAdmin ? session : null;
}

export async function GET() {
  const config = await readConfig();
  if (config.isConfigured) {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    geminiApiKey: config.geminiApiKey ? '••••' + config.geminiApiKey.slice(-4) : '',
    geminiApiKey2: config.geminiApiKey2 ? '••••' + config.geminiApiKey2.slice(-4) : '',
    geminiApiKey3: config.geminiApiKey3 ? '••••' + config.geminiApiKey3.slice(-4) : '',
    geminiApiKey4: config.geminiApiKey4 ? '••••' + config.geminiApiKey4.slice(-4) : '',
    geminiApiKey5: config.geminiApiKey5 ? '••••' + config.geminiApiKey5.slice(-4) : '',
    activeGeminiKey: config.activeGeminiKey || 1,
    anthropicApiKey: config.anthropicApiKey ? '••••' + config.anthropicApiKey.slice(-4) : '',
    llmProvider: config.llmProvider || 'gemini',
    geminiModel: config.geminiModel || 'gemini-2.5-flash',
    knowledgeBaseUrls: config.knowledgeBaseUrls,
    systemPrompt: config.systemPrompt || '',
    users: config.users.map(u => ({ username: u.username, password: '••••••••', isAdmin: u.isAdmin })),
    isConfigured: config.isConfigured,
  });
}

export async function PATCH(req: NextRequest) {
  if (!await getAdminSession()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const config = await readConfig();

  const updated: PortalConfig = {
    ...config,
    ...(body.llmProvider && { llmProvider: body.llmProvider }),
    ...(body.geminiModel && { geminiModel: body.geminiModel }),
    ...(body.activeGeminiKey && { activeGeminiKey: body.activeGeminiKey }),
    ...(body.anthropicApiKey && !body.anthropicApiKey.startsWith('••••') && { anthropicApiKey: body.anthropicApiKey }),
    ...(body.geminiApiKey && !body.geminiApiKey.startsWith('••••') && { geminiApiKey: body.geminiApiKey }),
    ...(body.geminiApiKey2 !== undefined && !body.geminiApiKey2?.startsWith('••••') && { geminiApiKey2: body.geminiApiKey2 }),
    ...(body.geminiApiKey3 !== undefined && !body.geminiApiKey3?.startsWith('••••') && { geminiApiKey3: body.geminiApiKey3 }),
    ...(body.geminiApiKey4 !== undefined && !body.geminiApiKey4?.startsWith('••••') && { geminiApiKey4: body.geminiApiKey4 }),
    ...(body.geminiApiKey5 !== undefined && !body.geminiApiKey5?.startsWith('••••') && { geminiApiKey5: body.geminiApiKey5 }),
    ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
  };

  await writeConfig(updated);
  return NextResponse.json({ success: true, llmProvider: updated.llmProvider });
}

export async function POST(req: NextRequest) {
  const config = await readConfig();

  const body = await req.json();

  const users = await Promise.all(
    (body.users || []).map(async (u: any) => {
      const existing = config.users.find((cu: any) => cu.username === u.username);
      let password: string;
      if (u.password?.startsWith('••••')) {
        password = existing?.password || u.password;
      } else {
        const alreadyHashed = u.password?.startsWith('$2b$') || u.password?.startsWith('$2a$');
        password = alreadyHashed ? u.password : await bcrypt.hash(u.password, 10);
      }
      return { username: u.username, password, isAdmin: existing?.isAdmin ?? u.isAdmin ?? false };
    })
  );

  const newConfig: PortalConfig = {
    geminiApiKey: body.geminiApiKey?.startsWith('••••') ? config.geminiApiKey : (body.geminiApiKey || config.geminiApiKey),
    anthropicApiKey: body.anthropicApiKey?.startsWith('••••') ? config.anthropicApiKey : (body.anthropicApiKey || config.anthropicApiKey || ''),
    llmProvider: config.llmProvider || 'gemini',
    knowledgeBaseUrls: body.knowledgeBaseUrls || [],
    users,
    isConfigured: true,
  };

  await writeConfig(newConfig);
  return NextResponse.json({ success: true });
}
