import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { getCorrections, updateCorrection } from '@/lib/corrections';
import { updateDocSection, getServiceAccountEmail } from '@/lib/gdocs';
import { readConfig, writeConfig } from '@/lib/config';
import { geminiGenerate, getOrderedGeminiKeys } from '@/lib/gemini';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!(session?.user as any)?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, action, editedCorrection, applyPromptChange } = await req.json();
  if (!id || !action) return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });

  const corrections = await getCorrections();
  const correction = corrections.find(c => c.id === id);
  if (!correction) return NextResponse.json({ error: 'Correction not found' }, { status: 404 });

  const resolvedBy = session!.user?.name || 'admin';
  const resolvedAt = new Date().toISOString();

  if (action === 'reject') {
    await updateCorrection(id, { status: 'rejected', resolvedAt, resolvedBy });
    return NextResponse.json({ ok: true, action: 'rejected' });
  }

  if (action !== 'approve') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const finalCorrection = editedCorrection?.trim() || correction.correctedAnswer;
  const results: Record<string, any> = { docUpdates: [] };

  // 1. Update each source Google Doc section
  for (const chunk of correction.sourceChunks) {
    if (!chunk.fileId) continue;
    const result = await updateDocSection(chunk.fileId, chunk.breadcrumb, chunk.excerpt, finalCorrection);
    results.docUpdates.push({ fileName: chunk.fileName, ...result });
    if (!result.success) {
      console.warn(`[corrections/apply] Doc update failed for ${chunk.fileName}: ${result.error}`);
    }
  }

  // 2. Generate a prompt suggestion if not already present
  let promptSuggestion = correction.promptSuggestion;
  if (!promptSuggestion) {
    try {
      const config = await readConfig();
      const currentPrompt = config.systemPrompt || '';
      const suggestionPrompt = `You are reviewing an error made by an AI-powered CX briefing system.

CURRENT SYSTEM PROMPT (excerpt — first 2000 chars):
${currentPrompt.slice(0, 2000)}

THE SYSTEM GAVE THIS WRONG ANSWER:
${correction.originalAnswer}

THE CORRECT ANSWER SHOULD BE:
${finalCorrection}

QUESTION: Is there a specific one-sentence addition or correction to the system prompt above that would have prevented this error?
- If yes: return ONLY the proposed change as a single sentence starting with "Change:" or "Add:" — no explanation.
- If the error is a KB content issue (not a reasoning/instruction issue), return exactly: NO_PROMPT_CHANGE`;

      const provider = config.llmProvider || 'gemini';
      const geminiKeys = getOrderedGeminiKeys(config);

      if (provider === 'claude' && config.anthropicApiKey) {
        const client = new Anthropic({ apiKey: config.anthropicApiKey });
        const resp = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 256,
          messages: [{ role: 'user', content: suggestionPrompt }],
        });
        promptSuggestion = resp.content[0].type === 'text' ? resp.content[0].text.trim() : undefined;
      } else if (geminiKeys.length) {
        const text = await geminiGenerate(
          geminiKeys,
          'gemini-2.5-flash',
          [{ role: 'user', parts: [{ text: suggestionPrompt }] }],
          undefined,
          15000
        );
        promptSuggestion = text.trim();
      }

      if (promptSuggestion === 'NO_PROMPT_CHANGE') promptSuggestion = undefined;
    } catch (err: any) {
      console.warn('[corrections/apply] Prompt suggestion error:', err?.message);
    }
  }

  // 3. Apply prompt change if admin confirmed
  if (applyPromptChange && promptSuggestion) {
    try {
      const config = await readConfig();
      const updated = (config.systemPrompt || '') + '\n\n' + promptSuggestion;
      await writeConfig({ ...config, systemPrompt: updated.trim() });
      results.promptApplied = true;
    } catch (err: any) {
      console.warn('[corrections/apply] Prompt apply error:', err?.message);
      results.promptApplied = false;
    }
  }

  await updateCorrection(id, {
    status: 'approved',
    correctedAnswer: finalCorrection,
    promptSuggestion,
    promptApproved: applyPromptChange ?? false,
    resolvedAt,
    resolvedBy,
  });

  results.serviceAccountEmail = getServiceAccountEmail();
  return NextResponse.json({ ok: true, action: 'approved', promptSuggestion, ...results });
}
