import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';

// GET: Fetch reports depending on user role
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const email = session.user.email;
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const role = user?.role || (session.user as any)?.role || 'agent';
  let agentName = user?.agentName || '';
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  try {
    const systemWeekRes = await query<any>(`SELECT MAX(week_start)::date::text AS latest_week FROM ir_reports WHERE status = 'published'`);
    const latestSystemWeek = systemWeekRes[0]?.latest_week || null;

    if (role === 'agent') {
      if (!agentName) {
        return NextResponse.json({ error: 'Agent profile name is not mapped in your user account.' }, { status: 400 });
      }

      // Find agent id in DB
      const matched = await query<any>(`SELECT id FROM agents WHERE LOWER(name) = LOWER($1)`, [agentName]);
      if (matched.length === 0) {
        return NextResponse.json({ reports: [], latestSystemWeek });
      }
      const agentId = matched[0].id;

      // Fetch published scorecards for this agent
      const reports = await query<any>(
        `SELECT id, agent_id, week_start::date::text AS week_start, week_end::date::text AS week_end, status, generated, comments, viewed_at, generated_at
         FROM ir_reports
         WHERE agent_id = $1 AND status = 'published'
         ORDER BY week_start DESC`,
        [agentId]
      );
      return NextResponse.json({ reports, latestSystemWeek });
    }

    if (role === 'tl' || role === 'quality') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (role === 'admin') {
      // Admins see all reports
      const reports = await query<any>(
        `SELECT r.id, r.agent_id, a.name AS agent_name, r.week_start::date::text AS week_start, r.week_end::date::text AS week_end, r.status, r.generated, r.comments, r.viewed_at, r.generated_at
         FROM ir_reports r
         JOIN agents a ON a.id = r.agent_id
         WHERE r.status = 'published'
         ORDER BY r.week_start DESC, a.name ASC`
      );
      return NextResponse.json({ reports, latestSystemWeek });
    }

    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } catch (err: any) {
    console.error('[ir-reports-api] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: Add / update comments on a scorecard (Agents only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { reportId, comments } = await req.json();
  if (!reportId || !Array.isArray(comments)) {
    return NextResponse.json({ error: 'Missing reportId or invalid comments array' }, { status: 400 });
  }

  const email = session.user.email;
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const role = user?.role || (session.user as any)?.role || 'agent';
  let agentName = user?.agentName || '';
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  try {
    // Only agents can comment on their own reports (and admin for safety/verification)
    if (role === 'agent') {
      if (!agentName) {
        return NextResponse.json({ error: 'Agent profile name is not mapped in your user account.' }, { status: 403 });
      }

      const matchedAgent = await query<any>(`SELECT id FROM agents WHERE LOWER(name) = LOWER($1)`, [agentName]);
      if (matchedAgent.length === 0) {
        return NextResponse.json({ error: 'Agent profile not found in DB.' }, { status: 403 });
      }
      const agentId = matchedAgent[0].id;

      const reportRows = await query<any>(`SELECT agent_id FROM ir_reports WHERE id = $1`, [reportId]);
      if (reportRows.length === 0) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      if (reportRows[0].agent_id !== agentId) {
        return NextResponse.json({ error: 'Forbidden: Cannot comment on another agent\'s scorecard.' }, { status: 403 });
      }
    } else if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Update the comments JSONB array
    await query(
      `UPDATE ir_reports SET comments = $1 WHERE id = $2`,
      [JSON.stringify(comments), reportId]
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[ir-reports-api] POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH: Mark a scorecard as viewed/read (Agents only when they open it)
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const { reportId } = await req.json();
  if (!reportId) {
    return NextResponse.json({ error: 'Missing reportId' }, { status: 400 });
  }

  const email = session.user.email;
  const config = await readConfig();
  const user = config.users.find(u => (u.email || u.username).toLowerCase() === email.toLowerCase());
  const role = user?.role || (session.user as any)?.role || 'agent';
  let agentName = user?.agentName || '';
  if (email.toLowerCase() === 'pooja.hb@wintwealth.com') {
    agentName = 'Pooja';
  }

  try {
    if (role === 'agent') {
      if (!agentName) {
        return NextResponse.json({ error: 'Agent profile name is not mapped.' }, { status: 403 });
      }

      const matchedAgent = await query<any>(`SELECT id FROM agents WHERE LOWER(name) = LOWER($1)`, [agentName]);
      if (matchedAgent.length === 0) {
        return NextResponse.json({ error: 'Agent profile not found.' }, { status: 403 });
      }
      const agentId = matchedAgent[0].id;

      const reportRows = await query<any>(`SELECT agent_id, viewed_at FROM ir_reports WHERE id = $1`, [reportId]);
      if (reportRows.length === 0) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      if (reportRows[0].agent_id !== agentId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (!reportRows[0].viewed_at) {
        await query(`UPDATE ir_reports SET viewed_at = NOW() WHERE id = $1`, [reportId]);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[ir-reports-api] PATCH error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
