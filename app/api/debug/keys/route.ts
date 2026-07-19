import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { NextResponse } from 'next/server';
import { readConfig } from '@/lib/config';
import { getOrderedGeminiKeys } from '@/lib/gemini';
import { GoogleGenAI } from '@google/genai';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = await readConfig();
  const keys = getOrderedGeminiKeys(config);

  const results = await Promise.all(
    keys.map(async (key, i) => {
      const masked = key.slice(0, 8) + '...' + key.slice(-4);
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: [{ role: 'user', parts: [{ text: 'say ok' }] }],
        });
        return { index: i + 1, key: masked, status: 'ok' };
      } catch (err: any) {
        return { index: i + 1, key: masked, status: 'error', code: err?.status ?? err?.code, message: err?.message?.slice(0, 100) };
      }
    }),
  );

  return NextResponse.json({
    configSource: config.isConfigured ? 'configured' : 'default',
    keyCount: keys.length,
    activeGeminiKey: (config as any).activeGeminiKey ?? 1,
    keys: results,
  });
}
