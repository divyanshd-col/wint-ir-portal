'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSScoreEntry, ParamScore } from '@/lib/quality';

// ── Types ─────────────────────────────────────────────────────────────────────
interface AgentStat {
  agent: string; chats: number; avgIqs: number;
  minIqs: number; maxIqs: number; high: number; atRisk: number;
}
interface ParsedRow {
  chatId: string; agent: string; date: string; csat: string; transcript: string; tags?: string;
}

// ── IQS Helpers ───────────────────────────────────────────────────────────────
function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#16a34a', bg: '#dcfce7', bar: '#22c55e', ring: '#16a34a' };
  if (iqs >= 80) return { text: '#d97706', bg: '#fef3c7', bar: '#f59e0b', ring: '#d97706' };
  if (iqs >= 70) return { text: '#ea580c', bg: '#ffedd5', bar: '#f97316', ring: '#ea580c' };
  return { text: '#dc2626', bg: '#fee2e2', bar: '#ef4444', ring: '#dc2626' };
}

function IQSPill({ iqs }: { iqs: number }) {
  const t = iqsTheme(iqs);
  return (
    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums"
      style={{ background: t.bg, color: t.text }}>{iqs}%</span>
  );
}

function IQSBar({ iqs, height = 6 }: { iqs: number; height?: number }) {
  const t = iqsTheme(iqs);
  return (
    <div className="flex-1 bg-gray-100 rounded-full overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${iqs}%`, background: t.bar }} />
    </div>
  );
}

const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';

function ChatLink({ chatId, className = '' }: { chatId: string; className?: string }) {
  // Only linkify numeric-looking IDs (Robylon chat IDs are integers)
  const isRobylon = /^\d+$/.test(chatId.trim());
  if (!isRobylon) return <span className={`font-mono ${className}`}>{chatId}</span>;
  return (
    <a
      href={`${ROBYLON_BASE}/${chatId}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={`font-mono text-[#2d6a4f] hover:underline inline-flex items-center gap-1 ${className}`}
    >
      {chatId}
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-60 shrink-0">
        <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V8M8 1h3m0 0v3m0-3L5 7"/>
      </svg>
    </a>
  );
}

function ParamBadge({ val }: { val: ParamScore | undefined }) {
  if (val === 'Yes') return <span className="text-green-500 font-bold">✓</span>;
  if (val === 'No')  return <span className="text-red-500 font-bold">✗</span>;
  if (val === 'NA')  return <span className="text-gray-300">—</span>;
  return <span className="text-gray-200">·</span>;
}

// ── Metadata (Excel / CSV) Parsing ────────────────────────────────────────────
interface MetaRow { agent?: string; tags?: string; csat?: string; date?: string; }
type MetaMap = Record<string, MetaRow>; // keyed by chat_id

/**
 * Parse an Excel (.xlsx/.xls) or CSV file and build a chat_id → metadata map.
 * Detects the chat_id column by looking for "chat_id", "chat id", "id", "chatid" (case-insensitive).
 * Detects agent, tags, csat, date columns similarly.
 */
async function parseMetaFile(file: File): Promise<{ map: MetaMap; headers: string[]; rows: number; error?: string }> {
  const lc = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');

  function toMap(rows: Record<string, string>[]): { map: MetaMap; headers: string[]; rows: number; error?: string } {
    if (!rows.length) return { map: {}, headers: [], rows: 0, error: 'File is empty' };
    const headers = Object.keys(rows[0]);
    const find = (patterns: string[]) => headers.find(h => patterns.some(p => lc(h) === p || lc(h).includes(p))) || '';
    const chatIdCol = find(['chatid', 'chat_id', 'chatid', 'id', 'conversationid']);
    if (!chatIdCol) return { map: {}, headers, rows: rows.length, error: 'No chat_id column found. Please include a column named "chat_id" or "id".' };
    const agentCol = find(['agentname', 'agent', 'name', 'assignee', 'assignedto']);
    const tagsCol  = find(['tags', 'tag', 'category', 'type', 'issue']);
    const csatCol  = find(['csat', 'rating', 'score', 'feedback', 'satisfaction']);
    const dateCol  = find(['date', 'createdat', 'time', 'started']);
    const map: MetaMap = {};
    for (const r of rows) {
      const id = String(r[chatIdCol] || '').trim();
      if (!id) continue;
      map[id] = {
        agent: agentCol ? r[agentCol]?.trim() : undefined,
        tags:  tagsCol  ? r[tagsCol]?.trim()  : undefined,
        csat:  csatCol  ? r[csatCol]?.trim()  : undefined,
        date:  dateCol  ? r[dateCol]?.trim()  : undefined,
      };
    }
    return { map, headers, rows: rows.length };
  }

  const isExcel = file.name.match(/\.(xlsx|xls|ods)$/i);
  if (isExcel) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    // Normalise keys to strings
    const rows = raw.map(r => {
      const out: Record<string, string> = {};
      for (const k of Object.keys(r)) out[String(k)] = String(r[k]);
      return out;
    });
    return toMap(rows);
  } else {
    // CSV
    const text = await file.text();
    return toMap(parseRawCSV(text));
  }
}

// ── CSV Parsing ────────────────────────────────────────────────────────────────
function splitCSVLine(line: string): string[] {
  const vals: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (line[i] === ',' && !inQ) { vals.push(cur); cur = ''; }
    else cur += line[i];
  }
  vals.push(cur);
  return vals.map(v => v.replace(/^"|"$/g, ''));
}

function parseRawCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    return row;
  });
}

function isWintFormat(rows: Record<string, string>[]): boolean {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]);
  return keys.includes('messages') && keys.includes('chat_id') && keys.includes('conversation_started');
}

function extractWint(messagesStr: string): { agent: string; csat: string; transcript: string } {
  let msgs: any[] = [];
  try { msgs = JSON.parse(messagesStr); } catch { return { agent: '', csat: '', transcript: messagesStr.slice(0, 500) }; }

  let agent = '';
  for (const m of msgs) {
    const s = m.sender || '';
    const c = (m.content || '').toLowerCase();
    if (s && s !== 'User' && s !== 'Bot' && !c.includes('auto-assigned') && !c.includes('assigned by')) {
      agent = s; break;
    }
  }

  let csat = '';
  let awaitRating = false;
  for (const m of msgs) {
    const btns: string[] = m.buttons || [];
    if (btns.some(b => ['good', 'could be better', 'bad'].includes(b.toLowerCase()))) {
      awaitRating = true; continue;
    }
    if (awaitRating && m.sender === 'User') {
      const v = (m.content || '').trim().toLowerCase();
      csat = v === 'good' ? '5' : v === 'could be better' ? '3' : v === 'bad' ? '1' : '';
      break;
    }
  }

  const lines: string[] = [];
  for (const m of msgs) {
    const content = (m.content || '').trim();
    if (!content || m.buttons) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
      low.includes('waiting to assign') || low.includes('please rate your experience') ||
      low.includes('[buttons:') || low.startsWith('good could be better')) continue;
    const role = m.sender === 'User' ? 'Customer' : m.sender === 'Bot' ? 'Bot' : 'Agent';
    lines.push(`${role}: ${content}`);
  }
  return { agent, csat, transcript: lines.join('\n') };
}

function buildParsedRows(rows: Record<string, string>[]): ParsedRow[] {
  return rows.map(r => {
    const { agent, csat, transcript } = extractWint(r.messages || '');
    return { chatId: r.chat_id || '', agent, date: (r.conversation_started || '').slice(0, 10), csat, transcript };
  });
}

