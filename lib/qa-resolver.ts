import { query } from '@/lib/cx/db';
import { readConfig } from '@/lib/config';

export interface QAResolverDeps {
  query?: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  readConfig?: () => Promise<any>;
}

export async function resolveQANameForChat(chatId: string, deps?: QAResolverDeps): Promise<string> {
  if (!chatId) return 'QA';
  const queryFn = deps?.query || query;
  const readConfigFn = deps?.readConfig || readConfig;

  try {
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

    const row = revRows[0];
    if (row) {
      if (row.reviewed_by && row.reviewed_by.trim()) {
        const rev = row.reviewed_by.trim();
        const config = await readConfigFn();
        const u = config.users?.find((user: any) => (user.email || user.username)?.toLowerCase() === rev.toLowerCase() || user.agentName?.toLowerCase() === rev.toLowerCase());
        if (u?.agentName) return u.agentName;
        if (rev.includes('@')) {
          const userRows = await queryFn<{ name: string }>(`SELECT name FROM cx_users WHERE LOWER(email) = LOWER($1)`, [rev]);
          if (userRows[0]?.name) return userRows[0].name;
          const parts = rev.split('@')[0].split('.');
          return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        }
        return rev;
      }

      if (row.agent_id) {
        const agentRows = await queryFn<{ qa_name: string | null }>(`SELECT qa_name FROM agents WHERE id = $1`, [row.agent_id]);
        if (agentRows[0]?.qa_name) return agentRows[0].qa_name;
      }

      if (row.disposition) {
        const config = await readConfigFn();
        const mapEntry = config.qaDispositionMap?.find((m: any) => m.dispositions?.includes(row.disposition!));
        if (mapEntry?.email) {
          const u = config.users?.find((user: any) => (user.email || user.username)?.toLowerCase() === mapEntry.email.toLowerCase());
          if (u?.agentName) return u.agentName;
        }
      }
    }
  } catch (err) {
    console.error('Failed to resolve QA name for chat:', err);
  }
  return 'QA';
}

