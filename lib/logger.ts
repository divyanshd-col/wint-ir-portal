import { storeAppendLog, storeGetLogs } from './store';

export interface LogEntry {
  timestamp: string;
  username: string;
  query: string;
  model: string;
  category?: string;
  queryType?: string;
}

export async function logChatMessage(username: string, query: string, model: string, category?: string, queryType?: string): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    username,
    query,
    model,
    ...(category ? { category } : {}),
    ...(queryType ? { queryType } : {}),
  };
  console.log('[IR_LOG]', JSON.stringify(entry));
  // KV (Vercel) + file (local) in parallel
  await Promise.allSettled([
    storeAppendLog(entry),
    appendToFile(entry),
  ]);
}

async function appendToFile(entry: LogEntry): Promise<void> {
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.cwd(), 'ir-logs.jsonl');
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch {}
}

export async function readLogs(): Promise<LogEntry[]> {
  // KV first
  const kvItems = await storeGetLogs();
  if (kvItems.length > 0) {
    return kvItems.map(item => (typeof item === 'string' ? JSON.parse(item) : item));
  }
  // Fall back to file
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(process.cwd(), 'ir-logs.jsonl');
    if (!fs.existsSync(logPath)) return [];
    return fs
      .readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line: string) => JSON.parse(line))
      .reverse()
      .slice(0, 500);
  } catch {
    return [];
  }
}
