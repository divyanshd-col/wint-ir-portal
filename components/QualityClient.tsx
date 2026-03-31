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
interface MetaRow { agent?: string; tags?: string; csat?: string; date?: string; }
type MetaMap = Record<string, MetaRow>;

// ── IQS Helpers ───────────────────────────────────────────────────────────────
function iqsTheme(iqs: number) {
  if (iqs >= 90) return { text: '#15803d', bg: '#dcfce7', bar: '#22c55e', label: 'Excellent' };
  if (iqs >= 80) return { text: '#b45309', bg: '#fef3c7', bar: '#f59e0b', label: 'Good' };
  if (iqs >= 70) return { text: '#c2410c', bg: '#ffedd5', bar: '#f97316', label: 'Average' };
  return { text: '#b91c1c', bg: '#fee2e2', bar: '#ef4444', label: 'At Risk' };
}

function IQSPill({ iqs, size = 'sm' }: { iqs: number; size?: 'sm' | 'lg' }) {
  const t = iqsTheme(iqs);
  if (size === 'lg') return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-sm"
      style={{ background: t.bg, color: t.text }}>
      {iqs}%
      <span className="text-[10px] font-medium opacity-70">{t.label}</span>
    </span>
  );
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold tabular-nums"
      style={{ background: t.bg, color: t.text }}>{iqs}%</span>
  );
}

function IQSRing({ iqs, size = 56 }: { iqs: number; size?: number }) {
  const t = iqsTheme(iqs);
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (iqs / 100) * circ;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.bar} strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <span className="absolute text-xs font-bold tabular-nums" style={{ color: t.text }}>{iqs}%</span>
    </div>
  );
}

const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';
function ChatLink({ chatId, className = '' }: { chatId: string; className?: string }) {
  const isRobylon = /^\d+$/.test(chatId.trim());
  if (!isRobylon) return <span className={`font-mono ${className}`}>{chatId}</span>;
  return (
    <a href={`${ROBYLON_BASE}/${chatId}`} target="_blank" rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className={`font-mono text-emerald-600 hover:underline inline-flex items-center gap-1 ${className}`}>
      {chatId}
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-50">
        <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V8M8 1h3m0 0v3m0-3L5 7" />
      </svg>
    </a>
  );
}

function ParamBadge({ val }: { val: ParamScore | undefined }) {
  if (val === 'Yes') return <span className="text-emerald-500 font-bold text-sm">✓</span>;
  if (val === 'No')  return <span className="text-red-500 font-bold text-sm">✗</span>;
  return <span className="text-gray-300 text-sm">—</span>;
}

// ── CSV / Excel Parsing ───────────────────────────────────────────────────────
function splitCSVLine(line: string): string[] {
  const vals: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
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
  return keys.includes('messages') && keys.includes('chat_id');
}

const CSAT_WORDS: Record<string, string> = { good: '5', 'could be better': '3', bad: '1' };
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
  let csat = '', awaitRating = false;
  for (const m of msgs) {
    const btns: string[] = m.buttons || [];
    if (btns.some(b => ['good', 'could be better', 'bad'].includes(b.toLowerCase()))) { awaitRating = true; continue; }
    if (awaitRating && m.sender === 'User') {
      const v = (m.content || '').trim().toLowerCase();
      csat = CSAT_WORDS[v] || ''; break;
    }
  }
  const lines: string[] = [];
  for (const m of msgs) {
    const content = (m.content || '').trim();
    if (!content || m.buttons) continue;
    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') || low.includes('waiting to assign') ||
      low.includes('please rate your experience') || low.startsWith('good could be better')) continue;
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

async function parseMetaFile(file: File): Promise<{ map: MetaMap; headers: string[]; rows: number; error?: string }> {
  const lc = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  function toMap(rows: Record<string, string>[]) {
    if (!rows.length) return { map: {}, headers: [], rows: 0, error: 'File is empty' };
    const headers = Object.keys(rows[0]);
    const find = (pats: string[]) => headers.find(h => pats.some(p => lc(h) === p || lc(h).includes(p))) || '';
    const chatIdCol = find(['chatid', 'chat_id', 'id', 'conversationid']);
    if (!chatIdCol) return { map: {}, headers, rows: rows.length, error: 'No chat_id column found. Please include a column named "chat_id" or "id".' };
    const agentCol = find(['agentname', 'agent', 'name', 'assignee']);
    const tagsCol  = find(['tags', 'tag', 'category', 'type']);
    const csatCol  = find(['csat', 'rating', 'feedback']);
    const dateCol  = find(['date', 'createdat', 'started']);
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
    return toMap(raw.map(r => { const o: Record<string, string> = {}; for (const k of Object.keys(r)) o[String(k)] = String(r[k]); return o; }));
  }
  return toMap(parseRawCSV(await file.text()));
}