// ── Score Detail Modal ────────────────────────────────────────────────────────
function ScoreDetail({ entry, onClose }: { entry: IQSScoreEntry; onClose: () => void }) {
  const t = iqsTheme(entry.iqs);
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-3xl max-h-[92vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-xl"
              style={{ background: t.bg, color: t.text }}>{entry.iqs}%</div>
            <div>
              <p className="font-bold text-gray-900 text-base">{entry.agentName || 'Unknown Agent'}</p>
              <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <ChatLink chatId={entry.chatId} className="text-xs" /> · {entry.scoredAt.slice(0, 10)}
                {entry.tags && <> · <span className="text-gray-500">{entry.tags}</span></>}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 2l12 12M14 2L2 14"/>
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 grid md:grid-cols-2 gap-6">
          {/* Parameters */}
          <div>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3">Parameter Scores</p>
            <div className="space-y-3">
              {PARAM_ORDER.map(p => {
                const val = entry.scores[p];
                return (
                  <div key={p} className={`rounded-xl p-3 ${val === 'No' ? 'bg-red-50' : val === 'Yes' ? 'bg-green-50/50' : 'bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-700 flex items-center gap-2">
                        <ParamBadge val={val} />
                        {PARAM_NAMES[p]}
                      </span>
                      <span className="text-[10px] text-gray-400 font-medium">{Math.round(WEIGHTS[p] * 100)}% wt</span>
                    </div>
                    {entry.reasoning[p] && (
                      <p className="text-[11px] text-gray-500 leading-relaxed ml-5">{entry.reasoning[p]}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right side */}
          <div className="space-y-4">
            {entry.summary && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Summary</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">{entry.summary}</p>
              </div>
            )}
            {entry.csat && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">CSAT</p>
                <p className="text-sm font-semibold text-gray-700">
                  {entry.csat === '5' ? '⭐ Good' : entry.csat === '3' ? '😐 Could be better' : entry.csat === '1' ? '👎 Bad' : entry.csat}
                </p>
              </div>
            )}
            {entry.transcript && (
              <div>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2">Transcript</p>
                <pre className="text-[11px] text-gray-600 bg-gray-50 rounded-xl px-4 py-3 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed font-sans">
                  {entry.transcript}
                </pre>
              </div>
            )}
            <p className="text-[10px] text-gray-300">Scored by {(entry.scoredBy || '').split('@')[0]} · {entry.provider}/{entry.model}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent Card ────────────────────────────────────────────────────────────────
function AgentCard({ stat, entries }: { stat: AgentStat; entries: IQSScoreEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const t = iqsTheme(stat.avgIqs);
  const initials = stat.agent.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const agentEntries = entries.filter(e => e.agentName === stat.agent);

  const paramData = useMemo(() => PARAM_ORDER.map(p => {
    const n = agentEntries.filter(e => e.scores[p] === 'No').length;
    return { p, failPct: agentEntries.length ? Math.round(n / agentEntries.length * 100) : 0 };
  }).sort((a, b) => b.failPct - a.failPct), [agentEntries]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-base shrink-0"
            style={{ background: t.bar }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-sm truncate">{stat.agent}</p>
            <p className="text-xs text-gray-400">{stat.chats} chats</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xl font-bold" style={{ color: t.text }}>{stat.avgIqs}%</p>
            <p className="text-[10px] text-gray-400 font-semibold uppercase">IQS</p>
          </div>
        </div>

        {/* IQS bar */}
        <div className="mt-3 flex items-center gap-2">
          <IQSBar iqs={stat.avgIqs} height={5} />
          <span className="text-[10px] text-gray-400 shrink-0">{stat.minIqs}–{stat.maxIqs}%</span>
        </div>

        {/* Mini stats */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2">
            <span className="text-green-600 font-bold text-sm">{stat.high}</span>
            <span className="text-[10px] text-green-700">≥ 90%</span>
          </div>
          <div className="flex items-center gap-2 bg-red-50 rounded-xl px-3 py-2">
            <span className="text-red-500 font-bold text-sm">{stat.atRisk}</span>
            <span className="text-[10px] text-red-700">Below 70%</span>
          </div>
        </div>

        <button onClick={() => setExpanded(!expanded)}
          className="mt-3 w-full text-[11px] text-gray-400 hover:text-[#2d6a4f] transition flex items-center justify-center gap-1.5 py-1 font-medium">
          {expanded ? 'Hide breakdown ↑' : 'Parameter breakdown ↓'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/60 space-y-2.5">
          {paramData.map(({ p, failPct }) => (
            <div key={p} className="flex items-center gap-3">
              <span className="text-[11px] text-gray-600 shrink-0 w-40 truncate">{PARAM_NAMES[p]}</span>
              <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                <div className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${failPct}%`,
                    background: failPct >= 40 ? '#ef4444' : failPct >= 20 ? '#f97316' : '#22c55e'
                  }} />
              </div>
              <span className={`text-[11px] font-bold w-8 text-right tabular-nums ${failPct >= 40 ? 'text-red-500' : failPct >= 20 ? 'text-orange-500' : 'text-green-600'}`}>
                {failPct}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function QualityClient() {
  const [tab, setTab] = useState<'upload' | 'performance' | 'log'>('upload');

  // Upload tab state
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [isWint, setIsWint] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [manualCols, setManualCols] = useState({ transcript: '', chatId: '', agent: '', tags: '', date: '', csat: '' });
  const [rowLimit, setRowLimit] = useState(0);
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [batchResults, setBatchResults] = useState<IQSScoreEntry[]>([]);
  const [batchErrors, setBatchErrors] = useState<{ row: number; chatId: string; error: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Metadata file state
  const [metaMap, setMetaMap] = useState<MetaMap>({});
  const [metaFileName, setMetaFileName] = useState('');
  const [metaRowCount, setMetaRowCount] = useState(0);
  const [metaError, setMetaError] = useState('');
  const [metaHeaders, setMetaHeaders] = useState<string[]>([]);
  const metaFileRef = useRef<HTMLInputElement>(null);

  // Scores state
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [paramFails, setParamFails] = useState<Record<string, number>>({});
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  // Log filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterMin, setFilterMin] = useState(0);
  const [filterMax, setFilterMax] = useState(100);
  const [filterTag, setFilterTag] = useState('');
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('all');

  // Detail modal
  const [detailEntry, setDetailEntry] = useState<IQSScoreEntry | null>(null);

  // ── Filtered entries ────────────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    const now = new Date();
    const cutoff = dateRange === 'today'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      : dateRange === '7d' ? new Date(Date.now() - 7 * 86400000).toISOString()
      : dateRange === '30d' ? new Date(Date.now() - 30 * 86400000).toISOString()
      : null;

    return entries.filter(e => {
      if (filterAgent && e.agentName !== filterAgent) return false;
      if (e.iqs < filterMin || e.iqs > filterMax) return false;
      if (filterTag && !(e.tags || '').toLowerCase().includes(filterTag.toLowerCase())) return false;
      if (cutoff && e.scoredAt < cutoff) return false;
      return true;
    });
  }, [entries, filterAgent, filterMin, filterMax, filterTag, dateRange]);

  // ── Load scores ─────────────────────────────────────────────────────────────
  const loadScores = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await fetch(`/api/quality/scores?limit=2000`).then(r => r.json());
      setEntries(data.entries || []);
      setAgentStats(data.agentStats || []);
      setParamFails(data.paramFails || {});
      setAvailableAgents(data.availableAgents || []);
      setLogsLoaded(true);
    } catch {}
    setLogsLoading(false);
  }, []);

  const switchTab = (t: typeof tab) => {
    setTab(t);
    if ((t === 'performance' || t === 'log') && !logsLoaded) loadScores();
  };

  // ── File select ─────────────────────────────────────────────────────────────
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBatchResults([]); setBatchErrors([]); setProgress(0); setProgressLabel('');
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const rows = parseRawCSV(text);
      if (!rows.length) return;
      setRawRows(rows);
      const headers = Object.keys(rows[0]);
      setCsvHeaders(headers);
      const wint = isWintFormat(rows);
      setIsWint(wint);
      if (wint) {
        setParsedRows(buildParsedRows(rows));
      } else {
        const lc = (s: string) => s.toLowerCase();
        setManualCols({
          transcript: headers.find(h => lc(h).includes('transcript') || lc(h).includes('message') || lc(h).includes('chat')) || '',
          chatId: headers.find(h => lc(h).includes('id')) || '',
          agent: headers.find(h => lc(h).includes('agent') || lc(h).includes('name')) || '',
          tags: headers.find(h => lc(h).includes('tag')) || '',
          date: headers.find(h => lc(h).includes('date')) || '',
          csat: headers.find(h => lc(h).includes('csat') || lc(h).includes('rating')) || '',
        });
      }
    };
    reader.readAsText(file);
  };

  const handleMetaFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMetaFileName(file.name);
    setMetaError('');
    const result = await parseMetaFile(file);
    if (result.error) {
      setMetaError(result.error);
      setMetaMap({});
      setMetaRowCount(0);
    } else {
      setMetaMap(result.map);
      setMetaRowCount(result.rows);
      setMetaHeaders(result.headers);
    }
  };

  // ── Batch score ─────────────────────────────────────────────────────────────
  const runBatch = async () => {
    const baseRows: ParsedRow[] = isWint
      ? (rowLimit > 0 ? parsedRows.slice(0, rowLimit) : parsedRows)
      : (rowLimit > 0 ? rawRows.slice(0, rowLimit) : rawRows).map(r => ({
          chatId: manualCols.chatId ? r[manualCols.chatId] : `row_${rawRows.indexOf(r) + 1}`,
          agent: manualCols.agent ? r[manualCols.agent] : '',
          date: manualCols.date ? r[manualCols.date] : '',
          csat: manualCols.csat ? r[manualCols.csat] : '',
          transcript: manualCols.transcript ? r[manualCols.transcript] : '',
        }));

    // Merge metadata by chat_id (metadata file takes priority over transcript-extracted values)
    const rows: ParsedRow[] = baseRows.map(r => {
      const meta = metaMap[r.chatId] || metaMap[String(Number(r.chatId))]; // handle int/string mismatch
      if (!meta) return r;
      return {
        ...r,
        agent: meta.agent || r.agent,
        tags:  meta.tags  || '',
        csat:  meta.csat  || r.csat,
        date:  meta.date  || r.date,
      };
    });

    if (!rows.length) return;
    setScoring(true); setBatchResults([]); setBatchErrors([]);
    const results: IQSScoreEntry[] = [];
    const errors: { row: number; chatId: string; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const chatId = row.chatId || `row_${i + 1}`;
      setProgressLabel(`Scoring ${i + 1} of ${rows.length} — ${row.agent || chatId}`);
      setProgress(Math.round(((i + 1) / rows.length) * 100));
      if (!row.transcript.trim() || row.transcript === 'nan') {
        errors.push({ row: i + 1, chatId, error: 'Empty transcript' });
        continue;
      }
      try {
        const res = await fetch('/api/quality/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: row.transcript, chatId, agentName: row.agent, date: row.date, csat: row.csat, tags: row.tags || '' }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        results.push(data.entry);
      } catch (err: any) {
        errors.push({ row: i + 1, chatId, error: err.message });
      }
      setBatchResults([...results]);
    }

    setBatchErrors(errors);
    setProgressLabel(`Done — ${results.length} scored${errors.length ? `, ${errors.length} failed` : ''}`);
    setScoring(false);
    setLogsLoaded(false);
  };

  const exportCSV = () => {
    if (!batchResults.length) return;
    const headers = ['Chat ID', 'Agent', 'Date', 'CSAT', 'IQS', ...PARAM_ORDER.map(p => PARAM_NAMES[p]), 'Summary'];
    const rows = batchResults.map(e => [
      e.chatId, e.agentName, e.date || '', e.csat || '', e.iqs,
      ...PARAM_ORDER.map(p => e.scores[p] || ''),
      (e.summary || '').replace(/\n/g, ' '),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `iqs_scores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const totalToScore = rowLimit > 0
    ? Math.min(rowLimit, isWint ? parsedRows.length : rawRows.length)
    : (isWint ? parsedRows.length : rawRows.length);

  const avgIqs = batchResults.length
    ? Math.round(batchResults.reduce((s, e) => s + e.iqs, 0) / batchResults.length) : 0;

  const maxParamFail = Math.max(...Object.values(paramFails), 1);

  // ── Agent preview breakdown for Wint format ──────────────────────────────────
  const wintAgentPreview = useMemo(() => {
    if (!isWint || !parsedRows.length) return [];
    const map: Record<string, { count: number; csat: number[] }> = {};
    for (const r of parsedRows) {
      const a = r.agent || 'Unknown';
      if (!map[a]) map[a] = { count: 0, csat: [] };
      map[a].count++;
      if (r.csat) map[a].csat.push(Number(r.csat));
    }
    return Object.entries(map)
      .map(([agent, d]) => ({
        agent,
        count: d.count,
        csatPct: d.csat.length ? Math.round(d.csat.filter(c => c === 5).length / d.csat.length * 100) : null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [isWint, parsedRows]);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-[#f7f8fa] font-sans antialiased">
      {detailEntry && <ScoreDetail entry={detailEntry} onClose={() => setDetailEntry(null)} />}

      {/* ── Header ── */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4L6 9l5 5"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-sm font-bold text-gray-900 tracking-tight">Quality Intelligence</h1>
            <p className="text-[11px] text-gray-400">IQS · Wint Wealth</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          {([
            { key: 'upload', label: 'Upload & Score' },
            { key: 'performance', label: 'Performance' },
            { key: 'log', label: 'Score Log' },
          ] as const).map(({ key, label }) => (
            <button key={key} onClick={() => switchTab(key)}
              className={`text-xs px-4 py-1.5 rounded-lg font-semibold transition ${
                tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{label}</button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">

          {/* ── UPLOAD TAB ── */}
          {tab === 'upload' && (
            <>
              {/* Drop zone */}
              <div
                onClick={() => fileRef.current?.click()}
                className={`bg-white rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition
                  ${fileName ? 'border-[#2d6a4f]/40 bg-[#2d6a4f]/5' : 'border-gray-200 hover:border-[#2d6a4f]/30 hover:bg-gray-50'}`}
              >
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
                {fileName ? (
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-[#2d6a4f]">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span className="font-bold text-sm">{fileName}</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {isWint ? parsedRows.length : rawRows.length} rows · {isWint
                        ? <span className="text-[#2d6a4f] font-semibold">Wint format detected ✓</span>
                        : 'generic format'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Click to change file</p>
                  </div>
                ) : (
                  <>
                    <svg className="mx-auto mb-3 text-gray-300" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                    <p className="text-sm font-semibold text-gray-700">Upload transcript CSV</p>
                    <p className="text-xs text-gray-400 mt-1">Supports Wint bulk export format · Click or drag & drop</p>
                  </>
                )}
              </div>

              {/* Metadata file upload (optional, always shown when transcript is loaded) */}
              {(isWint ? parsedRows.length : rawRows.length) > 0 && !scoring && batchResults.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Metadata file <span className="text-gray-400 font-normal">(optional)</span></h2>
                      <p className="text-xs text-gray-400 mt-1">
                        Upload an Excel or CSV with <strong className="text-gray-600">chat_id, agent_name, tags, csat</strong> columns
                        to enrich transcripts. Data is matched by chat_id.
                      </p>
                    </div>
                    <input ref={metaFileRef} type="file" accept=".csv,.xlsx,.xls,.ods" className="hidden" onChange={handleMetaFile} />
                    <button
                      onClick={() => metaFileRef.current?.click()}
                      className="shrink-0 text-xs px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:border-[#2d6a4f] hover:text-[#2d6a4f] transition font-semibold">
                      {metaFileName ? '↺ Change file' : '+ Upload Excel / CSV'}
                    </button>
                  </div>

                  {metaFileName && !metaError && (
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 bg-[#2d6a4f]/10 text-[#2d6a4f] rounded-xl px-3 py-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span className="text-xs font-semibold">{metaFileName}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {Object.keys(metaMap).length} chat IDs loaded · {metaRowCount} rows
                      </span>
                      {metaHeaders.length > 0 && (
                        <span className="text-xs text-gray-400">
                          Columns: {metaHeaders.slice(0, 6).join(', ')}{metaHeaders.length > 6 ? '…' : ''}
                        </span>
                      )}
                    </div>
                  )}

                  {metaError && (
                    <div className="mt-3 flex items-center gap-2 text-red-500 text-xs bg-red-50 rounded-xl px-3 py-2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {metaError}
                    </div>
                  )}

                  {/* Match preview: how many transcript rows have metadata */}
                  {Object.keys(metaMap).length > 0 && (isWint ? parsedRows : rawRows).length > 0 && (() => {
                    const total = isWint ? parsedRows.length : rawRows.length;
                    const matched = (isWint ? parsedRows : rawRows as any[]).filter((r: any) => {
                      const id = isWint ? r.chatId : (manualCols.chatId ? r[manualCols.chatId] : '');
                      return metaMap[id] || metaMap[String(Number(id))];
                    }).length;
                    return (
                      <div className="mt-3 text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                        <span className="font-semibold text-amber-700">{matched} of {total}</span> transcripts matched to metadata
                        {matched < total && <span className="text-amber-600"> · {total - matched} will use values from the transcript</span>}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Transcript preview + score button */}
              {isWint && wintAgentPreview.length > 0 && !scoring && batchResults.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Ready to score</h2>
                      <p className="text-xs text-gray-400 mt-0.5">{parsedRows.length} chats from {wintAgentPreview.length} agents</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Limit (0 = all)</label>
                        <input type="number" min={0} value={rowLimit}
                          onChange={e => setRowLimit(parseInt(e.target.value) || 0)}
                          className="w-20 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30" />
                      </div>
                      <button onClick={runBatch} disabled={scoring}
                        className="px-5 py-2 bg-[#2d6a4f] text-white rounded-xl font-bold text-sm hover:bg-[#245a41] disabled:opacity-50 transition">
                        Score {totalToScore} chats →
                      </button>
                    </div>
                  </div>

                  {/* Agent breakdown preview */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {wintAgentPreview.map(({ agent, count, csatPct }) => {
                      const initials = agent.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                      return (
                        <div key={agent} className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-3 py-2.5">
                          <div className="w-7 h-7 rounded-full bg-[#2d6a4f]/20 text-[#2d6a4f] text-[10px] font-bold flex items-center justify-center shrink-0">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{agent}</p>
                            <p className="text-[10px] text-gray-400">
                              {count} chat{count !== 1 ? 's' : ''}
                              {csatPct !== null && <span className="ml-1 text-amber-500">· {csatPct}% Good</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Generic format: column mapper */}
              {!isWint && rawRows.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Map columns</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {([
                      { label: 'Transcript *', key: 'transcript', req: true },
                      { label: 'Chat ID', key: 'chatId', req: false },
                      { label: 'Agent Name', key: 'agent', req: false },
                      { label: 'Tags', key: 'tags', req: false },
                      { label: 'Date', key: 'date', req: false },
                      { label: 'CSAT', key: 'csat', req: false },
                    ] as const).map(({ label, key, req }) => (
                      <div key={key}>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
                        <select value={manualCols[key]}
                          onChange={e => setManualCols(c => ({ ...c, [key]: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30">
                          {!req && <option value="">(none)</option>}
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex items-center gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Limit (0 = all)</label>
                      <input type="number" min={0} value={rowLimit}
                        onChange={e => setRowLimit(parseInt(e.target.value) || 0)}
                        className="w-24 text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30" />
                    </div>
                    <button onClick={runBatch} disabled={scoring || !manualCols.transcript}
                      className="px-5 py-2 bg-[#2d6a4f] text-white rounded-xl font-bold text-sm hover:bg-[#245a41] disabled:opacity-50 transition mt-4">
                      Score {totalToScore} chats →
                    </button>
                  </div>
                </div>
              )}

              {/* Progress */}
              {scoring && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-600 font-medium">{progressLabel}</span>
                    <span className="text-sm font-bold text-[#2d6a4f]">{progress}%</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2.5">
                    <div className="bg-[#2d6a4f] rounded-full h-2.5 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  {batchResults.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2">{batchResults.length} scored so far · avg IQS: {avgIqs}%</p>
                  )}
                </div>
              )}

              {/* Results */}
              {!scoring && batchResults.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Scoring complete</h2>
                      <p className="text-xs text-gray-400 mt-0.5">{progressLabel}</p>
                    </div>
                    <button onClick={exportCSV}
                      className="text-xs px-4 py-2 bg-[#2d6a4f] text-white rounded-xl font-semibold hover:bg-[#245a41] transition">
                      Export CSV
                    </button>
                  </div>

                  {/* Summary cards */}
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Scored', value: batchResults.length, color: '#111827' },
                      { label: 'Avg IQS', value: `${avgIqs}%`, color: iqsTheme(avgIqs).text },
                      { label: 'Below 70%', value: batchResults.filter(e => e.iqs < 70).length, color: '#dc2626' },
                      { label: '≥ 90%', value: batchResults.filter(e => e.iqs >= 90).length, color: '#16a34a' },
                    ].map(s => (
                      <div key={s.label} className="bg-gray-50 rounded-2xl p-4 text-center">
                        <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Results table */}
                  <div className="overflow-x-auto -mx-1">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {['Agent', 'Chat ID', 'IQS', 'CSAT', 'Fails', 'Summary'].map(h => (
                            <th key={h} className="text-left py-2 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batchResults.map((e, i) => {
                          const fails = PARAM_ORDER.filter(p => e.scores[p] === 'No');
                          return (
                            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition"
                              onClick={() => setDetailEntry(e)}>
                              <td className="py-2.5 px-2 font-semibold text-gray-800">{e.agentName || '—'}</td>
                              <td className="py-2.5 px-2"><ChatLink chatId={e.chatId} className="text-xs" /></td>
                              <td className="py-2.5 px-2"><IQSPill iqs={e.iqs} /></td>
                              <td className="py-2.5 px-2 text-gray-500">
                                {e.csat === '5' ? '👍 Good' : e.csat === '3' ? '😐 Mid' : e.csat === '1' ? '👎 Bad' : '—'}
                              </td>
                              <td className="py-2.5 px-2">
                                {fails.length > 0
                                  ? <span className="text-red-400 font-medium">{fails.length} fails</span>
                                  : <span className="text-green-500">✓ Clean</span>}
                              </td>
                              <td className="py-2.5 px-2 text-gray-400 max-w-[200px] truncate hidden lg:table-cell">{e.summary}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {batchErrors.length > 0 && (
                    <details>
                      <summary className="text-xs text-red-500 cursor-pointer font-semibold">{batchErrors.length} failed rows</summary>
                      <div className="mt-2 space-y-1">
                        {batchErrors.map((e, i) => (
                          <p key={i} className="text-xs text-red-400">Row {e.row} ({e.chatId}): {e.error}</p>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── PERFORMANCE TAB ── */}
          {tab === 'performance' && (
            <>
              {logsLoading && (
                <div className="flex items-center justify-center py-24">
                  <div className="text-gray-400 text-sm animate-pulse">Loading scores…</div>
                </div>
              )}

              {!logsLoading && agentStats.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
                  <p className="text-gray-400 text-sm">No scored chats yet.</p>
                  <p className="text-xs text-gray-300 mt-1">Upload transcripts and score them first.</p>
                </div>
              )}

              {!logsLoading && agentStats.length > 0 && (
                <>
                  {/* Top KPIs */}
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      { label: 'Total Chats', value: entries.length },
                      {
                        label: 'Team Avg IQS',
                        value: `${Math.round(entries.reduce((s, e) => s + e.iqs, 0) / (entries.length || 1))}%`,
                        color: iqsTheme(Math.round(entries.reduce((s, e) => s + e.iqs, 0) / (entries.length || 1))).text,
                      },
                      { label: 'Agents', value: agentStats.length },
                      { label: 'At Risk (<70%)', value: entries.filter(e => e.iqs < 70).length, color: '#dc2626' },
                    ].map(s => (
                      <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">{s.label}</p>
                        <p className="text-3xl font-bold mt-1" style={{ color: s.color || '#111827' }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Agent cards grid */}
                  <div>
                    <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Agent Scorecards</h2>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {agentStats.map(a => (
                        <AgentCard key={a.agent} stat={a} entries={entries} />
                      ))}
                    </div>
                  </div>

                  {/* Team parameter breakdown */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <h2 className="text-sm font-bold text-gray-900 mb-1">Team Parameter Breakdown</h2>
                    <p className="text-xs text-gray-400 mb-4">Failure rate across all {entries.length} scored chats</p>
                    <div className="space-y-3">
                      {PARAM_ORDER
                        .map(p => ({ p, pct: paramFails[p] || 0 }))
                        .sort((a, b) => b.pct - a.pct)
                        .map(({ p, pct }) => (
                          <div key={p} className="flex items-center gap-4">
                            <span className="text-xs text-gray-700 w-48 shrink-0">{PARAM_NAMES[p]}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div className="rounded-full h-2 transition-all"
                                style={{
                                  width: `${Math.round((pct / maxParamFail) * 100)}%`,
                                  background: pct >= 40 ? '#ef4444' : pct >= 20 ? '#f97316' : '#22c55e',
                                }} />
                            </div>
                            <span className={`text-xs font-bold w-12 text-right tabular-nums ${pct >= 40 ? 'text-red-500' : pct >= 20 ? 'text-orange-500' : 'text-green-600'}`}>
                              {pct}%
                            </span>
                            <span className="text-[10px] text-gray-300 w-12 text-right">{Math.round(WEIGHTS[p] * 100)}% wt</span>
                          </div>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── SCORE LOG TAB ── */}
          {tab === 'log' && (
            <>
              {/* Filters */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex flex-wrap items-end gap-4">
                  {/* Date range chips */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Period</p>
                    <div className="flex items-center gap-1">
                      {(['today', '7d', '30d', 'all'] as const).map(r => (
                        <button key={r} onClick={() => setDateRange(r)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                            dateRange === r ? 'bg-[#2d6a4f] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {r === 'today' ? 'Today' : r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'All time'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Agent filter */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Agent</p>
                    <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30 min-w-[140px]">
                      <option value="">All agents</option>
                      {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>

                  {/* IQS range */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">IQS Range</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={100} value={filterMin}
                        onChange={e => setFilterMin(parseInt(e.target.value) || 0)}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                      <span className="text-gray-400 text-xs">–</span>
                      <input type="number" min={0} max={100} value={filterMax}
                        onChange={e => setFilterMax(parseInt(e.target.value) || 100)}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                    </div>
                  </div>

                  {/* Tag search */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Tag</p>
                    <input value={filterTag} onChange={e => setFilterTag(e.target.value)}
                      placeholder="e.g. Repayment"
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 w-32 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30" />
                  </div>

                  <button onClick={loadScores} disabled={logsLoading}
                    className="text-xs px-4 py-1.5 border border-[#2d6a4f] text-[#2d6a4f] rounded-xl font-semibold hover:bg-[#2d6a4f] hover:text-white disabled:opacity-50 transition">
                    {logsLoading ? 'Loading…' : '↻ Refresh'}
                  </button>
                </div>
              </div>

              {logsLoading && (
                <div className="flex items-center justify-center py-24">
                  <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
                </div>
              )}

              {!logsLoading && filteredEntries.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
                  <p className="text-gray-400 text-sm">No chats match these filters.</p>
                </div>
              )}

              {!logsLoading && filteredEntries.length > 0 && (
                <>
                  {/* Summary strip */}
                  <div className="grid grid-cols-4 gap-4">
                    {[
                      { label: 'Showing', value: filteredEntries.length },
                      {
                        label: 'Avg IQS', value: `${Math.round(filteredEntries.reduce((s, e) => s + e.iqs, 0) / filteredEntries.length)}%`,
                        color: iqsTheme(Math.round(filteredEntries.reduce((s, e) => s + e.iqs, 0) / filteredEntries.length)).text,
                      },
                      { label: 'Below 70%', value: filteredEntries.filter(e => e.iqs < 70).length, color: '#dc2626' },
                      { label: '≥ 90%', value: filteredEntries.filter(e => e.iqs >= 90).length, color: '#16a34a' },
                    ].map(s => (
                      <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{s.label}</p>
                        <p className="text-2xl font-bold mt-0.5" style={{ color: s.color || '#111827' }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Table */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/50">
                          {['Agent', 'Chat ID', 'IQS', 'Fails', 'CSAT', 'Tags', 'Scored'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEntries.map((e, i) => {
                          const fails = PARAM_ORDER.filter(p => e.scores[p] === 'No');
                          return (
                            <tr key={i}
                              className="border-b border-gray-50 hover:bg-[#2d6a4f]/5 cursor-pointer transition"
                              onClick={() => setDetailEntry(e)}>
                              <td className="px-4 py-3 font-semibold text-gray-800">{e.agentName || '—'}</td>
                              <td className="px-4 py-3"><ChatLink chatId={e.chatId} className="text-xs" /></td>
                              <td className="px-4 py-3"><IQSPill iqs={e.iqs} /></td>
                              <td className="px-4 py-3">
                                {fails.length === 0
                                  ? <span className="text-green-500 text-[11px] font-semibold">✓ Clean</span>
                                  : <span className="text-red-400 font-semibold text-[11px]">{fails.length} ✗</span>}
                              </td>
                              <td className="px-4 py-3 text-gray-500">
                                {e.csat === '5' ? '👍' : e.csat === '3' ? '😐' : e.csat === '1' ? '👎' : '—'}
                              </td>
                              <td className="px-4 py-3 text-gray-400 max-w-[100px] truncate">{e.tags || '—'}</td>
                              <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                                {e.scoredAt.slice(0, 16).replace('T', ' ')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
