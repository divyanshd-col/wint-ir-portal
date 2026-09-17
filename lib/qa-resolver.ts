import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';

export interface QAResolverDeps {
  query?: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  readConfig?: () => Promise<any>;
  callId?: string | null;
}

export async function resolveQANameForChat(
  chatId: string,
  deps?: QAResolverDeps,
  callId?: string | null,
): Promise<string> {
  const effectiveCallId = callId || deps?.callId;
  if (!chatId && !effectiveCallId) return 'Manorathi';
  const queryFn = deps?.query || query;
  const readConfigFn = deps?.readConfig || readConfig;

  try {
    let row: { reviewed_by: string | null; agent_id: number | null; disposition: string | null } | undefined;

    // 0. If effectiveCallId is provided, resolve directly from call_recordings / call_evaluations first
    if (effectiveCallId) {
      const callRows = await queryFn<{ reviewed_by: string | null; agent_id: number | null; disposition: string | null }>(`
        SELECT ce.reviewed_by, COALESCE(ce.agent_id, cr.agent_id) AS agent_id, cr.call_disposition AS disposition
        FROM call_recordings cr
        LEFT JOIN call_evaluations ce ON ce.call_id = cr.id
        WHERE cr.id = $1
      `, [effectiveCallId]);
      row = callRows[0];
    }

    if (!row && chatId) {
      const revRows = await queryFn<{ reviewed_by: string | null; agent_id: number | null; disposition: string | null }>(`
        SELECT 
          COALESCE(
            i.reviewed_by,
            (SELECT reviewed_by FROM call_evaluations ce WHERE ce.chat_id = c.id AND reviewed_by IS NOT NULL AND reviewed_by != '' LIMIT 1)
          ) AS reviewed_by,
          c.agent_id,
          c.tags->>'disposition' AS disposition
        FROM conversations c
        LEFT JOIN iqs_scores i ON i.chat_id = c.id
        WHERE c.id = $1
      `, [chatId]);
      row = revRows[0];
    }

    if (!row && chatId) {
      const callRows = await queryFn<{ reviewed_by: string | null; agent_id: number | null; disposition: string | null }>(`
        SELECT ce.reviewed_by, COALESCE(ce.agent_id, cr.agent_id) AS agent_id, cr.call_disposition AS disposition
        FROM call_recordings cr
        LEFT JOIN call_evaluations ce ON ce.call_id = cr.id
        WHERE cr.id = $1 OR cr.chat_id = $1
      `, [chatId]);
      row = callRows[0];
    }

    if (row) {
      const config = await readConfigFn();

      // 1. Priority 1: Forward to the QA who reviewed it (if not an admin)
      if (row.reviewed_by && row.reviewed_by.trim()) {
        const rev = row.reviewed_by.trim();
        const u = config.users?.find((user: any) =>
          (user.email || user.username)?.toLowerCase() === rev.toLowerCase() ||
          user.agentName?.toLowerCase() === rev.toLowerCase()
        );
        if (u?.agentName && u.role !== 'admin') return u.agentName;

        if (rev.includes('@')) {
          const configUser = config.users?.find((user: any) => user.email?.toLowerCase() === rev.toLowerCase());
          if (!configUser || configUser.role !== 'admin') {
            const userRows = await queryFn<{ name: string }>(`SELECT name FROM cx_users WHERE LOWER(email) = LOWER($1)`, [rev]);
            if (userRows[0]?.name) return userRows[0].name;
            const parts = rev.split('@')[0].split('.');
            return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
          }
        } else if (!u || u.role !== 'admin') {
          return rev;
        }
      }

      // 2. Priority 2: Forward based on disposition if not reviewed by a QA
      if (row.disposition && row.disposition.trim()) {
        const cleanDisp = row.disposition.trim().toLowerCase();
        const mapEntry = config.qaDispositionMap?.find((m: any) =>
          m.dispositions?.some((d: string) => {
            const cd = d.trim().toLowerCase();
            return cd === cleanDisp ||
                   (cleanDisp === 'junk' && cd === 'junk chats') ||
                   (cleanDisp === 'junk chats' && cd === 'junk');
          })
        );
        if (mapEntry?.email) {
          const u = config.users?.find((user: any) => (user.email || user.username)?.toLowerCase() === mapEntry.email.toLowerCase());
          if (u?.agentName && u.role !== 'admin') return u.agentName;
          const userRows = await queryFn<{ name: string }>(`SELECT name FROM cx_users WHERE LOWER(email) = LOWER($1)`, [mapEntry.email]);
          if (userRows[0]?.name) return userRows[0].name;
          const parts = mapEntry.email.split('@')[0].split('.');
          return parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        }
      }

      // 3. Priority 3: Fall back to agent's assigned QA
      if (row.agent_id) {
        const agentRows = await queryFn<{ qa_name: string | null }>(`SELECT qa_name FROM agents WHERE id = $1`, [row.agent_id]);
        if (agentRows[0]?.qa_name && agentRows[0].qa_name.trim()) return agentRows[0].qa_name.trim();
      }
    }
  } catch (err) {
    console.error('Failed to resolve QA name for chat:', err);
  }
  return 'Manorathi';
}

