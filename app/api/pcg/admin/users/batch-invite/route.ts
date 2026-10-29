import { NextRequest, NextResponse } from 'next/server';
import { requirePcgAdmin } from '@/lib/pcg/auth';
import { query } from '@/lib/cx/db';
import { createSignupToken, audit } from '@/lib/users';
import { sendInviteEmail, mailerConfigured } from '@/lib/mailer';

export const maxDuration = 120; // 2 minutes for batch email delivery

export async function POST(req: NextRequest) {
  const { session, response } = await requirePcgAdmin();
  if (response) return response;

  if (!mailerConfigured()) {
    return NextResponse.json(
      { error: 'Email delivery is not configured on this environment (missing EMAIL_USER / EMAIL_APP_PASSWORD).' },
      { status: 503 }
    );
  }

  const actor = session.user?.email || 'pcg-admin';

  try {
    const rows = await query<{ user_id: number; email: string; name: string }>(`
      SELECT user_id, email, name
      FROM users
      WHERE (platform_domain = 'pcg' OR platform_domain = 'both')
        AND password_hash IS NULL
        AND status != 'disabled'
      ORDER BY name ASC
    `);

    if (!rows.length) {
      return NextResponse.json({
        success: true,
        message: 'All active PCG users already have passwords set.',
        total: 0,
        sent: 0,
        failed: 0,
      });
    }

    let sent = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];

    for (const u of rows) {
      try {
        const { token, expiresAt } = await createSignupToken(u.user_id, u.email);
        const emailed = await sendInviteEmail({
          to: u.email,
          name: u.name,
          token,
          expiresAt,
        });

        if (emailed) {
          sent++;
          await audit('resend_invite', { actorEmail: actor, targetEmail: u.email }).catch(() => {});
        } else {
          failed++;
          errors.push({ email: u.email, error: 'Email sender returned false' });
        }
      } catch (err: any) {
        failed++;
        errors.push({ email: u.email, error: err.message || 'Send failed' });
      }

      // 200ms delay between sends to prevent SMTP throttling
      await new Promise((r) => setTimeout(r, 200));
    }

    return NextResponse.json({
      success: true,
      total: rows.length,
      sent,
      failed,
      errors: errors.length ? errors : undefined,
    });
  } catch (err: any) {
    console.error('[pcg/admin/users/batch-invite] failed:', err?.message);
    return NextResponse.json(
      { error: 'Failed to process batch invites: ' + (err?.message || 'Unknown error') },
      { status: 500 }
    );
  }
}
