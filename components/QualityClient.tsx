'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSScoreEntry, ParamScore } from '@/lib/quality';

const ALL_LOG_COLS: readonly string[] = ['Agent', 'Chat ID', 'Mobile', 'CSAT', 'FRT', 'Handoff', 'Resolution', 'Closure', 'IQS', 'Fails', 'Disposition', 'Sub-Disposition', 'Last Updated', 'Date'];

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogFilters {
  agent: string;
  minScore: number;
  maxScore: number;
  disposition: string;
  subDisposition: string;
  csat: string;
  type: string;
  dateRange: 'today' | 'yesterday' | '1w' | 'custom';
  dateFrom: string;
  dateTo: string;
  chatId: string;
}

const DEFAULT_FILTERS: LogFilters = {
  agent: '', minScore: 0, maxScore: 100,
  disposition: '', subDisposition: '', csat: '', type: '',
  dateRange: '1w', dateFrom: '', dateTo: '',
  chatId: '',
};

function buildParams(page: number, f: LogFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('page', String(page));
  if (f.agent)        p.set('agent', f.agent);
  if (f.minScore > 0) p.set('minScore', String(f.minScore));
  if (f.maxScore < 100) p.set('maxScore', String(f.maxScore));
  if (f.disposition)  p.set('tag', f.disposition);
  if (f.subDisposition) p.set('subTag', f.subDisposition);
  if (f.csat)         p.set('csat', f.csat);
  if (f.type)         p.set('type', f.type);
  if (f.chatId)       p.set('chatId', f.chatId);
  // Skip date range when searching by chat ID — find the chat regardless of period
  if (!f.chatId) {
    if (f.dateRange === 'today') {
      const d = new Date().toISOString().slice(0, 10);
      p.set('dateFrom', d); p.set('dateTo', d);
    } else if (f.dateRange === 'yesterday') {
      const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      p.set('dateFrom', d); p.set('dateTo', d);
    } else if (f.dateRange === '1w') {
      p.set('dateFrom', new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
      p.set('dateTo', new Date().toISOString().slice(0, 10));
    } else if (f.dateRange === 'custom') {
      if (f.dateFrom) p.set('dateFrom', f.dateFrom);
      if (f.dateTo)   p.set('dateTo', f.dateTo);
    }
  }
  return p;
}

interface WeeklyParamRow { key: string; label: string; total: number; params: Record<string, number>; }

interface AgentStat {
  agent: string; chats: number; avgIqs: number;
  minIqs: number; maxIqs: number; high: number; atRisk: number;
  avgFrt?: number | null;
  avgResolution?: number | null;
  avgClosure?: number | null;
  avgBotToTeam?: number | null;
  csatPct?: number | null;
  csatGood?: number;
  csatCbb?: number;
  csatBad?: number;
}

interface QualityClientProps {
  userRole?: string;
  userEmail?: string;
  selfAgentName?: string;
  initialAgent?: string;
  initialTab?: 'log';
}
interface ParsedRow {
  chatId: string; agent: string; date: string; csat: string; transcript: string; tags?: string; contactPhone?: string;
}
interface MetaRow { agent?: string; tags?: string; csat?: string; date?: string; }
type MetaMap = Record<string, MetaRow>;

interface SummaryMetrics {
  totalConvos: number; botConvos: number; agentConvos: number;
  overallCsat: number | null; botCsat: number | null; agentCsat: number | null;
  good: number; cbbBad: number; cbbBadPct: number;
  avgFrt: number | null; avgBotToTeam: number | null;
  slaPercent: number | null; slaThresholdSecs: number;
  avgResolution: number | null; avgClosure: number | null;
  avgIqs: number | null; iqsSampleSize: number; samplingPct: number;
}

// ── Duration formatter ────────────────────────────────────────────────────────
function fmtDuration(secs: number | undefined | null): string {
  if (secs == null || secs < 0) return '—';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Conversation type badge ───────────────────────────────────────────────────
function TypeBadge({ type }: { type?: string }) {
  if (type === 'bot') return <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700">Bot</span>;
  if (type === 'hybrid') return <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700">Hybrid</span>;
  return <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">Agent</span>;
}

// ── Summary stats bar ─────────────────────────────────────────────────────────
// Fix 5 — summary card click-to-filter
// Readability pass — portal palette: emerald green, warm neutrals, white. No rainbow section colors.
function SummaryBar({ s, onFilter }: { s: SummaryMetrics; onFilter?: (f: { filterCsat?: string; filterType?: string; sortByIqs?: boolean }) => void }) {
  // SLA value gets semantic color; all other values are dark for readability
  const slaValueColor = s.slaPercent == null ? '#374151'
    : s.slaPercent >= 80 ? '#166534'   // dark green
    : s.slaPercent >= 60 ? '#92400e'   // dark amber
    : '#991b1b';                        // dark red

  const groups = [
    {
      label: 'CSAT',
      items: [
        { key: 'Overall CSAT', value: s.overallCsat != null ? `${s.overallCsat}%` : '—' },
        { key: 'Bot CSAT',     value: s.botCsat    != null ? `${s.botCsat}%`    : '—' },
        { key: 'Agent CSAT',   value: s.agentCsat  != null ? `${s.agentCsat}%`  : '—' },
        { key: 'Good',         value: String(s.good),    sub: 'CSAT Good', onClick: () => onFilter?.({ filterCsat: '5' }) },
        { key: 'CBB + Bad',    value: String(s.cbbBad),  sub: `${s.cbbBadPct}% of total`,
          valueColor: s.cbbBad > 0 ? '#991b1b' : undefined },
      ],
    },
    {
      label: 'Volume',
      items: [
        { key: 'Total',  value: String(s.totalConvos) },
        { key: 'Bot',    value: String(s.botConvos),
          sub: s.totalConvos > 0 ? `${Math.round(s.botConvos / s.totalConvos * 100)}% of total` : '—',
          onClick: () => onFilter?.({ filterType: 'bot' }) },
        { key: 'Human',  value: String(s.agentConvos),
          sub: s.totalConvos > 0 ? `${Math.round(s.agentConvos / s.totalConvos * 100)}% of total` : '—',
          onClick: () => onFilter?.({ filterType: 'agent' }) },
      ],
    },
    {
      label: 'Timing',
      items: [
        { key: 'Handoff SLA', value: s.slaPercent != null ? `${s.slaPercent}%` : '—', valueColor: slaValueColor, sub: `bot→agent, target ≤${Math.round(s.slaThresholdSecs / 60)} min` },
        { key: 'Avg FRT',     value: fmtDuration(s.avgFrt) },
        { key: 'Avg Handoff', value: fmtDuration(s.avgBotToTeam), sub: 'bot → agent transfer' },
        { key: 'Resolution', value: fmtDuration(s.avgResolution) },
        { key: 'Closure',    value: fmtDuration(s.avgClosure) },
      ],
    },
    {
      label: 'IQS',
      items: [
        { key: 'Avg IQS',     value: s.avgIqs != null ? `${s.avgIqs}%` : '—', onClick: () => onFilter?.({ sortByIqs: true }) },
        { key: 'Sample Size', value: String(s.iqsSampleSize) },
        { key: 'Sampling %',  value: `${s.samplingPct}%` },
      ],
    },
  ];

  return (
    // Single card with horizontal sections separated by dividers — cleaner, less noise
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="grid grid-cols-4 divide-x divide-gray-100">
        {groups.map(g => (
          <div key={g.label} className="px-5 py-4">
            {/* Section label — portal green, readable size */}
            <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest mb-3">{g.label}</p>
            <div className="flex flex-col gap-3">
              {g.items.map(item => (
                <div
                  key={item.key}
                  className={(item as any).onClick ? 'cursor-pointer group' : ''}
                  onClick={(item as any).onClick}
                >
                  {/* Key label — bigger, darker, readable */}
                  <p className="text-[11px] font-semibold text-gray-500 mb-0.5 whitespace-nowrap group-hover:text-gray-700 transition-colors">
                    {item.key}
                  </p>
                  {/* Value — large, dark, tabular */}
                  <p className="text-[17px] font-bold leading-none tabular-nums" style={{ color: (item as any).valueColor || '#111827' }}>
                    {item.value}
                  </p>
                  {/* Sub-label — slightly muted but still legible */}
                  {(item as any).sub && (
                    <p className="text-[11px] text-gray-500 mt-0.5">{(item as any).sub}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

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
    const contactPhone = r.user_phone || r.contact_phone || r.phone || r.mobile || r.phone_number || '';
    return { chatId: r.chat_id || '', agent, date: (r.conversation_started || '').slice(0, 10), csat, transcript, contactPhone: contactPhone || undefined };
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

// ── Transcript bubble renderer ────────────────────────────────────────────────
const BOT_NAMES = new Set(['myra', 'bot', 'wint bot', 'wintbot']);
const CUSTOMER_LABELS = new Set(['user', 'customer', 'visitor']);

function TranscriptBubbles({ messages }: { messages: Array<{ sender: string; content: string; timestamp?: string }> }) {
  return (
    <div className="space-y-2 py-1">
      {messages.map((m, i) => {
        const senderLc = (m.sender || '').toLowerCase().trim();
        const isCustomer = CUSTOMER_LABELS.has(senderLc);
        const isBot = BOT_NAMES.has(senderLc);
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

        // Customer messages → LEFT (incoming)
        if (isCustomer) {
          return (
            <div key={i} className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-1">
                <span className="text-[9px] font-bold text-gray-500">U</span>
              </div>
              <div className="max-w-[78%]">
                <p className="text-[9px] font-semibold text-gray-400 mb-0.5">{m.sender}{timeStr && ` · ${timeStr}`}</p>
                <div className="bg-gray-100 text-gray-800 px-3.5 py-2 rounded-2xl rounded-tl-sm text-[12.5px] leading-relaxed">
                  {m.content}
                </div>
              </div>
            </div>
          );
        }

        // Bot → RIGHT (outgoing)
        if (isBot) {
          return (
            <div key={i} className="flex justify-end gap-2">
              <div className="max-w-[78%]">
                <p className="text-[9px] font-semibold text-violet-400 text-right mb-0.5 pr-1">{m.sender}{timeStr && ` · ${timeStr}`}</p>
                <div className="bg-violet-500 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-[12.5px] leading-relaxed">
                  {m.content}
                </div>
              </div>
            </div>
          );
        }

        // Human agent → RIGHT (outgoing)
        return (
          <div key={i} className="flex justify-end gap-2">
            <div className="max-w-[78%]">
              <p className="text-[9px] font-semibold text-emerald-600 text-right mb-0.5 pr-1">{m.sender}{timeStr && ` · ${timeStr}`}</p>
              <div className="bg-emerald-500 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-[12.5px] leading-relaxed">
                {m.content}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Date Range Picker ─────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function DateRangePicker({ from, to, onChange, onClose }: {
  from: string; to: string;
  onChange: (f: string, t: string) => void;
  onClose?: () => void;
}) {
  const initMonth = () => {
    const d = from ? new Date(from + 'T00:00:00') : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  };
  const [viewDate, setViewDate] = useState(initMonth);
  const [pendingFrom, setPendingFrom] = useState(from);
  const [step, setStep] = useState<'from' | 'to'>(from ? 'to' : 'from');
  const [hoverDate, setHoverDate] = useState('');

  const year  = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso    = new Date().toISOString().slice(0, 10);

  const toIso = (d: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  const handleDay = (d: number) => {
    const iso = toIso(d);
    if (step === 'from') {
      setPendingFrom(iso);
      setStep('to');
    } else {
      if (iso < pendingFrom) {
        setPendingFrom(iso);
      } else {
        onChange(pendingFrom, iso);
        onClose?.();
      }
    }
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const effectiveTo = step === 'to' && hoverDate >= pendingFrom ? hoverDate : to;

  return (
    <div className="p-3 w-[230px]">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setViewDate(new Date(year, month - 1, 1))}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2L4 6l4 4"/></svg>
        </button>
        <span className="text-xs font-semibold text-gray-700">{MONTH_NAMES[month]} {year}</span>
        <button onClick={() => setViewDate(new Date(year, month + 1, 1))}
          className="p-1 rounded-lg hover:bg-gray-100 text-gray-500 transition">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 2l4 4-4 4"/></svg>
        </button>
      </div>
      <p className="text-[10px] text-gray-400 text-center mb-1.5">
        {step === 'from' ? 'Click start date' : `From ${pendingFrom} — click end`}
      </p>
      <div className="grid grid-cols-7 mb-0.5">
        {DAY_NAMES.map(d => <div key={d} className="text-center text-[9px] text-gray-400 py-0.5">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const iso = toIso(d);
          const isFrom   = iso === pendingFrom;
          const isTo     = iso === effectiveTo && step !== 'from';
          const inRange  = pendingFrom && effectiveTo && iso > pendingFrom && iso < effectiveTo;
          const isDisabled = step === 'to' && iso < pendingFrom;
          return (
            <button key={i}
              onClick={() => !isDisabled && handleDay(d)}
              onMouseEnter={() => step === 'to' && setHoverDate(iso)}
              onMouseLeave={() => setHoverDate('')}
              className={`text-[11px] h-6 w-full rounded transition text-center leading-6 ${
                isFrom || isTo  ? 'bg-emerald-500 text-white font-bold' :
                inRange         ? 'bg-emerald-100 text-emerald-700' :
                isDisabled      ? 'text-gray-200 cursor-not-allowed' :
                iso === todayIso ? 'font-bold text-emerald-600 hover:bg-emerald-50' :
                'text-gray-700 hover:bg-gray-100'
              }`}>
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Score Detail Modal (split-pane: IQS analysis + transcript) ────────────────
function ScoreDetail({ entry, onClose, onEdit, userRole }: { entry: IQSScoreEntry; onClose: () => void; onEdit?: (e: IQSScoreEntry) => void; userRole?: string }) {
  const fails = PARAM_ORDER.filter(p => entry.scores[p] === 'No');
  const canEdit = userRole === 'quality' || userRole === 'admin';
  const [showTranscript, setShowTranscript] = useState(true);
  const [transcript, setTranscript] = useState<{ timedMessages?: any[]; rawTranscript?: string } | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');

  useEffect(() => {
    setTranscriptLoading(true);
    setTranscriptError('');
    fetch(`/api/quality/transcript?chatId=${encodeURIComponent(entry.chatId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.found) setTranscript({ timedMessages: d.timedMessages, rawTranscript: d.rawTranscript });
        else setTranscript({});
      })
      .catch(() => setTranscriptError('Failed to load transcript'))
      .finally(() => setTranscriptLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.chatId]);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className={`bg-white w-full sm:rounded-2xl max-h-[96vh] flex flex-col shadow-2xl transition-all ${showTranscript ? 'sm:max-w-5xl' : 'sm:max-w-3xl'}`}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4 rounded-t-2xl">
          <IQSRing iqs={entry.iqs} size={52} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-gray-900">{entry.agentName || 'Unknown Agent'}</p>
              {fails.length === 0
                ? <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Clean</span>
                : <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{fails.length} fail{fails.length > 1 ? 's' : ''}</span>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
              <ChatLink chatId={entry.chatId} className="text-xs" />
              <span>·</span><span>{entry.scoredAt?.slice(0, 10)}</span>
              {entry.csat && <><span>·</span><span className="font-medium">{entry.csat === '5' ? 'Good' : entry.csat === '3' ? 'CBB' : 'Bad'}</span></>}
              {entry.disposition && <><span>·</span><span className="text-gray-600 font-medium">{entry.disposition}</span></>}
              {entry.subDisposition && <><span>/</span><span className="text-gray-500">{entry.subDisposition}</span></>}
            </p>
            {entry.updatedBy && (
              <p className="text-[10px] text-amber-600 mt-0.5">
                Last edited by {entry.updatedBy.split('@')[0]} · {new Date(entry.updatedAt || '').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowTranscript(s => !s)}
              className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
              {showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
            {canEdit && onEdit && (
              <button onClick={() => onEdit(entry)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition">
                Override
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
            </button>
          </div>
        </div>

        {/* Split-pane body */}
        <div className={`flex-1 overflow-hidden flex min-h-0 ${showTranscript ? 'flex-row divide-x divide-gray-100' : ''}`}>
          {/* Left: IQS analysis */}
          <div className={`overflow-y-auto ${showTranscript ? 'w-[44%] shrink-0' : 'w-full'}`}>
            <div className="px-6 py-5 space-y-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Parameter Scores</p>
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
              {entry.summary && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Summary</p>
                  <p className="text-sm text-gray-700 bg-gray-50 rounded-xl px-4 py-3 leading-relaxed">{entry.summary}</p>
                </div>
              )}
              {entry.uncertainParameters && entry.uncertainParameters.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600 shrink-0"><circle cx="8" cy="8" r="7"/><path d="M8 5v3.5M8 11v.5" strokeLinecap="round"/></svg>
                    <p className="text-xs font-bold text-amber-800 uppercase tracking-wider">Needs QA Review</p>
                  </div>
                  <p className="text-[11px] text-amber-700 mb-3 leading-relaxed">
                    The scoring bot was uncertain about the following parameters. They have been scored NA (benefit of doubt) pending QA review.
                  </p>
                  <div className="space-y-2">
                    {entry.uncertainParameters.map((u, i) => (
                      <div key={i} className="bg-white rounded-lg px-3 py-2.5 border border-amber-100">
                        <p className="text-xs font-semibold text-gray-800 mb-0.5">{PARAM_NAMES[u.parameter] ?? u.parameter}</p>
                        <p className="text-[11px] text-gray-600 leading-relaxed">{u.question}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[10px] text-gray-300">Scored by {(entry.scoredBy || '').split('@')[0]} · {entry.provider}/{entry.model}</p>
            </div>
          </div>

          {/* Right: transcript */}
          {showTranscript && (
            <div className="flex-1 overflow-y-auto">
              <div className="px-6 py-5">
                {transcriptLoading && (
                  <div className="flex items-center justify-center py-12 text-gray-400 gap-2 text-sm">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6" /></svg>
                    Loading transcript…
                  </div>
                )}
                {transcriptError && <p className="text-sm text-red-500 text-center py-8">{transcriptError}</p>}
                {!transcriptLoading && !transcriptError && transcript !== null && (
                  <>
                    {transcript.timedMessages && transcript.timedMessages.length > 0 ? (
                      <>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-4">
                          {transcript.timedMessages.length} messages
                        </p>
                        <TranscriptBubbles messages={transcript.timedMessages} />
                      </>
                    ) : transcript.rawTranscript ? (
                      <>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Raw Transcript</p>
                        <pre className="text-[12px] text-gray-600 bg-gray-50 rounded-xl px-4 py-3 whitespace-pre-wrap leading-relaxed font-sans">{transcript.rawTranscript}</pre>
                      </>
                    ) : (
                      <div className="text-center py-12">
                        <p className="text-sm text-gray-400">No transcript saved for this chat.</p>
                        <p className="text-xs text-gray-300 mt-1">Transcripts are saved for new chats scored after this update.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Agent Report Modal ────────────────────────────────────────────────────────
function AgentReportModal({ stat, entries, paramFails, onClose, onFilterLog }: {
  stat: AgentStat;
  entries: IQSScoreEntry[];
  paramFails: Record<string, number>;
  onClose: () => void;
  onFilterLog: (f: { agent: string; minScore?: number; maxScore?: number }) => void;
}) {
  const agentEntries = entries.filter(e => (e.agentName || 'Unknown') === stat.agent);
  const t = iqsTheme(stat.avgIqs);

  // Prefer API-provided counts (computed over all filtered entries, not just the current page)
  const csatGood  = stat.csatGood  ?? agentEntries.filter(e => e.csat === '5').length;
  const csatCbb   = stat.csatCbb   ?? agentEntries.filter(e => e.csat === '3').length;
  const csatBad   = stat.csatBad   ?? agentEntries.filter(e => e.csat === '1').length;
  const csatTotal = csatGood + csatCbb + csatBad;

  const dispMap: Record<string, number> = {};
  for (const e of agentEntries) if (e.disposition) dispMap[e.disposition] = (dispMap[e.disposition] || 0) + 1;
  const topDisp = Object.entries(dispMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const subDispMap: Record<string, number> = {};
  for (const e of agentEntries) if (e.subDisposition) subDispMap[e.subDisposition] = (subDispMap[e.subDisposition] || 0) + 1;
  const topSubDisp = Object.entries(subDispMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const paramData = PARAM_ORDER.map(p => {
    const fails = agentEntries.filter(e => e.scores[p] === 'No').length;
    return { p, failPct: agentEntries.length ? Math.round(fails / agentEntries.length * 100) : 0 };
  }).sort((a, b) => b.failPct - a.failPct);
  const worstParams = paramData.filter(d => d.failPct > 0).slice(0, 4);
  const bestParams  = [...paramData].sort((a, b) => a.failPct - b.failPct).slice(0, 3);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center gap-4 rounded-t-2xl">
          <IQSRing iqs={stat.avgIqs} size={52} />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-lg">{stat.agent}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{stat.chats} chats · IQS range {stat.minIqs}–{stat.maxIqs}%</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Avg IQS', value: `${stat.avgIqs}%`, color: t.text },
              { label: 'CSAT Good', value: stat.csatPct != null ? `${stat.csatPct}%` : '—', color: (stat.csatPct ?? 0) >= 80 ? 'text-emerald-600' : (stat.csatPct ?? 0) >= 60 ? 'text-amber-600' : 'text-red-500' },
              { label: 'Avg FRT', value: fmtDuration(stat.avgFrt ?? null), color: 'text-gray-800' },
              { label: 'Avg Resolution', value: fmtDuration(stat.avgResolution ?? null), color: 'text-gray-800' },
            ].map(k => (
              <div key={k.label} className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* CSAT breakdown */}
          {csatTotal > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">CSAT Breakdown</p>
              <div className="flex gap-3">
                {[['Good', csatGood, 'bg-emerald-100 text-emerald-700'], ['CBB', csatCbb, 'bg-amber-100 text-amber-700'], ['Bad', csatBad, 'bg-red-100 text-red-700']].map(([label, count, cls]) => (
                  <div key={String(label)} className={`flex-1 rounded-xl px-3 py-2 text-center ${cls}`}>
                    <p className="text-lg font-bold">{count}</p>
                    <p className="text-[10px] font-semibold uppercase">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Worst parameters */}
          {worstParams.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Worst Parameters</p>
              <div className="space-y-1.5">
                {worstParams.map(d => (
                  <div key={d.p} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 w-32 shrink-0">{PARAM_NAMES[d.p] || d.p}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-red-400" style={{ width: `${d.failPct}%` }} />
                    </div>
                    <span className="text-xs font-bold text-red-600 w-10 text-right">{d.failPct}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Best parameters */}
          {bestParams.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Best Parameters</p>
              <div className="flex gap-2 flex-wrap">
                {bestParams.map(d => (
                  <span key={d.p} className="text-xs font-semibold bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full">
                    {PARAM_NAMES[d.p] || d.p} {d.failPct === 0 ? '✓' : `${100 - d.failPct}%`}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Disposition breakdown */}
          {topDisp.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Top Dispositions</p>
              <div className="space-y-1">
                {topDisp.map(([d, n]) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 flex-1 truncate">{d}</span>
                    <div className="w-24 bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${Math.round(n / agentEntries.length * 100)}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-6 text-right">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sub-disposition breakdown */}
          {topSubDisp.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Struggled With (Sub-Disposition)</p>
              <div className="space-y-1">
                {topSubDisp.map(([d, n]) => (
                  <div key={d} className="flex items-center gap-3">
                    <span className="text-xs text-gray-700 flex-1 truncate">{d}</span>
                    <span className="text-xs text-gray-500 ml-auto">{n} chats</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button onClick={() => { onFilterLog({ agent: stat.agent }); onClose(); }}
              className="flex-1 text-xs px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition">
              View All Chats →
            </button>
            <button onClick={() => { onFilterLog({ agent: stat.agent, maxScore: 69 }); onClose(); }}
              className="flex-1 text-xs px-4 py-2.5 border border-red-200 text-red-600 bg-red-50 rounded-xl font-bold hover:bg-red-100 transition">
              At-Risk Chats Only
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent Card ────────────────────────────────────────────────────────────────
function AgentCard({
  stat,
  entries,
  teamParamFails,
  onFilterLog,
  onViewReport,
}: {
  stat: AgentStat;
  entries: IQSScoreEntry[];
  teamParamFails?: Record<string, number>;
  onFilterLog?: (f: { agent: string; minScore?: number; maxScore?: number }) => void;
  onViewReport?: (stat: AgentStat) => void;
}) {
  const t = iqsTheme(stat.avgIqs);
  // normalise empty agentName → 'Unknown' so it matches stat.agent
  const agentEntries = entries.filter(e => (e.agentName || 'Unknown') === stat.agent);

  const paramData = useMemo(() => PARAM_ORDER.map(p => {
    const n = agentEntries.filter(e => e.scores[p] === 'No').length;
    return { p, failPct: agentEntries.length ? Math.round(n / agentEntries.length * 100) : 0 };
  }).sort((a, b) => b.failPct - a.failPct), [agentEntries]);

  const topFails = paramData.filter(d => d.failPct > 0).slice(0, 4);
  const isAtRisk = stat.avgIqs < 70;

  return (
    <div className={`bg-white rounded-2xl shadow-sm overflow-hidden border ${isAtRisk ? 'border-red-200' : 'border-gray-100'}`}>
      {/* Card header — click to open full report */}
      <div
        className={`px-5 pt-5 pb-4 ${isAtRisk ? 'bg-red-50/40' : ''} ${onViewReport ? 'cursor-pointer hover:bg-gray-50/60 transition' : ''}`}
        onClick={() => onViewReport?.(stat)}
      >
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
            {/* Fix 10 — clickable stat badges */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {stat.high > 0 && (
                <button
                  className="text-[10px] bg-emerald-50 text-emerald-700 font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80"
                  onClick={() => onFilterLog?.({ agent: stat.agent, minScore: 90 })}
                >
                  {stat.high} excellent
                </button>
              )}
              {stat.atRisk > 0 && (
                <button
                  className="text-[10px] bg-red-50 text-red-600 font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80"
                  onClick={() => onFilterLog?.({ agent: stat.agent, maxScore: 69 })}
                >
                  {stat.atRisk} need review
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Coaching focus — clean percentage pills, no bars */}
      <div className="border-t border-gray-100 bg-gray-50/40 px-5 py-3.5">
        {topFails.length === 0 ? (
          <p className="text-xs text-emerald-600 font-semibold text-center py-1">✓ No consistent failure areas</p>
        ) : (
          <>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2.5">Coaching Focus</p>
            <div className="space-y-1.5">
              {topFails.map(({ p, failPct }) => {
                const teamPct = teamParamFails ? (teamParamFails[p] || 0) : 0;
                const isHigh = failPct >= 40;
                const isAboveTeam = failPct > teamPct && !isHigh;
                return (
                  <div key={p} className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] text-gray-600 truncate">{PARAM_NAMES[p]}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isAboveTeam && <span className="text-[9px] text-amber-500 font-semibold">↑ team</span>}
                      <span className={`text-[12px] font-bold tabular-nums ${isHigh ? 'text-red-500' : isAboveTeam ? 'text-amber-500' : 'text-gray-500'}`}>
                        {failPct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
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
// ── Flag Thread / Pending Review types ───────────────────────────────────────
interface IQSFlagData {
  id: string; scoreId: string; chatId: string; agentName: string; agentEmail: string;
  agentNote: string; challengedParams?: { param: string; note: string }[];
  flaggedAt: string; status: 'pending' | 'reviewed';
  reviewedBy?: string; reviewedAt?: string; reviewNote?: string;
}
interface IQSFlagComment {
  id: string; flagId: string; authorEmail: string; authorName: string;
  role: string; content: string; createdAt: string;
}
interface PendingReviewItem {
  chatId: string; agentName: string; iqs: number; scoredAt: string; date: string;
  flag?: IQSFlagData | null;
  qaStatus?: { reviewedBy: string; reviewedAt: string; reviewNote: string } | null;
}

function PendingChatsTab({ userRole, userEmail }: { userRole?: string; userEmail?: string }) {
  const [filter, setFilter] = useState<'all' | 'challenged'>('all');
  const [chatIdSearch, setChatIdSearch] = useState('');
  const [section, setSection] = useState<'pending' | 'reviewed'>('pending');
  const [items, setItems] = useState<PendingReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, IQSFlagComment[]>>({});
  const [threadLoading, setThreadLoading] = useState<Record<string, boolean>>({});
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [replySending, setReplySending] = useState<Record<string, boolean>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState<Record<string, boolean>>({});
  const [transcripts, setTranscripts] = useState<Record<string, { timedMessages?: any[]; rawTranscript?: string } | null>>({});
  const [transcriptLoading, setTranscriptLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    fetch('/api/quality/pending-review')
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => setLoadError('Failed to load pending chats'))
      .finally(() => setLoading(false));
  }, []);

  const loadThread = async (flagId: string) => {
    if (threads[flagId] !== undefined) return;
    setThreadLoading(t => ({ ...t, [flagId]: true }));
    try {
      const d = await fetch(`/api/quality/flag-thread?flagId=${encodeURIComponent(flagId)}`).then(r => r.json());
      setThreads(t => ({ ...t, [flagId]: d.comments || [] }));
    } catch {}
    setThreadLoading(t => ({ ...t, [flagId]: false }));
  };

  const loadTranscript = async (chatId: string) => {
    if (transcripts[chatId] !== undefined) return;
    setTranscriptLoading(t => ({ ...t, [chatId]: true }));
    try {
      const d = await fetch(`/api/quality/transcript?chatId=${encodeURIComponent(chatId)}`).then(r => r.json());
      setTranscripts(t => ({ ...t, [chatId]: d.found ? { timedMessages: d.timedMessages, rawTranscript: d.rawTranscript } : {} }));
    } catch {
      setTranscripts(t => ({ ...t, [chatId]: {} }));
    }
    setTranscriptLoading(t => ({ ...t, [chatId]: false }));
  };

  const expand = (chatId: string, flagId?: string) => {
    if (expandedId === chatId) { setExpandedId(null); return; }
    setExpandedId(chatId);
    loadTranscript(chatId);
    if (flagId) loadThread(flagId);
  };

  const sendReply = async (flagId: string) => {
    const text = (replyText[flagId] || '').trim();
    if (!text) return;
    setReplySending(s => ({ ...s, [flagId]: true }));
    try {
      const d = await fetch('/api/quality/flag-thread', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flagId, content: text }),
      }).then(r => r.json());
      if (d.comment) {
        setThreads(t => ({ ...t, [flagId]: [...(t[flagId] || []), d.comment] }));
        setReplyText(r => ({ ...r, [flagId]: '' }));
      }
    } catch {}
    setReplySending(s => ({ ...s, [flagId]: false }));
  };

  const markReviewed = async (chatId: string) => {
    setReviewing(r => ({ ...r, [chatId]: true }));
    try {
      await fetch('/api/quality/pending-review', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, reviewNote: reviewNotes[chatId] || '' }),
      });
      const now = new Date().toISOString();
      setItems(prev => prev.map(item =>
        item.chatId === chatId
          ? { ...item, qaStatus: { reviewedBy: userEmail || '', reviewedAt: now, reviewNote: reviewNotes[chatId] || '' } }
          : item
      ));
    } catch {}
    setReviewing(r => ({ ...r, [chatId]: false }));
  };

  const canReview = ['quality', 'admin', 'tl'].includes(userRole || '');

  // Derived filtered + sectioned lists
  let filtered = items;
  if (filter === 'challenged') filtered = filtered.filter(i => !!i.flag && i.flag.status === 'pending');
  if (chatIdSearch) filtered = filtered.filter(i => i.chatId.toLowerCase().includes(chatIdSearch.toLowerCase()));
  const pendingItems  = filtered.filter(i => !i.qaStatus).sort((a, b) => new Date(b.scoredAt).getTime() - new Date(a.scoredAt).getTime());
  const reviewedItems = filtered.filter(i => !!i.qaStatus).sort((a, b) => new Date(b.qaStatus!.reviewedAt).getTime() - new Date(a.qaStatus!.reviewedAt).getTime());
  const challengedCount = items.filter(i => i.flag?.status === 'pending').length;

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400 gap-2 text-sm">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
      Loading…
    </div>
  );
  if (loadError) return <p className="text-sm text-red-500 text-center py-12">{loadError}</p>;

  const renderItem = (item: PendingReviewItem) => {
    const isExpanded  = expandedId === item.chatId;
    const isReviewed  = !!item.qaStatus;
    const hasFlag     = !!item.flag && item.flag.status === 'pending';
    const flagId      = item.flag?.id;
    const thread      = flagId ? (threads[flagId] || []) : [];
    const txData      = transcripts[item.chatId];

    return (
      <div key={item.chatId} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition ${
        hasFlag ? 'border-blue-200' : isReviewed ? 'border-gray-100' : 'border-amber-200'
      }`}>
        {/* Row header */}
        <div className="px-5 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50/40 transition"
          onClick={() => expand(item.chatId, flagId)}>
          <IQSRing iqs={item.iqs} size={40} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-800">{item.agentName || 'Unknown'}</span>
              <ChatLink chatId={item.chatId} className="text-xs" />
              {hasFlag && <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">Challenged</span>}
              {isReviewed
                ? <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">Reviewed</span>
                : <span className="text-[10px] font-bold bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full">Pending</span>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {item.date || item.scoredAt?.slice(0, 10)}
              {isReviewed && item.qaStatus?.reviewedAt && ` · Reviewed ${new Date(item.qaStatus.reviewedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}><path d="M2 4l4 4 4-4"/></svg>
        </div>

        {/* Expanded: challenge details + transcript side-by-side */}
        {isExpanded && (
          <div className="border-t border-gray-100 flex divide-x divide-gray-100" style={{ minHeight: 180, maxHeight: 480 }}>
            {/* Left: challenge info + review action */}
            <div className="w-[38%] shrink-0 overflow-y-auto p-4 space-y-3">
              {item.flag && (
                <div>
                  <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-2">IR Challenge</p>
                  {item.flag.challengedParams && item.flag.challengedParams.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {item.flag.challengedParams.map(cp => (
                        <div key={cp.param}>
                          <span className="text-xs font-semibold text-gray-700">{PARAM_NAMES[cp.param] || cp.param}</span>
                          {cp.note && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{cp.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                  {item.flag.agentNote && (
                    <p className="text-xs text-gray-600 bg-blue-50 rounded-xl px-3 py-2 leading-relaxed mb-2">{item.flag.agentNote}</p>
                  )}
                  {/* Thread */}
                  {threadLoading[flagId!] && <p className="text-xs text-gray-400">Loading…</p>}
                  {thread.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {thread.map(c => {
                        const isQa = ['quality','admin','tl'].includes(c.role);
                        return (
                          <div key={c.id} className={`flex gap-1.5 ${isQa ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[8px] font-bold ${isQa ? 'bg-emerald-200 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>{c.authorName.slice(0,1).toUpperCase()}</div>
                            <div className="max-w-[85%]">
                              <p className={`text-[9px] font-semibold mb-0.5 ${isQa ? 'text-right text-emerald-600' : 'text-gray-400'}`}>{c.authorName}</p>
                              <div className={`px-2.5 py-1.5 rounded-xl text-[11px] leading-relaxed ${isQa ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-800'}`}>{c.content}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {flagId && (
                    <div className="flex gap-1.5 mb-1">
                      <input type="text" value={replyText[flagId] || ''}
                        onChange={e => setReplyText(r => ({ ...r, [flagId!]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(flagId); } }}
                        placeholder="Reply to challenge…" className="flex-1 text-xs border border-gray-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                      <button onClick={() => sendReply(flagId)} disabled={replySending[flagId] || !replyText[flagId]?.trim()}
                        className="px-2.5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">{replySending[flagId] ? '…' : 'Send'}</button>
                    </div>
                  )}
                </div>
              )}
              {/* Review action */}
              {canReview && !isReviewed && (
                <div className="border-t border-gray-100 pt-3">
                  <input type="text" value={reviewNotes[item.chatId] || ''} onChange={e => setReviewNotes(r => ({ ...r, [item.chatId]: e.target.value }))}
                    placeholder="Review note (optional)…" className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400/30 mb-2" />
                  <button onClick={() => markReviewed(item.chatId)} disabled={reviewing[item.chatId]}
                    className="w-full px-3 py-2 bg-amber-500 text-white text-xs font-bold rounded-xl hover:bg-amber-600 disabled:opacity-40 transition">
                    {reviewing[item.chatId] ? '…' : 'Mark Reviewed'}
                  </button>
                </div>
              )}
              {isReviewed && (
                <div className="border-t border-gray-100 pt-3 text-center">
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
                    ✓ Reviewed by {(item.qaStatus?.reviewedBy || '').split('@')[0]}
                  </span>
                  {item.qaStatus?.reviewNote && <p className="text-xs text-gray-500 mt-2">{item.qaStatus.reviewNote}</p>}
                </div>
              )}
            </div>

            {/* Right: transcript */}
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Transcript</p>
              {transcriptLoading[item.chatId] && (
                <div className="flex items-center gap-2 text-gray-400 text-xs justify-center py-8">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6"/></svg>
                  Loading…
                </div>
              )}
              {txData && txData.timedMessages && txData.timedMessages.length > 0 && (
                <TranscriptBubbles messages={txData.timedMessages} />
              )}
              {txData && txData.rawTranscript && !txData.timedMessages?.length && (
                <pre className="text-[11px] text-gray-600 bg-gray-50 rounded-xl px-3 py-2 whitespace-pre-wrap leading-relaxed font-sans">{txData.rawTranscript}</pre>
              )}
              {txData && !txData.timedMessages?.length && !txData.rawTranscript && !transcriptLoading[item.chatId] && (
                <p className="text-xs text-gray-400 text-center py-6">No transcript saved for this chat.</p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const displayItems = section === 'pending' ? pendingItems : reviewedItems;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Header row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px]">
          <h2 className="text-sm font-bold text-gray-900">Chats Pending Review</h2>
          <p className="text-xs text-gray-400 mt-0.5">IQS &lt; 80% — scoped to your agents</p>
        </div>
        {/* All / Challenged filter */}
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          <button onClick={() => setFilter('all')}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            All Low IQS
          </button>
          <button onClick={() => setFilter('challenged')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${filter === 'challenged' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Challenged
            {challengedCount > 0 && <span className="bg-blue-100 text-blue-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{challengedCount}</span>}
          </button>
        </div>
        {/* Pending / Reviewed section */}
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          <button onClick={() => setSection('pending')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${section === 'pending' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Pending
            {pendingItems.length > 0 && <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{pendingItems.length}</span>}
          </button>
          <button onClick={() => setSection('reviewed')}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition ${section === 'reviewed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Reviewed
            {reviewedItems.length > 0 && <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{reviewedItems.length}</span>}
          </button>
        </div>
        {/* Chat ID search */}
        <input type="text" value={chatIdSearch} onChange={e => setChatIdSearch(e.target.value)}
          placeholder="Filter by Chat ID…"
          className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 w-40 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
      </div>

      {/* Items */}
      {displayItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-14 text-center">
          <p className="text-2xl mb-2">{section === 'pending' ? '✓' : '📋'}</p>
          <p className="text-sm font-semibold text-gray-700">{section === 'pending' ? 'All caught up' : 'No reviewed chats yet'}</p>
          <p className="text-xs text-gray-400 mt-1">{section === 'pending' ? 'No chats pending review for your agents.' : 'Mark some chats as reviewed to see them here.'}</p>
        </div>
      ) : (
        <div className="space-y-3">{displayItems.map(renderItem)}</div>
      )}
    </div>
  );
}

export default function QualityClient({ userRole, userEmail, selfAgentName: selfAgentNameProp, initialAgent, initialTab }: QualityClientProps = {}) {
  const [tab, setTab] = useState<'performance' | 'log' | 'upload' | 'reports' | 'pending'>(initialTab || 'performance');
  const [challengeCount, setChallengeCount] = useState(0);

  // Fresh agentName from config (overrides stale JWT value)
  const [selfAgentName, setSelfAgentName] = useState(selfAgentNameProp);
  useEffect(() => {
    // Only restrict view for agent role — admin/quality/tl see all agents
    fetch('/api/users/me')
      .then(r => r.json())
      .then(d => { if (d.agentName !== undefined && d.role === 'agent') setSelfAgentName(d.agentName || undefined); })
      .catch(() => {});
  }, []);

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
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsDebug, setLogsDebug] = useState<Record<string, any> | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Filter state (pending = UI inputs; applied = what was last fetched) ────────
  const [pendingFilters, setPendingFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [logPage, setLogPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalFiltered, setTotalFiltered] = useState(0);

  // ── Reports tab — independent filter state ───────────────────────────────
  const [reportFilters, setReportFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [reportTotalFiltered, setReportTotalFiltered] = useState<number | null>(null);
  const [reportCountLoading, setReportCountLoading] = useState(false);

  // Server-provided lookup data
  const [availableDispositions, setAvailableDispositions] = useState<string[]>([]);
  const [availableSubDispositions, setAvailableSubDispositions] = useState<string[]>([]);
  const [weeklyParamData, setWeeklyParamData] = useState<WeeklyParamRow[]>([]);

  const [detailEntry, setDetailEntry] = useState<IQSScoreEntry | null>(null);

  // Column visibility
  const [showColPicker, setShowColPicker] = useState(false);
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [forcedVisibleCols, setForcedVisibleCols] = useState<Set<string>>(new Set());

  // Sortable columns
  const [sortCol, setSortCol] = useState<'iqs' | 'fails' | 'date' | 'csat' | 'frt' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Performance tab — independent period state (decoupled from Score Log)
  const [perfPeriod, setPerfPeriod] = useState<'today'|'yesterday'|'1w'|'custom'>('1w');
  const [perfDateFrom, setPerfDateFrom] = useState('');
  const [perfDateTo, setPerfDateTo] = useState('');
  const [showPerfPicker, setShowPerfPicker] = useState(false);
  const [perfTotal, setPerfTotal] = useState(0);
  const perfAbortRef = useRef<AbortController | null>(null);

  // Agent analytics table sort
  const [sortAgentCol, setSortAgentCol] = useState<string>('avgIqs');
  const [sortAgentDir, setSortAgentDir] = useState<'asc'|'desc'>('asc');

  // Score Log — filter panel toggle + needs-review filter
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showOnlyNeedsReview, setShowOnlyNeedsReview] = useState(false);

  // Score Log / Reports custom date picker visibility
  const [showLogPicker, setShowLogPicker] = useState(false);
  const [showReportPicker, setShowReportPicker] = useState(false);

  // Agent timing analytics pagination
  const [agentPage, setAgentPage] = useState(0);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAllWeeks, setShowAllWeeks] = useState(false);

  // Edit/override modal
  const [editEntry, setEditEntry] = useState<IQSScoreEntry | null>(null);
  const [editForm, setEditForm] = useState<{
    agentName: string; csat: string; disposition: string; subDisposition: string;
    summary: string; scores: Record<string, string>; reasoning: Record<string, string>; note: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editSaved, setEditSaved] = useState(false);

  // Agent report modal
  const [agentReportStat, setAgentReportStat] = useState<AgentStat | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Batch scoring (admin)
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ scored: number; errors: number; remaining: number } | null>(null);
  const [sheetBackfilling, setSheetBackfilling] = useState(false);
  const [sheetBackfillResult, setSheetBackfillResult] = useState<{ sent: number; total: number } | null>(null);

  // ── Column visibility derived ────────────────────────────────────────────────
  const autoHiddenLogCols = useMemo(() => {
    const hidden = new Set<string>();
    if (!entries.some(e => e.frt != null)) hidden.add('FRT');
    if (!entries.some(e => e.botToTeamSecs != null)) hidden.add('Handoff');
    if (!entries.some(e => e.resolutionTime != null)) hidden.add('Resolution');
    if (!entries.some(e => e.closureTime != null)) hidden.add('Closure');
    if (!entries.some(e => e.csat)) hidden.add('CSAT');
    if (!entries.some(e => e.disposition)) hidden.add('Disposition');
    if (!entries.some(e => e.subDisposition)) hidden.add('Sub-Disposition');
    if (!entries.some(e => (e as any).mobileNumber)) hidden.add('Mobile');
    return hidden;
  }, [entries]);

  const visibleLogCols = useMemo(() => {
    return ALL_LOG_COLS.filter(col =>
      !hiddenCols.has(col) && (!autoHiddenLogCols.has(col) || forcedVisibleCols.has(col))
    );
  }, [hiddenCols, autoHiddenLogCols, forcedVisibleCols]);

  const sortedLogEntries = useMemo(() => {
    if (!sortCol) return entries;
    return [...entries].sort((a, b) => {
      let aVal: number, bVal: number;
      if (sortCol === 'iqs') { aVal = a.iqs; bVal = b.iqs; }
      else if (sortCol === 'fails') {
        aVal = PARAM_ORDER.filter(p => a.scores[p] === 'No').length;
        bVal = PARAM_ORDER.filter(p => b.scores[p] === 'No').length;
      } else if (sortCol === 'date') {
        aVal = new Date(a.scoredAt || a.date || '').getTime();
        bVal = new Date(b.scoredAt || b.date || '').getTime();
      } else if (sortCol === 'csat') {
        aVal = parseInt(a.csat || '0') || 0;
        bVal = parseInt(b.csat || '0') || 0;
      } else {
        aVal = a.frt ?? 999999;
        bVal = b.frt ?? 999999;
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [entries, sortCol, sortDir]);

  // Apply client-side needs-review filter on top of server-filtered entries
  const chatIdFilteredLogEntries = useMemo(() =>
    showOnlyNeedsReview
      ? sortedLogEntries.filter(e => e.uncertainParameters && e.uncertainParameters.length > 0)
      : sortedLogEntries,
  [sortedLogEntries, showOnlyNeedsReview]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (appliedFilters.chatId) n++;
    if (appliedFilters.dateRange !== '1w') n++;
    if (appliedFilters.agent && appliedFilters.agent !== selfAgentName) n++;
    if (appliedFilters.csat) n++;
    if (appliedFilters.minScore > 0 || appliedFilters.maxScore < 100) n++;
    if (appliedFilters.disposition) n++;
    if (appliedFilters.subDisposition) n++;
    return n;
  }, [appliedFilters, selfAgentName]);

  // Sorted agent analytics table
  const sortedAgentStats = useMemo(() => {
    const arr = [...agentStats];
    arr.sort((a, b) => {
      if (sortAgentCol === 'agent') {
        return sortAgentDir === 'asc' ? a.agent.localeCompare(b.agent) : b.agent.localeCompare(a.agent);
      }
      let aVal: number, bVal: number;
      if (sortAgentCol === 'chats')         { aVal = a.chats;         bVal = b.chats; }
      else if (sortAgentCol === 'avgIqs')   { aVal = a.avgIqs;        bVal = b.avgIqs; }
      else if (sortAgentCol === 'avgFrt')   { aVal = a.avgFrt ?? 999999;       bVal = b.avgFrt ?? 999999; }
      else if (sortAgentCol === 'avgResolution') { aVal = a.avgResolution ?? 999999; bVal = b.avgResolution ?? 999999; }
      else if (sortAgentCol === 'csatPct')  { aVal = a.csatPct ?? -1; bVal = b.csatPct ?? -1; }
      else { // atRiskPct
        aVal = a.chats > 0 ? a.atRisk / a.chats : 0;
        bVal = b.chats > 0 ? b.atRisk / b.chats : 0;
      }
      return sortAgentDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return arr;
  }, [agentStats, sortAgentCol, sortAgentDir]);

  // ── Performance data — independent of Score Log filters ────────────────────
  const loadPerfData = useCallback(async (period: 'today'|'yesterday'|'1w'|'custom', customFrom = '', customTo = '') => {
    perfAbortRef.current?.abort();
    const controller = new AbortController();
    perfAbortRef.current = controller;
    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    let dateFrom = '', dateTo = '';
    if (period === 'today')     { dateFrom = today;      dateTo = today; }
    else if (period === 'yesterday') { dateFrom = yesterday;  dateTo = yesterday; }
    else if (period === '1w')   { dateFrom = new Date(Date.now() - 6*86400_000).toISOString().slice(0, 10); dateTo = today; }
    else if (period === 'custom') { dateFrom = customFrom; dateTo = customTo; }
    const params = new URLSearchParams({ page: '0' });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);
    try {
      const resp = await fetch(`/api/quality/scores?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const data = await resp.json();
      if (controller.signal.aborted || !resp.ok) return;
      setAgentStats(data.agentStats || []);
      setParamFails(data.paramFails || {});
      setWeeklyParamData(data.weeklyParamData || []);
      if (data.summary) setSummary(data.summary);
      setPerfTotal(data.total ?? 0);
      setTotalStored(data.totalStored ?? 0);
      setAvailableAgents(data.availableAgents || []);
      setAvailableDispositions(data.availableDispositions || []);
      setAvailableSubDispositions(data.availableSubDispositions || []);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load scores (Score Log only — never updates Performance stats) ──────────
  const abortRef = useRef<AbortController | null>(null);

  const loadScores = useCallback(async (page: number, filters: LogFilters, skipStats = true) => {
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLogsLoading(true);
    setLogsError(null);
    try {
      const params = buildParams(page, filters);
      if (skipStats) params.set('skipStats', '1');
      const resp = await fetch(`/api/quality/scores?${params}`, { signal: controller.signal });
      let data: any;
      try { data = await resp.json(); } catch {
        if (controller.signal.aborted) return;
        setLogsError(`Server error ${resp.status}: non-JSON response`);
        setLogsLoading(false);
        return;
      }
      if (controller.signal.aborted) return;
      if (!resp.ok) {
        setLogsError(`API error ${resp.status}: ${data?.error || data?.detail || resp.statusText}`);
        setLogsLoading(false);
        return;
      }
      setEntries(data.entries || []);
      // Summary always comes back — reflects current filters
      if (data.summary) setSummary(data.summary);
      // Heavy per-agent stats only come back when skipStats=false
      if (!skipStats) {
        setAgentStats(data.agentStats || []);
        setParamFails(data.paramFails || {});
        setWeeklyParamData(data.weeklyParamData || []);
      }
      setAvailableAgents(data.availableAgents || []);
      setAvailableDispositions(data.availableDispositions || []);
      setAvailableSubDispositions(data.availableSubDispositions || []);
      setTotalStored(data.totalStored ?? 0);
      setTotalFiltered(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
      setLogsLoaded(true);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setLogsError(`Failed to load: ${e?.message || String(e)}`);
    }
    setLogsLoading(false);
  }, []);

  const switchTab = (t: typeof tab) => {
    setTab(t);
    if (t === 'log' && !logsLoaded) loadScores(0, appliedFilters);
  };

  const runPendingScores = async () => {
    setBatchRunning(true);
    setBatchProgress({ scored: 0, errors: 0, remaining: 0 });
    let scored = 0, errors = 0;
    try {
      while (true) {
        const res = await fetch('/api/admin/run-pending-scores', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { errors++; }
        else if (data.iqs != null) { scored++; }
        else if (data.error) { errors++; }
        setBatchProgress({ scored, errors, remaining: data.remaining ?? 0 });
        if (data.done || (!res.ok && data.remaining === 0)) break;
        // Small pause between calls to avoid hammering the endpoint
        await new Promise(r => setTimeout(r, 300));
      }
      setToast(`Scored ${scored} pending chats${errors > 0 ? ` · ${errors} errors` : ''}`);
      if (scored > 0) loadPerfData(perfPeriod, perfDateFrom, perfDateTo);
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    } finally {
      setBatchRunning(false);
    }
  };

  const backfillSheet = async () => {
    setSheetBackfilling(true);
    setSheetBackfillResult(null);
    try {
      const res = await fetch('/api/admin/backfill-sheet', { method: 'POST' });
      const data = await res.json();
      setSheetBackfillResult({ sent: data.sent ?? 0, total: data.total ?? 0 });
      setToast(`Sheet updated: ${data.sent} of ${data.total} failing chats sent`);
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setToast(`Sheet backfill error: ${err.message}`);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSheetBackfilling(false);
    }
  };

  // Apply filters: copy pending → applied, reset to page 0, fetch
  const applyFilters = () => {
    const f = selfAgentName ? { ...pendingFilters, agent: selfAgentName } : pendingFilters;
    setAppliedFilters(f);
    setLogPage(0);
    loadScores(0, f);
  };

  // Preview how many chats match the report filters
  const previewReportCount = useCallback(async () => {
    setReportCountLoading(true);
    try {
      const params = buildParams(0, reportFilters);
      params.set('skipStats', '1');
      const data = await fetch(`/api/quality/scores?${params}`).then(r => r.json());
      setReportTotalFiltered(data.total ?? 0);
    } catch {}
    setReportCountLoading(false);
  }, [reportFilters]);

  // Download report CSV from export API using reportFilters (independent of Score Log)
  const downloadReport = useCallback(async (_format: 'csv' | 'xlsx') => {
    setExporting(true);
    try {
      const params = buildParams(0, reportFilters);
      params.delete('page');
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
  }, [reportFilters]);

  // Auto-load on mount — Performance and Score Log load independently
  useEffect(() => {
    loadPerfData('1w');
    const startFilters = initialAgent
      ? { ...DEFAULT_FILTERS, agent: initialAgent }
      : DEFAULT_FILTERS;
    if (initialAgent) setPendingFilters(startFilters);
    loadScores(0, startFilters);
    // Load pending challenge count for nav badge
    fetch('/api/quality/flag')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.flags)) setChallengeCount(d.flags.filter((f: any) => f.status === 'pending').length); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset agent timing page when data changes
  useEffect(() => { setAgentPage(0); }, [agentStats]);

  const openEditModal = (entry: IQSScoreEntry) => {
    setEditEntry(entry);
    setEditForm({
      agentName: entry.agentName || '',
      csat: entry.csat || '',
      disposition: entry.disposition || '',
      subDisposition: entry.subDisposition || '',
      summary: entry.summary || '',
      scores: { ...entry.scores },
      reasoning: { ...entry.reasoning },
      note: '',
    });
    setEditSaved(false);
  };

  const saveEdit = async () => {
    if (!editEntry || !editForm) return;
    setSavingEdit(true);
    try {
      const res = await fetch('/api/quality/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editEntry.id, chatId: editEntry.chatId,
          agentName: editForm.agentName, scores: editForm.scores,
          reasoning: editForm.reasoning, disposition: editForm.disposition,
          subDisposition: editForm.subDisposition, csat: editForm.csat,
          summary: editForm.summary, note: editForm.note,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      const updated: IQSScoreEntry = data.entry || { ...editEntry, ...editForm, updatedAt: new Date().toISOString(), updatedBy: userEmail };
      setEntries(prev => prev.map(e => e.id === editEntry.id ? updated : e));
      setDetailEntry(prev => prev?.id === editEntry.id ? updated : prev);
      setEditSaved(true);
      setToast('Override saved successfully');
      setTimeout(() => setToast(null), 3000);
      setEditEntry(null); setEditForm(null);
    } catch (err: any) {
      setToast(err?.message || 'Failed to save override');
      setTimeout(() => setToast(null), 5000);
    }
    setSavingEdit(false);
  };

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
          body: JSON.stringify({ transcript: row.transcript, chatId, agentName: row.agent, date: row.date, csat: row.csat, tags: row.tags || '', contactPhone: row.contactPhone || '' }),
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
    reports: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 10V8M8 10V6M11 10V4" />
      </svg>
    ),
    challenges: (
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 2v7M8 12v2"/><circle cx="8" cy="8" r="7"/>
      </svg>
    ),
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex font-sans antialiased overflow-hidden" style={{ background: '#f5f3ee' }}>
      {detailEntry && (
        <ScoreDetail
          entry={detailEntry}
          onClose={() => setDetailEntry(null)}
          onEdit={openEditModal}
          userRole={userRole}
        />
      )}

      {/* ── Edit/Override Modal ── */}
      {editEntry && editForm && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => { setEditEntry(null); setEditForm(null); }}>
          <div className="bg-white w-full sm:rounded-2xl sm:max-w-3xl max-h-[94vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">Override Score</h2>
                <p className="text-xs text-gray-400">Chat {editEntry.chatId}</p>
              </div>
              <button onClick={() => { setEditEntry(null); setEditForm(null); }} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Basic fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Agent Name</label>
                  <input type="text" value={editForm.agentName} onChange={e => setEditForm(f => f ? { ...f, agentName: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">CSAT</label>
                  <select value={editForm.csat} onChange={e => setEditForm(f => f ? { ...f, csat: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white">
                    <option value="">None</option>
                    <option value="5">Good</option>
                    <option value="3">Could be better</option>
                    <option value="1">Bad</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Disposition</label>
                  <input type="text" value={editForm.disposition} onChange={e => setEditForm(f => f ? { ...f, disposition: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Sub-Disposition</label>
                  <input type="text" value={editForm.subDisposition} onChange={e => setEditForm(f => f ? { ...f, subDisposition: e.target.value } : f)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Summary</label>
                <textarea value={editForm.summary} onChange={e => setEditForm(f => f ? { ...f, summary: e.target.value } : f)} rows={3}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-y" />
              </div>

              {/* Parameter scores */}
              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-3">Parameter Scores</p>
                <div className="space-y-3">
                  {PARAM_ORDER.map(p => (
                    <div key={p} className="rounded-xl border border-gray-100 p-3 bg-gray-50/60">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-xs font-semibold text-gray-700 flex-1">{PARAM_NAMES[p]}</span>
                        <div className="flex gap-1">
                          {(['Yes', 'No', 'NA'] as const).map(v => (
                            <button key={v} onClick={() => setEditForm(f => f ? { ...f, scores: { ...f.scores, [p]: v } } : f)}
                              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition ${
                                editForm.scores[p] === v
                                  ? v === 'Yes' ? 'bg-emerald-500 text-white' : v === 'No' ? 'bg-red-500 text-white' : 'bg-gray-400 text-white'
                                  : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-400'
                              }`}>{v}</button>
                          ))}
                        </div>
                      </div>
                      <textarea
                        value={editForm.reasoning[p] || ''}
                        onChange={e => setEditForm(f => f ? { ...f, reasoning: { ...f.reasoning, [p]: e.target.value } } : f)}
                        placeholder="Reasoning…"
                        rows={2}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20 resize-y bg-white"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Reviewer note */}
              <div>
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Quality Reviewer Note</label>
                <textarea value={editForm.note} onChange={e => setEditForm(f => f ? { ...f, note: e.target.value } : f)} rows={3}
                  placeholder="Internal note for this override…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 resize-y" />
              </div>

              <div className="flex gap-3 pt-1">
                <button onClick={saveEdit} disabled={savingEdit}
                  className="flex-1 bg-emerald-600 text-white font-bold py-2.5 rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition text-sm">
                  {savingEdit ? 'Saving…' : 'Save Override'}
                </button>
                <button onClick={() => { setEditEntry(null); setEditForm(null); }}
                  className="px-5 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl hover:bg-gray-50 transition text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Agent Report Modal */}
      {agentReportStat && (
        <AgentReportModal
          stat={agentReportStat}
          entries={entries}
          paramFails={paramFails}
          onClose={() => setAgentReportStat(null)}
          onFilterLog={({ agent, minScore, maxScore }) => {
            const f = { ...DEFAULT_FILTERS, agent, minScore: minScore ?? 0, maxScore: maxScore ?? 100 };
            setPendingFilters(f); setAppliedFilters(f); setLogPage(0);
            loadScores(0, f); switchTab('log');
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-xl">
          {toast}
        </div>
      )}

      {/* ── Left Panel ── */}
      <aside className="w-64 shrink-0 bg-[#111827] flex flex-col h-full">
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
          <NavItem icon={icons.performance} label="Performance" active={tab === 'performance'}
            onClick={() => switchTab('performance')} />
          <NavItem icon={icons.log} label="Score Log" active={tab === 'log'}
            onClick={() => switchTab('log')} />
          {!selfAgentName && (
            <NavItem icon={icons.upload} label="Upload & Score" active={tab === 'upload'}
              onClick={() => switchTab('upload')} />
          )}
          <NavItem icon={icons.reports} label="Reports" active={tab === 'reports'}
            onClick={() => setTab('reports')} />
          <NavItem icon={icons.challenges} label="Chats Pending" active={tab === 'pending'}
            badge={challengeCount} onClick={() => setTab('pending')} />
        </nav>

      </aside>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* Top bar */}
        <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4">
          <div className="shrink-0">
            <h1 className="text-base font-bold text-gray-900">
              {tab === 'performance' ? 'Team Performance' : tab === 'log' ? 'Score Log' : tab === 'reports' ? 'Reports' : tab === 'pending' ? 'Chats Pending' : 'Upload & Score'}
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {tab === 'performance' && `${agentStats.length} agents · ${perfTotal} chats`}
              {tab === 'log' && `${entries.length} of ${totalFiltered} · ${totalStored.toLocaleString()} all-time`}
              {tab === 'upload' && (fileName ? `${totalToScore} chats ready` : 'Drop a Wint CSV export to begin')}
              {tab === 'reports' && 'Download filtered data as CSV'}
              {tab === 'pending' && `${challengeCount} pending review`}
            </p>
          </div>

          {/* Performance tab — independent period picker */}
          {tab === 'performance' && (
            <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
              {(['today', 'yesterday', '1w'] as const).map(r => (
                <button key={r}
                  onClick={() => { setPerfPeriod(r); setShowPerfPicker(false); loadPerfData(r); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    perfPeriod === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                </button>
              ))}
              {/* Custom date range */}
              <div className="relative">
                <button
                  onClick={() => { setPerfPeriod('custom'); setShowPerfPicker(v => !v); }}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                    perfPeriod === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {perfPeriod === 'custom' && perfDateFrom
                    ? `${perfDateFrom.slice(5)} → ${perfDateTo ? perfDateTo.slice(5) : '…'}`
                    : 'Custom'}
                </button>
                {showPerfPicker && (
                  <div className="absolute right-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                    <DateRangePicker
                      from={perfDateFrom} to={perfDateTo}
                      onChange={(f, t) => { setPerfDateFrom(f); setPerfDateTo(t); loadPerfData('custom', f, t); }}
                      onClose={() => setShowPerfPicker(false)}
                    />
                  </div>
                )}
              </div>
              {userRole === 'admin' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={runPendingScores}
                    disabled={batchRunning}
                    title="Score all unscored conversations in the DB"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition border border-blue-200"
                  >
                    {batchRunning ? (
                      <>
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                        {batchProgress ? `${batchProgress.scored} done · ${batchProgress.remaining} left` : 'Starting…'}
                      </>
                    ) : batchProgress ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5L6 10l-3.5-3.5L1 8l5 5 9-9z"/></svg>
                        {batchProgress.scored} scored{batchProgress.errors > 0 ? ` · ${batchProgress.errors} errors` : ''}
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z"/></svg>
                        Score Pending
                      </>
                    )}
                  </button>
                  <button
                    onClick={backfillSheet}
                    disabled={sheetBackfilling}
                    title="Send today's critical-parameter failures to the Google Sheet"
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition border border-emerald-200"
                  >
                    {sheetBackfilling ? (
                      <>
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeOpacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                        Sending…
                      </>
                    ) : sheetBackfillResult ? (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5L6 10l-3.5-3.5L1 8l5 5 9-9z"/></svg>
                        {sheetBackfillResult.sent} sent
                      </>
                    ) : (
                      <>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 7h6M5 10h4"/></svg>
                        Fill Sheet Today
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Score Log tab — Filters button */}
          {tab === 'log' && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setShowOnlyNeedsReview(v => !v)}
                className={`flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-xl font-semibold transition border ${
                  showOnlyNeedsReview
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-amber-600 border-amber-300 hover:bg-amber-50'
                }`}
                title="Show only chats needing QA review"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="7"/><path d="M8 5v3.5M8 11v.5" strokeLinecap="round"/></svg>
                Needs Review
              </button>
              <button
                onClick={() => setShowFilterPanel(v => !v)}
                className={`relative flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-xl font-semibold transition border ${
                  showFilterPanel
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : activeFilterCount > 0
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 4h12M5 8h6M8 12h0" strokeLinecap="round"/>
                </svg>
                Filters
                {activeFilterCount > 0 && (
                  <span className={`ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ${showFilterPanel ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white'}`}>
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <button onClick={() => loadScores(logPage, appliedFilters)} disabled={logsLoading}
                className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:border-gray-400 disabled:opacity-40 transition font-medium">
                {logsLoading ? '…' : '↻'}
              </button>
            </div>
          )}
        </header>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── PERFORMANCE TAB ── */}
          {tab === 'performance' && (
            <>
              {logsError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm font-medium">
                  {logsError}
                </div>
              )}
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
                <div className="space-y-6 max-w-5xl mx-auto">
                  {/* ── Top 4 KPI cards ── */}
                  {(() => {
                    const total     = summary?.totalConvos   ?? totalFiltered;
                    const botCount  = summary?.botConvos     ?? 0;
                    const hybridCount = entries.filter(e => e.conversationType === 'hybrid').length;
                    const botPct    = total > 0 ? Math.round(botCount    / total * 100) : 0;
                    const hybridPct = total > 0 ? Math.round(hybridCount / total * 100) : 0;
                    const humanPct  = Math.max(0, 100 - botPct - hybridPct);

                    // FRT for human-only chats
                    const humanFrts = entries.filter(e => e.conversationType !== 'bot' && e.frt != null).map(e => e.frt as number);
                    const avgHumanFrt = humanFrts.length ? Math.round(humanFrts.reduce((s, n) => s + n, 0) / humanFrts.length) : null;

                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {/* Card 1 — No. of chats */}
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Chats</p>
                          <p className="text-3xl font-bold text-gray-900">{total.toLocaleString()}</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {botPct > 0 && (
                              <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                                {botPct}% Myra
                              </span>
                            )}
                            {hybridPct > 0 && (
                              <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                {hybridPct}% Assisted
                              </span>
                            )}
                            {humanPct > 0 && (
                              <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
                                {humanPct}% Human
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Card 2 — Resolution Time (all types) */}
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Avg Resolution</p>
                          <p className="text-3xl font-bold text-gray-900">{fmtDuration(summary?.avgResolution ?? null)}</p>
                          <p className="text-[11px] text-gray-400 mt-1">all conversations</p>
                        </div>
                        {/* Card 3 — CSAT combined */}
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">CSAT</p>
                          <p className="text-3xl font-bold text-gray-900">
                            {summary?.overallCsat != null ? `${summary.overallCsat}%` : '—'}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-1">
                            {summary ? `${summary.good} good · ${summary.cbbBad} bad` : ''}
                          </p>
                        </div>
                        {/* Card 4 — FRT for human-handled chats */}
                        <div className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
                          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Avg FRT (Human)</p>
                          <p className="text-3xl font-bold text-gray-900">{fmtDuration(avgHumanFrt)}</p>
                          <p className="text-[11px] text-gray-400 mt-1">first response time</p>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Agent Scorecards — lowest IQS first */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Needs Attention · Lowest IQS First</p>
                      {agentStats.length > 3 && (
                        <button onClick={() => setShowAllAgents(true)}
                          className="text-xs text-emerald-600 font-semibold hover:underline">
                          View all {agentStats.length} agents →
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {agentStats.slice(0, 3).map(a => (
                        <AgentCard
                          key={a.agent}
                          stat={a}
                          entries={entries}
                          teamParamFails={paramFails}
                          onViewReport={s => setAgentReportStat(s)}
                          onFilterLog={({ agent, minScore, maxScore }) => {
                            const f = { ...DEFAULT_FILTERS, agent,
                              minScore: minScore ?? 0, maxScore: maxScore ?? 100 };
                            setPendingFilters(f); setAppliedFilters(f); setLogPage(0);
                            loadScores(0, f); switchTab('log');
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* All Agents Modal */}
                  {showAllAgents && (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6" onClick={() => setShowAllAgents(false)}>
                      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[88vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
                          <div>
                            <h2 className="font-bold text-gray-900">All Agent Scorecards</h2>
                            <p className="text-xs text-gray-500 mt-0.5">{agentStats.length} agents · lowest IQS first</p>
                          </div>
                          <button onClick={() => setShowAllAgents(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 2l12 12M14 2L2 14" /></svg>
                          </button>
                        </div>
                        <div className="p-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {agentStats.map(a => (
                            <AgentCard
                              key={a.agent}
                              stat={a}
                              entries={entries}
                              teamParamFails={paramFails}
                              onViewReport={s => { setShowAllAgents(false); setAgentReportStat(s); }}
                              onFilterLog={({ agent, minScore, maxScore }) => {
                                const f = { ...DEFAULT_FILTERS, agent,
                                  minScore: minScore ?? 0, maxScore: maxScore ?? 100 };
                                setPendingFilters(f); setAppliedFilters(f); setLogPage(0);
                                setShowAllAgents(false); loadScores(0, f); switchTab('log');
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Agent Timing Analytics Table */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Agent Wise Analytics</p>
                        <p className="text-xs text-gray-500 mt-0.5">IQS, CSAT, and response times per agent · click headers to sort</p>
                      </div>
                      <div className="flex gap-2 text-xs text-gray-500">
                        {agentPage > 0 && (
                          <button onClick={() => setAgentPage(p => p - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg hover:border-gray-400 transition font-medium">← Prev</button>
                        )}
                        {agentPage < Math.ceil(sortedAgentStats.length / 5) - 1 && (
                          <button onClick={() => setAgentPage(p => p + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg hover:border-gray-400 transition font-medium">Next →</button>
                        )}
                      </div>
                    </div>
                    {sortedAgentStats.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">No timing data yet</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50/60 border-b border-gray-100">
                            {([
                              { key: 'agent',         label: 'Agent',         align: 'left'  },
                              { key: 'chats',         label: 'Chats',         align: 'right' },
                              { key: 'avgIqs',        label: 'Avg IQS',       align: 'right' },
                              { key: 'avgFrt',        label: 'Avg FRT',       align: 'right' },
                              { key: 'avgResolution', label: 'Avg Resolution',align: 'right' },
                              { key: 'csatPct',       label: 'CSAT Good',     align: 'right' },
                              { key: 'atRiskPct',     label: 'At Risk %',     align: 'right' },
                            ] as const).map(col => {
                              const isActive = sortAgentCol === col.key;
                              return (
                                <th key={col.key}
                                  className={`${col.align === 'left' ? 'text-left px-5' : 'text-right px-4'} py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-800 transition whitespace-nowrap`}
                                  onClick={() => {
                                    if (isActive) setSortAgentDir(d => d === 'asc' ? 'desc' : 'asc');
                                    else { setSortAgentCol(col.key); setSortAgentDir('asc'); }
                                    setAgentPage(0);
                                  }}>
                                  {col.label}{isActive ? (sortAgentDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                                </th>
                              );
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedAgentStats.slice(agentPage * 5, agentPage * 5 + 5).map((a, i) => {
                            const atRiskPct = a.chats > 0 ? Math.round(a.atRisk / a.chats * 100) : 0;
                            return (
                              <tr key={a.agent} className={`border-b border-gray-50 hover:bg-emerald-50/30 cursor-pointer transition ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}
                                onClick={() => setAgentReportStat(a)}>
                                <td className="px-5 py-3 font-semibold text-gray-900 text-emerald-700 hover:underline">{a.agent}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{a.chats}</td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  <IQSPill iqs={a.avgIqs} />
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmtDuration(a.avgFrt ?? null)}</td>
                                <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmtDuration(a.avgResolution ?? null)}</td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {a.csatPct != null
                                    ? <span className={`font-semibold ${a.csatPct >= 80 ? 'text-emerald-600' : a.csatPct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{a.csatPct}%</span>
                                    : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-5 py-3 text-right tabular-nums">
                                  <span className={`font-semibold ${atRiskPct >= 30 ? 'text-red-600' : atRiskPct >= 15 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {atRiskPct}%
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Weekly Parameter Breakdown Table */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Parameter Pass Rate by Week</p>
                        <p className="text-xs text-gray-500 mt-0.5">% of chats passing each parameter per week · click a row to filter Score Log</p>
                      </div>
                      {weeklyParamData.length > 5 && (
                        <button onClick={() => setShowAllWeeks(v => !v)} className="text-xs text-emerald-600 font-semibold hover:underline shrink-0">
                          {showAllWeeks ? 'Show less ↑' : `View all ${weeklyParamData.length} weeks →`}
                        </button>
                      )}
                    </div>
                    {weeklyParamData.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-8">No data yet</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[900px]">
                          <thead>
                            <tr className="bg-gray-50/80 border-b border-gray-100">
                              <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap sticky left-0 bg-gray-50/80">Week</th>
                              <th className="text-right px-3 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Chats</th>
                              {PARAM_ORDER.map(p => (
                                <th key={p} className="text-right px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap" title={PARAM_NAMES[p]}>
                                  {p === 'AllQuestions' ? 'All Q' : p === 'Expectation' ? 'Expect' : p === 'Contextual' ? 'Context' : p === 'FollowUp' ? 'Follow' : p === 'Sentences' ? 'Tone' : p === 'Technical' ? 'Tech' : p === 'Grammar' ? 'Grammar' : p}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(showAllWeeks ? weeklyParamData : weeklyParamData.slice(0, 5)).map((row, i) => (
                              <tr key={row.key}
                                className={`border-b border-gray-50 hover:bg-emerald-50/20 cursor-pointer transition ${i % 2 === 1 ? 'bg-gray-50/20' : ''}`}
                                title="Click to filter Score Log to this week"
                                onClick={() => {
                                  const weekEnd = new Date(row.key + 'T00:00:00Z');
                                  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
                                  const dateTo = weekEnd.toISOString().slice(0, 10);
                                  const f = { ...DEFAULT_FILTERS, dateRange: 'custom' as const, dateFrom: row.key, dateTo };
                                  setPendingFilters(f); setAppliedFilters(f); setLogPage(0);
                                  loadScores(0, f); switchTab('log');
                                }}>
                                <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap sticky left-0 bg-white">
                                  {row.label}
                                </td>
                                <td className="px-3 py-3 text-right text-gray-500 tabular-nums">{row.total}</td>
                                {PARAM_ORDER.map(p => {
                                  const failPct = row.params[p];
                                  const passPct = failPct > 0 ? 100 - failPct : null;
                                  const color = passPct == null ? 'text-gray-300' : passPct >= 80 ? 'text-green-600 font-semibold' : passPct >= 60 ? 'text-gray-600' : 'text-red-600 font-bold';
                                  return (
                                    <td key={p} className={`px-3 py-3 text-right tabular-nums ${color}`}>
                                      {passPct != null ? `${passPct}%` : '—'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── SCORE LOG TAB ── */}
          {tab === 'log' && (
            <div className="space-y-4 max-w-5xl mx-auto">
              {/* Collapsible filter panel */}
              {showFilterPanel && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
                  {/* Row 1: Date Range */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Date Range</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {(['today', 'yesterday', '1w'] as const).map(r => (
                        <button key={r}
                          onClick={() => setPendingFilters(f => ({ ...f, dateRange: r, dateFrom: '', dateTo: '' }))}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                            pendingFilters.dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                        </button>
                      ))}
                      <button
                        onClick={() => setPendingFilters(f => ({ ...f, dateRange: 'custom' }))}
                        className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                          pendingFilters.dateRange === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}>
                        Custom
                      </button>
                      {pendingFilters.dateRange === 'custom' && (
                        <div className="flex items-center gap-2 ml-1">
                          <input type="date" value={pendingFilters.dateFrom}
                            onChange={e => setPendingFilters(f => ({ ...f, dateFrom: e.target.value }))}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                          <span className="text-gray-400 text-xs">→</span>
                          <input type="date" value={pendingFilters.dateTo}
                            onChange={e => setPendingFilters(f => ({ ...f, dateTo: e.target.value }))}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Chat ID + Agent + CSAT */}
                  <div className="flex flex-wrap items-end gap-4">
                    {/* Chat ID */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Chat ID</p>
                      <input
                        type="text"
                        value={pendingFilters.chatId}
                        onChange={e => setPendingFilters(f => ({ ...f, chatId: e.target.value }))}
                        placeholder="Search by Chat ID…"
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 w-44 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 text-gray-700 bg-white"
                      />
                    </div>
                    {/* Agent */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent</p>
                      <select value={pendingFilters.agent}
                        onChange={e => setPendingFilters(f => ({ ...f, agent: e.target.value }))}
                        disabled={!!selfAgentName}
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px] disabled:opacity-60 disabled:cursor-not-allowed">
                        <option value="">All agents</option>
                        {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    {/* CSAT */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CSAT</p>
                      <select value={pendingFilters.csat}
                        onChange={e => setPendingFilters(f => ({ ...f, csat: e.target.value }))}
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[110px]">
                        <option value="">Any</option>
                        <option value="5">Good</option>
                        <option value="3">CBB</option>
                        <option value="1">Bad</option>
                      </select>
                    </div>
                    {/* IQS range */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Range</p>
                      <div className="flex items-center gap-2">
                        <input type="number" min={0} max={100} value={pendingFilters.minScore}
                          onChange={e => setPendingFilters(f => ({ ...f, minScore: parseInt(e.target.value) || 0 }))}
                          className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                        <span className="text-gray-400 text-xs">–</span>
                        <input type="number" min={0} max={100} value={pendingFilters.maxScore}
                          onChange={e => setPendingFilters(f => ({ ...f, maxScore: parseInt(e.target.value) || 100 }))}
                          className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Disposition + Sub-Disposition */}
                  <div className="flex flex-wrap items-end gap-4">
                    {/* Disposition */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Disposition</p>
                      <select value={pendingFilters.disposition}
                        onChange={e => setPendingFilters(f => ({ ...f, disposition: e.target.value, subDisposition: '' }))}
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                        <option value="">All</option>
                        {availableDispositions.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    {/* Sub-Disposition */}
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sub-Disposition</p>
                      <select value={pendingFilters.subDisposition}
                        onChange={e => setPendingFilters(f => ({ ...f, subDisposition: e.target.value }))}
                        className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[180px]">
                        <option value="">All</option>
                        {availableSubDispositions.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Action row */}
                  <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
                    <button onClick={() => { applyFilters(); setShowFilterPanel(false); }} disabled={logsLoading}
                      className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
                      {logsLoading ? 'Loading…' : 'Apply Filters'}
                    </button>
                    <button
                      onClick={() => {
                        const reset = selfAgentName ? { ...DEFAULT_FILTERS, agent: selfAgentName } : DEFAULT_FILTERS;
                        setPendingFilters(reset);
                        setAppliedFilters(reset);
                        setLogPage(0);
                        loadScores(0, reset);
                        setShowFilterPanel(false);
                      }}
                      className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition">
                      Reset all
                    </button>
                    <div className="relative ml-auto">
                      <button
                        onClick={() => setShowColPicker(v => !v)}
                        className="text-xs px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg hover:border-gray-400 transition font-medium"
                      >
                        Columns ⚙
                      </button>
                      {showColPicker && (
                        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 shadow-lg rounded-xl z-10 p-3 min-w-[160px]">
                          {ALL_LOG_COLS.map(col => {
                            const isVisible = !hiddenCols.has(col) && (!autoHiddenLogCols.has(col) || forcedVisibleCols.has(col));
                            return (
                              <label key={col} className="flex items-center gap-2 py-1 cursor-pointer hover:text-gray-900 text-xs text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={isVisible}
                                  onChange={e => {
                                    if (e.target.checked) {
                                      setHiddenCols(prev => { const s = new Set(prev); s.delete(col); return s; });
                                      setForcedVisibleCols(prev => { const s = new Set(prev); s.add(col); return s; });
                                    } else {
                                      setHiddenCols(prev => { const s = new Set(prev); s.add(col); return s; });
                                      setForcedVisibleCols(prev => { const s = new Set(prev); s.delete(col); return s; });
                                    }
                                  }}
                                />
                                {col}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {logsLoading && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm animate-pulse">Loading…</div>
              )}

              {!logsLoading && entries.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
                  <p className="text-gray-400 text-sm">No chats match these filters.</p>
                  <p className="text-xs text-gray-300 mt-1">Adjust the filters above and click Apply.</p>
                </div>
              )}

              {!logsLoading && entries.length > 0 && (
                <>
                  {/* Summary stats bar */}
                  {summary && (
                    <SummaryBar
                      s={summary}
                      onFilter={({ filterCsat: fc, filterType: ft, sortByIqs }) => {
                        if (fc !== undefined) { setPendingFilters(f => ({ ...f, csat: fc })); }
                        if (ft !== undefined) { setPendingFilters(f => ({ ...f, type: ft })); }
                        if (sortByIqs) { setSortCol('iqs'); setSortDir('asc'); }
                      }}
                    />
                  )}

                  {/* ── Per-conversation table ── */}
                  {/* Fix 2 — column visibility */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/60">
                          {/* Fix 3 — sortable column headers */}
                          {visibleLogCols.map(h => {
                            const sortKeyMap: Record<string, 'iqs' | 'fails' | 'date' | 'csat' | 'frt'> = {
                              'IQS': 'iqs', 'Fails': 'fails', 'Date': 'date', 'CSAT': 'csat', 'FRT': 'frt'
                            };
                            const colKey = sortKeyMap[h];
                            const isSortable = !!colKey;
                            const isActive = sortCol === colKey;
                            return (
                              <th
                                key={h}
                                className={`text-left px-3 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider${isSortable ? ' cursor-pointer select-none hover:text-gray-700' : ''}`}
                                onClick={isSortable ? () => {
                                  if (isActive) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                                  else { setSortCol(colKey); setSortDir('desc'); }
                                } : undefined}
                              >
                                {h}{isSortable && (isActive ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ↕')}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {chatIdFilteredLogEntries.map((e, i) => {
                          const fails = PARAM_ORDER.filter(p => e.scores[p] === 'No');
                          // Soft red tint for at-risk rows — light enough to keep text readable
                          const isTechFail = e.scores?.Technical === 'No';
                          const rowStyle = isTechFail
                            ? { background: '#fff1f2' }   // rose-50 — very light, text stays dark
                            : e.iqs < 50
                            ? { background: '#fef2f2' }   // red-50
                            : undefined;
                          return (
                            <tr
                              key={i}
                              className="border-b border-gray-50 hover:bg-emerald-50/40 cursor-pointer transition"
                              style={rowStyle}
                              onClick={() => setDetailEntry(e)}
                            >
                              {/* Fix 2 — render only visible columns */}
                              {visibleLogCols.map(col => {
                                if (col === 'Agent') return (
                                  <td key={col} className="px-3 py-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-gray-900">{e.agentName || '—'}</span>
                                      {e.uncertainParameters && e.uncertainParameters.length > 0 && (
                                        <span title={`${e.uncertainParameters.length} param(s) need QA review`}
                                          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-400 text-white text-[9px] font-bold shrink-0">
                                          ?
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                );
                                if (col === 'Chat ID') return <td key={col} className="px-3 py-2.5"><ChatLink chatId={e.chatId} className="text-xs" /></td>;
                                if (col === 'Mobile') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{(e as any).mobileNumber || <span className="text-gray-300">—</span>}</td>;
                                if (col === 'CSAT') return <td key={col} className="px-3 py-2.5">
                                  {e.csat === '5' ? <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Good</span>
                                  : e.csat === '3' ? <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">CBB</span>
                                  : e.csat === '1' ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Bad</span>
                                  : <span className="text-gray-300">—</span>}
                                </td>;
                                if (col === 'FRT') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.frt)}</td>;
                                if (col === 'Handoff') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.botToTeamSecs)}</td>;
                                if (col === 'Resolution') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.resolutionTime)}</td>;
                                if (col === 'Closure') return <td key={col} className="px-3 py-2.5 text-gray-600 tabular-nums">{fmtDuration(e.closureTime)}</td>;
                                if (col === 'IQS') return <td key={col} className="px-3 py-2.5"><IQSPill iqs={e.iqs} /></td>;
                                if (col === 'Fails') return (
                                  // Fix 1 — fails severity bar
                                  <td key={col} className="px-3 py-2.5">
                                    {fails.length === 0 ? (
                                      <span style={{ color: 'var(--color-text-success)' }} className="font-semibold text-xs">✓</span>
                                    ) : (
                                      <div className="flex items-center gap-1.5">
                                        {/* Fix 1 — inline horizontal severity bar */}
                                        <div style={{ width: 80, height: 4, background: 'var(--color-background-tertiary)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                                          <div style={{
                                            width: `${Math.min(fails.length / 10 * 100, 100)}%`,
                                            height: '100%',
                                            background: fails.length >= 6
                                              ? 'var(--color-border-danger)'
                                              : fails.length >= 3
                                                ? 'var(--color-border-warning)'
                                                : 'var(--color-border-success)',
                                            borderRadius: 2,
                                          }} />
                                        </div>
                                        <span className="font-semibold text-xs tabular-nums" style={{
                                          color: fails.length >= 6
                                            ? 'var(--color-text-danger)'
                                            : fails.length >= 3
                                              ? 'var(--color-text-warning)'
                                              : 'var(--color-text-success)',
                                        }}>{fails.length}</span>
                                      </div>
                                    )}
                                  </td>
                                );
                                if (col === 'Disposition') return <td key={col} className="px-3 py-2.5 text-gray-700 text-xs max-w-[130px] truncate" title={e.disposition}>{e.disposition || <span className="text-gray-300">—</span>}</td>;
                                if (col === 'Sub-Disposition') return <td key={col} className="px-3 py-2.5 text-gray-700 text-xs max-w-[130px] truncate" title={e.subDisposition}>{e.subDisposition || <span className="text-gray-300">—</span>}</td>;
                                if (col === 'Last Updated') return (
                                  <td key={col} className="px-4 py-2.5 text-[12px] text-gray-400 whitespace-nowrap">
                                    {e.updatedAt && e.updatedAt !== e.scoredAt
                                      ? new Date(e.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                                      : '—'}
                                  </td>
                                );
                                if (col === 'Date') return <td key={col} className="px-3 py-2.5 text-gray-600">{(e.date || e.scoredAt || '').slice(0, 10)}</td>;
                                return null;
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">
                      Showing {logPage * 50 + 1}–{logPage * 50 + entries.length} of {totalFiltered.toLocaleString()}
                    </p>
                    <div className="flex gap-2">
                      {logPage > 0 && (
                        <button
                          onClick={() => { const p = logPage - 1; setLogPage(p); loadScores(p, appliedFilters, true); }}
                          className="text-xs px-4 py-1.5 border border-gray-200 rounded-xl hover:border-gray-400 transition font-medium text-gray-600">
                          ← Previous
                        </button>
                      )}
                      {hasMore && (
                        <button
                          onClick={() => { const p = logPage + 1; setLogPage(p); loadScores(p, appliedFilters, true); }}
                          className="text-xs px-4 py-1.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition font-semibold">
                          Next 50 →
                        </button>
                      )}
                    </div>
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

          {/* ── REPORTS TAB ── */}
          {tab === 'reports' && (
            <div className="space-y-6 max-w-3xl mx-auto">
              {/* Independent filter controls */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <p className="text-sm font-bold text-gray-900 mb-4">Report Filters</p>
                <div className="flex flex-wrap items-end gap-4">
                  {/* Period chips */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Period</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {(['today', 'yesterday', '1w'] as const).map(r => (
                        <button key={r}
                          onClick={() => { setReportFilters(f => ({ ...f, dateRange: r, dateFrom: '', dateTo: '' })); setReportTotalFiltered(null); setShowReportPicker(false); }}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                            reportFilters.dateRange === r ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : '1 Week'}
                        </button>
                      ))}
                      {/* Custom */}
                      <div className="relative">
                        <button
                          onClick={() => { setReportFilters(f => ({ ...f, dateRange: 'custom' })); setShowReportPicker(v => !v); setReportTotalFiltered(null); }}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                            reportFilters.dateRange === 'custom' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {reportFilters.dateRange === 'custom' && reportFilters.dateFrom
                            ? `${reportFilters.dateFrom.slice(5)} → ${reportFilters.dateTo ? reportFilters.dateTo.slice(5) : '…'}`
                            : 'Custom'}
                        </button>
                        {showReportPicker && (
                          <div className="absolute left-0 top-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-xl z-30 overflow-hidden">
                            <DateRangePicker
                              from={reportFilters.dateFrom} to={reportFilters.dateTo}
                              onChange={(from, to) => {
                                setReportFilters(f => ({ ...f, dateRange: 'custom', dateFrom: from, dateTo: to }));
                                setReportTotalFiltered(null);
                              }}
                              onClose={() => setShowReportPicker(false)}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Agent */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent</p>
                    <select value={reportFilters.agent}
                      onChange={e => { setReportFilters(f => ({ ...f, agent: e.target.value })); setReportTotalFiltered(null); }}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[140px]">
                      <option value="">All agents</option>
                      {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {/* CSAT */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">CSAT</p>
                    <select value={reportFilters.csat}
                      onChange={e => { setReportFilters(f => ({ ...f, csat: e.target.value })); setReportTotalFiltered(null); }}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[110px]">
                      <option value="">Any</option>
                      <option value="5">Good</option>
                      <option value="3">CBB</option>
                      <option value="1">Bad</option>
                    </select>
                  </div>
                  {/* IQS range */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Range</p>
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={100} value={reportFilters.minScore}
                        onChange={e => { setReportFilters(f => ({ ...f, minScore: parseInt(e.target.value) || 0 })); setReportTotalFiltered(null); }}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                      <span className="text-gray-400 text-xs">–</span>
                      <input type="number" min={0} max={100} value={reportFilters.maxScore}
                        onChange={e => { setReportFilters(f => ({ ...f, maxScore: parseInt(e.target.value) || 100 })); setReportTotalFiltered(null); }}
                        className="w-14 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none" />
                    </div>
                  </div>
                  {/* Disposition */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Disposition</p>
                    <select value={reportFilters.disposition}
                      onChange={e => { setReportFilters(f => ({ ...f, disposition: e.target.value, subDisposition: '' })); setReportTotalFiltered(null); }}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[160px]">
                      <option value="">All</option>
                      {availableDispositions.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  {/* Sub-Disposition */}
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Sub-Disposition</p>
                    <select value={reportFilters.subDisposition}
                      onChange={e => { setReportFilters(f => ({ ...f, subDisposition: e.target.value })); setReportTotalFiltered(null); }}
                      className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 min-w-[160px]">
                      <option value="">All</option>
                      {availableSubDispositions.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                {/* Reset + Preview count row */}
                <div className="flex items-center gap-3 pt-4 border-t border-gray-50 mt-4">
                  <button
                    onClick={previewReportCount}
                    disabled={reportCountLoading}
                    className="px-5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition">
                    {reportCountLoading ? 'Counting…' : 'Preview count'}
                  </button>
                  <button
                    onClick={() => { setReportFilters(DEFAULT_FILTERS); setReportTotalFiltered(null); }}
                    className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium transition">
                    Reset
                  </button>
                  {reportTotalFiltered !== null && (
                    <span className="text-xs text-gray-500 ml-2">
                      <span className="font-bold text-gray-900">{reportTotalFiltered.toLocaleString()}</span> chats will be exported
                    </span>
                  )}
                </div>
              </div>

              {/* Download buttons */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <p className="text-sm font-bold text-gray-900 mb-1">Download</p>
                <p className="text-xs text-gray-500 mb-5">Exports all chats matching the filters above — no pagination limit.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    onClick={() => downloadReport('csv')}
                    disabled={exporting}
                    className="flex items-center gap-3 p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 transition group">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-emerald-800">Download CSV</p>
                      <p className="text-xs text-emerald-600">All columns · filtered data</p>
                    </div>
                  </button>

                  <button
                    onClick={() => downloadReport('xlsx')}
                    disabled={exporting}
                    className="flex items-center gap-3 p-4 rounded-2xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 transition group">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 12l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-blue-800">Download Excel</p>
                      <p className="text-xs text-blue-600">CSV format · opens in Excel</p>
                    </div>
                  </button>
                </div>

                {exporting && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6" /></svg>
                    Preparing download…
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CHATS PENDING TAB ── */}
          {tab === 'pending' && (
            <PendingChatsTab userRole={userRole} userEmail={userEmail} />
          )}

        </div>
      </div>
    </div>
  );
}
