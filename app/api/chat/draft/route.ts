import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { readConfig } from '@/lib/config';
import { getOrderedGeminiKeys, geminiGenerate } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { briefing, formAnswers } = await req.json();
  if (!briefing) return NextResponse.json({ error: 'Missing briefing' }, { status: 400 });

  const config = await readConfig();
  const geminiKeys = getOrderedGeminiKeys(config);
  if (geminiKeys.length === 0) {
    return NextResponse.json({ error: 'Gemini API key not configured.' }, { status: 500 });
  }

  const formAnswerLines = formAnswers && Object.keys(formAnswers).length > 0
    ? Object.entries(formAnswers as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join('\n')
    : 'None';

  const draftPrompt = `Write a warm, clear message that a support agent can send directly to a customer.

CONTEXT — internal briefing the agent received:
${briefing}

CONFIRMED CASE FACTS:
${formAnswerLines}

STRICT RULES:
1. NEVER include: Slack channel names, internal tool names (Finder, Cashfree portal, Razorpay portal, Mixpanel), escalation POC names, internal team names (#cx-live, #cx-api, #cx-ops, #sip-discrepancies, #bond-kyc-discrepancies, #asset-repayment-issues, etc.), or any internal operational details.
2. For customer contact via email, use only: hello@wintwealth.com
3. Never quote internal SLAs verbatim — give rounded customer-friendly estimates (e.g. "within 2 working days" is fine; "T+5 working days from failed payment, blocked until 12:30 PM" is NOT).
4. Structure: (a) acknowledge what the customer is experiencing — 1 sentence, empathetic but not cliché. (b) explain what is happening in plain language — 1–2 sentences. (c) clear next step or timeline for the customer — 1 sentence.
5. Tone: calm, clear, professional. No jargon the customer wouldn't understand.
6. Length: 3–5 sentences total. No bullet points. No subject line. No greeting or salutation — start directly with the acknowledgment.
7. Do NOT start with "I understand your frustration" or similar overused openers.
8. Write as if you are the support agent speaking to the customer in a chat message.

Return ONLY valid JSON with no markdown fencing:
{"draft":"<customer message text>"}`;

  try {
    const raw = await geminiGenerate(
      geminiKeys,
      'gemini-2.5-flash',
      [{ role: 'user', parts: [{ text: draftPrompt }] }],
      undefined,
      20000
    );
    const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.draft) throw new Error('No draft in response');
    return NextResponse.json({ draft: parsed.draft });
  } catch (e) {
    console.error('[draft] Failed:', e);
    return NextResponse.json({ error: 'Failed to generate draft' }, { status: 500 });
  }
}