// ── Score Detail Modal ────────────────────────────────────────────────────────
function ScoreDetail({ entry, onClose }: { entry: IQSScoreEntry; onClose: () => void }) {
  const t = iqsTheme(entry.iqs);
  const fails = PARAM_ORDER.filter(p => entry.scores[p] === 'No');
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:rounded-2xl sm:max-w-3xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4">
          <IQSRing iqs={entry.iqs} size={52} />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-gray-900">{entry.agentName || 'Unknown Agent'}</p>
              {fails.length === 0
                ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Clean</span>
                : <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fails.length} fail{fails.length > 1 ? 's' : ''}</span>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <ChatLink chatId={entry.chatId} className="text-xs" />
              <span>·</span><span>{entry.scoredAt.slice(0, 10)}</span>
              {entry.tags && <><span>·</span><span className="text-gray-500">{entry.tags}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 grid md:grid-cols-2 gap-6">
          {/* Parameters */}
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Parameter Scores</p>
            <div className="space-y-2">
              {PARAM_ORDER.map(p => {
                const val = entry.scores[p];
                return (
                  <div key={p} className={`rounded-xl p-3 ${val === 'No' ? 'bg-red-50 border border-red-100' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-2">
                      <ParamBadge val={val} />
                      <span className="text-xs font-semibold text-gray-700 flex-1">{PARAM_NAMES[p]}</span>
                      <span className="text-[10px] text-gray-400">{Math.round(WEIGHTS[p] * 100)}%</span>
                    </div>
                    {entry.reasoning[p] && <p className="text-[11px] text-gray-500 leading-relaxed mt-1.5 ml-5">{entry.reasoning[p]}</p>}
                  </div>
                );
              })}
            </div>
          </div>
          {/* Right */}
          <div className="space-y-4">
            {entry.summary && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Summary</p>
                <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">{entry.summary}</p>
              </div>
            )}
            {entry.csat && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">CSAT</p>
                <p className="text-sm font-semibold text-gray-700">
                  {entry.csat === '5' ? '⭐ Good' : entry.csat === '3' ? '😐 Could be better' : entry.csat === '1' ? '👎 Bad' : entry.csat}
                </p>
              </div>
            )}
            {entry.transcript && (
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Transcript</p>
                <pre className="text-[11px] text-gray-600 bg-gray-50 rounded-xl px-4 py-3 whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed font-sans">{entry.transcript}</pre>
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
  const t = iqsTheme(stat.avgIqs);
  // normalise empty agentName → 'Unknown' so it matches stat.agent
  const agentEntries = entries.filter(e => (e.agentName || 'Unknown') === stat.agent);

  const paramData = useMemo(() => PARAM_ORDER.map(p => {
    const n = agentEntries.filter(e => e.scores[p] === 'No').length;
    return { p, failPct: agentEntries.length ? Math.round(n / agentEntries.length * 100) : 0 };
  }).sort((a, b) => b.failPct - a.failPct), [agentEntries]);

  const topFails = paramData.filter(d => d.failPct > 0).slice(0, 4);
  const isAtRisk = stat.avgIqs < 70;
  const needsCoaching = stat.atRisk > 0;

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden border ${isAtRisk ? 'border-red-200' : 'border-gray-100'}`}>
      {/* Card header */}
      <div className={`px-5 pt-5 pb-4 ${isAtRisk ? 'bg-red-50/40' : ''}`}>
        <div className="flex items-start gap-3">
          <div className="shrink-0"><IQSRing iqs={stat.avgIqs} size={56} /></div>
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-gray-900 text-sm truncate">{stat.agent}</p>
              {isAtRisk && (
                <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full shrink-0">⚠ At Risk</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{stat.chats} chats · range {stat.minIqs}–{stat.maxIqs}%</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {stat.high > 0 && <span className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">{stat.high} excellent</span>}
              {stat.atRisk > 0 && <span className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full">{stat.atRisk} need review</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Failure breakdown — always visible */}
      <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
        {topFails.length === 0 ? (
          <p className="text-xs text-emerald-600 font-semibold text-center py-1">✓ No consistent failure areas</p>
        ) : (
          <div className="space-y-2.5">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Coaching Focus</p>
            {topFails.map(({ p, failPct }) => (
              <div key={p} className="flex items-center gap-3">
                <span className="text-[11px] text-gray-700 w-36 shrink-0 truncate font-medium">{PARAM_NAMES[p]}</span>
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div className="h-2 rounded-full transition-all" style={{
                    width: `${failPct}%`,
                    background: failPct >= 40 ? '#ef4444' : failPct >= 20 ? '#f97316' : '#22c55e'
                  }} />
                </div>
                <span className={`text-[11px] font-bold w-9 text-right tabular-nums ${failPct >= 40 ? 'text-red-500' : failPct >= 20 ? 'text-orange-500' : 'text-emerald-600'}`}>{failPct}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Nav Item ──────────────────────────────────────────────────────────────────
function NavItem({ icon, label, active, badge, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; badge?: number; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
        active
          ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30'
          : 'text-slate-400 hover:text-white hover:bg-white/8'
      }`}>
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-slate-700 text-slate-300'}`}>
          {badge > 999 ? '999+' : badge}
        </span>
      )}
    </button>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function QualityClient() {
  const [tab, setTab] = useState<'performance' | 'log' | 'upload'>('performance');

  // Upload state
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

  // Meta file
  const [metaMap, setMetaMap] = useState<MetaMap>({});
  const [metaFileName, setMetaFileName] = useState('');
  const [metaRowCount, setMetaRowCount] = useState(0);
  const [metaError, setMetaError] = useState('');
  const metaFileRef = useRef<HTMLInputElement>(null);

  // Scores
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [paramFails, setParamFails] = useState<Record<string, number>>({});
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [totalStored, setTotalStored] = useState(0);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Log filters
  const [filterAgent, setFilterAgent] = useState('');
  const [filterMin, setFilterMin] = useState(0);
  const [filterMax, setFilterMax] = useState(100);
  const [filterTag, setFilterTag] = useState('');
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('all');
  const [detailEntry, setDetailEntry] = useState<IQSScoreEntry | null>(null);

  // ── Filtered entries ─────────────────────────────────────────────────────────
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

  // ── Load scores ──────────────────────────────────────────────────────────────
  const loadScores = useCallback(async () => {
    setLogsLoading(true);
    try {
      const data = await fetch('/api/quality/scores').then(r => r.json());
      setEntries(data.entries || []);
      setAgentStats(data.agentStats || []);
      setParamFails(data.paramFails || {});
      setAvailableAgents(data.availableAgents || []);
      setTotalStored(data.totalStored ?? data.total ?? 0);
      setLogsLoaded(true);
    } catch {}
    setLogsLoading(false);
  }, []);

  const switchTab = (t: typeof tab) => {
    setTab(t);
    if ((t === 'performance' || t === 'log') && !logsLoaded) loadScores();
  };

  const exportAll = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filterAgent) params.set('agent', filterAgent);
      if (filterTag) params.set('tag', filterTag);
      const res = await fetch(`/api/quality/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wint_iqs_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
    setExporting(false);
  }, [filterAgent, filterTag]);

  // ── File handlers ────────────────────────────────────────────────────────────
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
          transcript: headers.find(h => lc(h).includes('transcript') || lc(h).includes('message')) || '',
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
    if (result.error) { setMetaError(result.error); setMetaMap({}); setMetaRowCount(0); }
    else { setMetaMap(result.map); setMetaRowCount(result.rows); }
  };

  // ── Batch score ──────────────────────────────────────────────────────────────
  const runBatch = async () => {
    const baseRows: ParsedRow[] = isWint
      ? (rowLimit > 0 ? parsedRows.slice(0, rowLimit) : parsedRows)
      : (rowLimit > 0 ? rawRows.slice(0, rowLimit) : rawRows).map((r, i) => ({
          chatId: manualCols.chatId ? r[manualCols.chatId] : `row_${i + 1}`,
          agent: manualCols.agent ? r[manualCols.agent] : '',
          date: manualCols.date ? r[manualCols.date] : '',
          csat: manualCols.csat ? r[manualCols.csat] : '',
          transcript: manualCols.transcript ? r[manualCols.transcript] : '',
        }));

    const rows: ParsedRow[] = baseRows.map(r => {
      const meta = metaMap[r.chatId] || metaMap[String(Number(r.chatId))];
      if (!meta) return r;
      return { ...r, agent: meta.agent || r.agent, tags: meta.tags || '', csat: meta.csat || r.csat, date: meta.date || r.date };
    });

    if (!rows.length) return;
    setScoring(true); setBatchResults([]); setBatchErrors([]);
    const results: IQSScoreEntry[] = [];
    const errors: { row: number; chatId: string; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const chatId = row.chatId || `row_${i + 1}`;
      setProgressLabel(`${i + 1} / ${rows.length} — ${row.agent || chatId}`);
      setProgress(Math.round(((i + 1) / rows.length) * 100));
      if (!row.transcript.trim() || row.transcript === 'nan') {
        errors.push({ row: i + 1, chatId, error: 'Empty transcript' }); continue;
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

  const exportBatchCSV = () => {
    if (!batchResults.length) return;
    const headers = ['Chat ID', 'Agent', 'Date', 'CSAT', 'IQS', ...PARAM_ORDER.map(p => PARAM_NAMES[p]), 'Summary'];
    const rows = batchResults.map(e => [e.chatId, e.agentName, e.date || '', e.csat || '', e.iqs, ...PARAM_ORDER.map(p => e.scores[p] || ''), (e.summary || '').replace(/\n/g, ' ')]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `iqs_batch_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const totalToScore = rowLimit > 0 ? Math.min(rowLimit, isWint ? parsedRows.length : rawRows.length) : (isWint ? parsedRows.length : rawRows.length);
  const avgIqs = batchResults.length ? Math.round(batchResults.reduce((s, e) => s + e.iqs, 0) / batchResults.length) : 0;
  const maxParamFail = Math.max(...Object.values(paramFails), 1);

  const wintAgentPreview = useMemo(() => {
    if (!isWint || !parsedRows.length) return [];
    const map: Record<string, { count: number; csat: number[] }> = {};
    for (const r of parsedRows) {
      const a = r.agent || 'Unknown';
      if (!map[a]) map[a] = { count: 0, csat: [] };
      map[a].count++;
      if (r.csat) map[a].csat.push(Number(r.csat));
    }
    return Object.entries(map).map(([agent, d]) => ({
      agent, count: d.count,
      csatPct: d.csat.length ? Math.round(d.csat.filter(c => c === 5).length / d.csat.length * 100) : null,
    })).sort((a, b) => b.count - a.count);
  }, [isWint, parsedRows]);

  // ── Icons ────────────────────────────────────────────────────────────────────
  const icons = {
    performance: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2 12l3-4 3 2 3-5 3 3" /><rect x="1" y="1" width="14" height="14" rx="1.5" />
      </svg>
    ),
    log: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 6h6M5 8.5h4M5 11h3" />
      </svg>
    ),
    upload: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 10V3M5 6l3-3 3 3" /><path d="M2 12h12" />
      </svg>
    ),
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex bg-slate-100 font-sans antialiased overflow-hidden">
      {detailEntry && <ScoreDetail entry={detailEntry} onClose={() => setDetailEntry(null)} />}

      {/* ── Left Panel ── */}
      <aside className="w-56 shrink-0 bg-[#111827] flex flex-col h-full">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-white/10">
          <Link href="/" className="flex items-center gap-2 text-slate-400 hover:text-white transition mb-4 text-xs font-medium">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
            Back to chat
          </Link>
          <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/wint-logo.png" alt="Wint" width={64} height={22} className="object-contain block" />
          </div>
          <p className="text-slate-500 text-[10px] mt-1.5 font-semibold uppercase tracking-wider">Quality Intelligence</p>
        </div>

        {/* Nav */}
        <nav className="px-3 py-4 flex-1 space-y-1">
          <NavItem icon={icons.performance} label="Performance" active={tab === 'performance'} badge={agentStats.length || undefined}
            onClick={() => switchTab('performance')} />
          <NavItem icon={icons.log} label="Score Log" active={tab === 'log'} badge={totalStored || undefined}
            onClick={() => switchTab('log')} />
          <NavItem icon={icons.upload} label="Upload & Score" active={tab === 'upload'}
            onClick={() => switchTab('upload')} />
        </nav>

        {/* Footer stats */}
        {totalStored > 0 && (
          <div className="px-4 py-4 border-t border-white/10">
            <p className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider mb-2">All-time</p>
            <p className="text-white text-xl font-bold">{totalStored.toLocaleString()}</p>
            <p className="text-slate-500 text-[10px] mt-0.5">chats scored</p>
          </div>
        )}
      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* Top bar */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-gray-900">
              {tab === 'performance' ? 'Team Performance' : tab === 'log' ? 'Score Log' : 'Upload & Score'}
            </h1>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {tab === 'performance' && `${agentStats.length} agents · ${entries.length} chats`}
              {tab === 'log' && `${filteredEntries.length} of ${totalStored} total`}
              {tab === 'upload' && (fileName ? `${totalToScore} chats ready` : 'Drop a Wint CSV export to begin')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(tab === 'performance' || tab === 'log') && (
              <>
                <button onClick={loadScores} disabled={logsLoading}
                  className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:border-gray-400 disabled:opacity-40 transition font-medium">
                  {logsLoading ? 'Loading…' : '↻ Refresh'}
                </button>
                {tab === 'log' && (
                  <button onClick={exportAll} disabled={exporting || !logsLoaded}
                    className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-40 transition flex items-center gap-1.5">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                    Export {totalStored ? `(${totalStored})` : 'all'}
                  </button>
                )}
              </>
            )}
          </div>
        </header>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── PERFORMANCE TAB ── */}
          {tab === 'performance' && (
            <>
              {logsLoading && (
                <div className="flex items-center justify-center h-48">
                  <div className="flex items-center gap-3 text-gray-400">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
                      <path d="M8 2a6 6 0 1 0 6 6" />
                    </svg>
                    <span className="text-sm">Loading scores…</span>
                  </div>
                </div>
              )}

              {!logsLoading && agentStats.length === 0 && (
                <div className="flex flex-col items-center justify-center h-48 text-center">
                  <p className="text-gray-400 text-sm">No scored chats yet.</p>
                  <p className="text-xs text-gray-300 mt-1">Upload transcripts in the Upload & Score tab.</p>
                  <button onClick={() => setTab('upload')}
                    className="mt-4 text-xs px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">
                    Go to Upload →
                  </button>
                </div>
              )}

              {!logsLoading && agentStats.length > 0 && (
                <div className="space-y-6 max-w-5xl">
                  {/* KPI strip */}
                  {(() => {
                    const teamAvg = Math.round(entries.reduce((s, e) => s + e.iqs, 0) / (entries.length || 1));
                    const atRiskCount = entries.filter(e => e.iqs < 70).length;
                    const atRiskAgents = agentStats.filter(a => a.avgIqs < 70);
                    // top failing param
                    const topParam = PARAM_ORDER.map(p => ({ p, pct: paramFails[p] || 0 })).sort((a, b) => b.pct - a.pct)[0];
                    return (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          {[
                            { label: 'All-time Scored', value: totalStored.toLocaleString(), sub: `${entries.length} loaded` },
                            { label: 'Team Avg IQS', value: `${teamAvg}%`, color: iqsTheme(teamAvg).text },
                            { label: 'Agents Tracked', value: agentStats.length },
                            { label: 'At Risk (<70%)', value: atRiskCount, color: atRiskCount > 0 ? '#dc2626' : '#15803d' },
                          ].map(s => (
                            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{s.label}</p>
                              <p className="text-2xl font-bold mt-1" style={{ color: (s as any).color || '#111827' }}>{s.value}</p>
                              {(s as any).sub && <p className="text-[10px] text-gray-400 mt-0.5">{(s as any).sub}</p>}
                            </div>
                          ))}
                        </div>

                        {/* Attention needed banner */}
                        {(atRiskAgents.length > 0 || (topParam && topParam.pct >= 25)) && (
                          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                            <p className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-3">⚠ Needs Attention</p>
                            <div className="flex flex-wrap gap-4">
                              {atRiskAgents.length > 0 && (
                                <div>
                                  <p className="text-[11px] text-amber-700 font-semibold mb-1">Agents below 70% IQS</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {atRiskAgents.map(a => (
                                      <span key={a.agent} className="text-[11px] bg-red-100 text-red-700 font-semibold px-2.5 py-1 rounded-lg">
                                        {a.agent} — {a.avgIqs}%
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {topParam && topParam.pct >= 25 && (
                                <div>
                                  <p className="text-[11px] text-amber-700 font-semibold mb-1">Highest team failure</p>
                                  <span className="text-[11px] bg-orange-100 text-orange-700 font-semibold px-2.5 py-1 rounded-lg">
                                    {PARAM_NAMES[topParam.p]} — {topParam.pct}% failure rate
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Agent grid */}
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Agent Scorecards</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {agentStats.map(a => (
                        <AgentCard key={a.agent} stat={a} entries={entries} />
                      ))}
                    </div>
                  </div>

                  {/* Team params */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <p className="text-sm font-bold text-gray-900 mb-1">Team Parameter Breakdown</p>
                    <p className="text-xs text-gray-500 mb-4">Failure rate across all {entries.length} scored chats — sorted by severity</p>
                    <div className="space-y-3">
                      {[...PARAM_ORDER].sort((a, b) => (paramFails[b] || 0) - (paramFails[a] || 0)).map(p => {
                        const pct = paramFails[p] || 0;
                        const failCount = Math.round(pct / 100 * entries.length);
                        return (
                          <div key={p} className="flex items-center gap-3">
                            <span className="text-xs text-gray-700 w-44 shrink-0 truncate font-medium">{PARAM_NAMES[p]}</span>
                            <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                              <div className="rounded-full h-2.5 transition-all" style={{
                                width: `${pct}%`,
                                background: pct >= 40 ? '#ef4444' : pct >= 20 ? '#f97316' : '#22c55e'
                              }} />
                            </div>
                            <span className={`text-xs font-bold w-10 text-right tabular-nums ${pct >= 40 ? 'text-red-500' : pct >= 20 ? 'text-orange-500' : 'text-emerald-600'}`}>{pct}%</span>
                            <span className="text-[10px] text-gray-400 w-12 text-right">{failCount} chats</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── SCORE LOG TAB ── */}
          {tab === 'log' && (
            <div className="space-y-4 max-w-5xl">
              {/* Filters */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex flex-wrap items-end gap-4">
                  {/* Date chips */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Period</p>
                    <div className="flex items-center gap-1">
                      {(['today', '7d', '30d', 'all'] as const).map(r => (
                        <button key={r} onClick={() => setDateRange(r)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                            dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {r === 'today' ? 'Today' : r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'All time'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Agent */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Agent</p>
                    <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px]">
                      <option value="">All agents</option>
                      {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {/* IQS range */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">IQS Range</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={100} value={filterMin} onChange={e => setFilterMin(parseInt(e.target.value) || 0)}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                      <span className="text-gray-400 text-xs">–</span>
                      <input type="number" min={0} max={100} value={filterMax} onChange={e => setFilterMax(parseInt(e.target.value) || 100)}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                    </div>
                  </div>
                  {/* Tag */}
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Tag</p>
                    <input value={filterTag} onChange={e => setFilterTag(e.target.value)} placeholder="e.g. Repayment"
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 w-32 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                  </div>
                </div>
              </div>

              {logsLoading && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm animate-pulse">Loading…</div>
              )}

              {!logsLoading && filteredEntries.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
                  <p className="text-gray-400 text-sm">No chats match these filters.</p>
                </div>
              )}

              {!logsLoading && filteredEntries.length > 0 && (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Showing', value: filteredEntries.length },
                      { label: 'Avg IQS', value: `${Math.round(filteredEntries.reduce((s, e) => s + e.iqs, 0) / filteredEntries.length)}%`, color: iqsTheme(Math.round(filteredEntries.reduce((s, e) => s + e.iqs, 0) / filteredEntries.length)).text },
                      { label: 'Below 70%', value: filteredEntries.filter(e => e.iqs < 70).length, color: '#dc2626' },
                      { label: '≥ 90%', value: filteredEntries.filter(e => e.iqs >= 90).length, color: '#15803d' },
                    ].map(s => (
                      <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{s.label}</p>
                        <p className="text-2xl font-bold mt-0.5" style={{ color: (s as any).color || '#111827' }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/60">
                          {['Agent', 'Chat ID', 'IQS', 'Fails', 'CSAT', 'Tags', 'Date'].map(h => (
                            <th key={h} className="text-left px-4 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEntries.map((e, i) => {
                          const fails = PARAM_ORDER.filter(p => e.scores[p] === 'No');
                          return (
                            <tr key={i} className="border-b border-gray-50 hover:bg-emerald-50/40 cursor-pointer transition"
                              onClick={() => setDetailEntry(e)}>
                              <td className="px-4 py-3 font-semibold text-gray-900">{e.agentName || '—'}</td>
                              <td className="px-4 py-3"><ChatLink chatId={e.chatId} className="text-xs" /></td>
                              <td className="px-4 py-3"><IQSPill iqs={e.iqs} /></td>
                              <td className="px-4 py-3">
                                {fails.length === 0
                                  ? <span className="text-emerald-600 font-semibold text-xs">✓ Clean</span>
                                  : <span className="text-red-500 font-semibold text-xs">{fails.length} fail{fails.length > 1 ? 's' : ''}</span>}
                              </td>
                              <td className="px-4 py-3 text-gray-700 text-sm">
                                {e.csat === '5' ? '👍' : e.csat === '3' ? '😐' : e.csat === '1' ? '👎' : <span className="text-gray-400">—</span>}
                              </td>
                              <td className="px-4 py-3 text-gray-600 max-w-[100px] truncate text-xs">{e.tags || <span className="text-gray-300">—</span>}</td>
                              <td className="px-4 py-3 text-gray-600 whitespace-nowrap text-xs">{(e.date || e.scoredAt || '').slice(0, 10)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── UPLOAD TAB ── */}
          {tab === 'upload' && (
            <div className="space-y-5 max-w-3xl">
              {/* Drop zone */}
              <div onClick={() => fileRef.current?.click()}
                className={`rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition ${
                  fileName ? 'border-emerald-400/50 bg-emerald-50/60' : 'border-gray-200 bg-white hover:border-emerald-400/40 hover:bg-emerald-50/30'
                }`}>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
                {fileName ? (
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 text-emerald-700">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span className="font-bold text-sm">{fileName}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {isWint ? parsedRows.length : rawRows.length} rows
                      {isWint && <span className="ml-2 text-emerald-600 font-semibold">· Wint format detected ✓</span>}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">Click to change</p>
                  </div>
                ) : (
                  <>
                    <svg className="mx-auto mb-3 text-gray-300" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                    </svg>
                    <p className="text-sm font-semibold text-gray-700">Upload transcript CSV</p>
                    <p className="text-xs text-gray-400 mt-1">Supports Wint bulk export format · Click or drag & drop</p>
                  </>
                )}
              </div>

              {/* Metadata upload */}
              {(isWint ? parsedRows.length : rawRows.length) > 0 && !scoring && batchResults.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Metadata file <span className="text-gray-400 font-normal">(optional)</span></h2>
                      <p className="text-xs text-gray-400 mt-1">Excel/CSV with <strong className="text-gray-600">chat_id, agent_name, tags, csat</strong> — matched by chat_id to enrich scores</p>
                    </div>
                    <input ref={metaFileRef} type="file" accept=".csv,.xlsx,.xls,.ods" className="hidden" onChange={handleMetaFile} />
                    <button onClick={() => metaFileRef.current?.click()}
                      className="shrink-0 text-xs px-4 py-2 border border-gray-200 rounded-xl text-gray-600 hover:border-emerald-500 hover:text-emerald-600 transition font-semibold">
                      {metaFileName ? '↺ Change' : '+ Upload'}
                    </button>
                  </div>
                  {metaFileName && !metaError && (
                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl font-semibold">
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="2 8 6 12 14 4" /></svg>
                        {metaFileName}
                      </span>
                      <span className="text-xs text-gray-500">{Object.keys(metaMap).length} IDs · {metaRowCount} rows</span>
                    </div>
                  )}
                  {metaError && <p className="mt-2 text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{metaError}</p>}
                  {Object.keys(metaMap).length > 0 && (() => {
                    const total = isWint ? parsedRows.length : rawRows.length;
                    const matched = (isWint ? parsedRows : rawRows as any[]).filter((r: any) => {
                      const id = isWint ? r.chatId : (manualCols.chatId ? r[manualCols.chatId] : '');
                      return metaMap[id] || metaMap[String(Number(id))];
                    }).length;
                    return (
                      <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
                        <span className="font-bold">{matched} of {total}</span> transcripts matched
                        {matched < total && <span className="text-amber-600"> · {total - matched} will use transcript values</span>}
                      </p>
                    );
                  })()}
                </div>
              )}

              {/* Wint preview + score button */}
              {isWint && wintAgentPreview.length > 0 && !scoring && batchResults.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h2 className="text-sm font-bold text-gray-900">Ready to score</h2>
                      <p className="text-xs text-gray-400 mt-0.5">{parsedRows.length} chats · {wintAgentPreview.length} agents</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Limit (0 = all)</label>
                        <input type="number" min={0} value={rowLimit} onChange={e => setRowLimit(parseInt(e.target.value) || 0)}
                          className="w-20 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                      </div>
                      <button onClick={runBatch} disabled={scoring}
                        className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 disabled:opacity-50 transition">
                        Score {totalToScore} →
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {wintAgentPreview.map(({ agent, count, csatPct }) => {
                      const initials = agent.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                      return (
                        <div key={agent} className="flex items-center gap-2.5 bg-gray-50 rounded-xl px-3 py-2.5">
                          <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold flex items-center justify-center shrink-0">{initials}</div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{agent}</p>
                            <p className="text-[10px] text-gray-400">{count} chat{count !== 1 ? 's' : ''}
                              {csatPct !== null && <span className="ml-1 text-amber-500">{csatPct}% Good</span>}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Generic column mapper */}
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
                        <select value={manualCols[key]} onChange={e => setManualCols(c => ({ ...c, [key]: e.target.value }))}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
                          {!req && <option value="">(none)</option>}
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Limit (0 = all)</label>
                      <input type="number" min={0} value={rowLimit} onChange={e => setRowLimit(parseInt(e.target.value) || 0)}
                        className="w-24 text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none" />
                    </div>
                    <button onClick={runBatch} disabled={scoring || !manualCols.transcript}
                      className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 disabled:opacity-50 transition mt-4">
                      Score {totalToScore} →
                    </button>
                  </div>
                </div>
              )}

              {/* Progress */}
              {scoring && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-gray-600 font-medium">{progressLabel}</span>
                    <span className="text-sm font-bold text-emerald-600">{progress}%</span>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2.5">
                    <div className="bg-emerald-500 rounded-full h-2.5 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                  {batchResults.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2">{batchResults.length} scored · avg IQS: {avgIqs}%</p>
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
                    <button onClick={exportBatchCSV}
                      className="text-xs px-4 py-2 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">
                      Export CSV
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Scored', value: batchResults.length, color: '#111827' },
                      { label: 'Avg IQS', value: `${avgIqs}%`, color: iqsTheme(avgIqs).text },
                      { label: 'Below 70%', value: batchResults.filter(e => e.iqs < 70).length, color: '#dc2626' },
                      { label: '≥ 90%', value: batchResults.filter(e => e.iqs >= 90).length, color: '#15803d' },
                    ].map(s => (
                      <div key={s.label} className="bg-gray-50 rounded-2xl p-4 text-center">
                        <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">{s.label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          {['Agent', 'Chat ID', 'IQS', 'CSAT', 'Fails', 'Summary'].map(h => (
                            <th key={h} className="text-left py-2 px-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {batchResults.map((e, i) => {
                          const fails = PARAM_ORDER.filter(p => e.scores[p] === 'No');
                          return (
                            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition" onClick={() => setDetailEntry(e)}>
                              <td className="py-2.5 px-2 font-semibold text-gray-800">{e.agentName || '—'}</td>
                              <td className="py-2.5 px-2"><ChatLink chatId={e.chatId} className="text-xs" /></td>
                              <td className="py-2.5 px-2"><IQSPill iqs={e.iqs} /></td>
                              <td className="py-2.5 px-2 text-gray-500">
                                {e.csat === '5' ? '👍' : e.csat === '3' ? '😐' : e.csat === '1' ? '👎' : '—'}
                              </td>
                              <td className="py-2.5 px-2">
                                {fails.length > 0 ? <span className="text-red-500 font-semibold">{fails.length} ✗</span> : <span className="text-emerald-600">✓ Clean</span>}
                              </td>
                              <td className="py-2.5 px-2 text-gray-400 max-w-[180px] truncate hidden lg:table-cell">{e.summary}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {batchErrors.length > 0 && (
                    <details>
                      <summary className="text-xs text-red-500 cursor-pointer font-semibold">{batchErrors.length} failed</summary>
                      <div className="mt-2 space-y-1">
                        {batchErrors.map((e, i) => <p key={i} className="text-xs text-red-400">Row {e.row} ({e.chatId}): {e.error}</p>)}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
