import React, { useState } from 'react';
import { fmtDuration } from '@/lib/quality';
import type { SummaryMetrics, MetaMap } from './types';

// ── Summary stats bar ─────────────────────────────────────────────────────────
export function SummaryBar({ s, onFilter }: { s: SummaryMetrics; onFilter?: (f: { filterCsat?: string; filterType?: string; sortByIqs?: boolean }) => void }) {
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="grid grid-cols-4 divide-x divide-gray-100">
        {groups.map(g => (
          <div key={g.label} className="px-5 py-4">
            <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest mb-3">{g.label}</p>
            <div className="flex flex-col gap-3">
              {g.items.map(item => (
                <div
                  key={item.key}
                  className={(item as any).onClick ? 'cursor-pointer group' : ''}
                  onClick={(item as any).onClick}
                >
                  <p className="text-[11px] font-semibold text-gray-500 mb-0.5 whitespace-nowrap group-hover:text-gray-700 transition-colors">
                    {item.key}
                  </p>
                  <p className="text-[17px] font-bold leading-none tabular-nums" style={{ color: (item as any).valueColor || '#111827' }}>
                    {item.value}
                  </p>
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
const ROBYLON_BASE = 'https://app.robylon.ai/unified-inbox/share';
export function ChatLink({ chatId, className = '' }: { chatId: string; className?: string }) {
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

// ── CSV / Excel Parsing ───────────────────────────────────────────────────────
export function splitCSVLine(line: string): string[] {
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

export function parseRawCSV(text: string): Record<string, string>[] {
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

export function isWintFormat(rows: Record<string, string>[]): boolean {
  if (!rows.length) return false;
  const keys = Object.keys(rows[0]);
  return keys.includes('messages') && keys.includes('chat_id');
}

const CSAT_WORDS: Record<string, string> = { good: '5', 'could be better': '3', bad: '1' };

export function extractWint(messagesStr: string): { agent: string; csat: string; transcript: string } {
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

export interface ParsedRow {
  chatId: string; agent: string; date: string; csat: string; transcript: string; contactPhone?: string;
}

export function buildParsedRows(rows: Record<string, string>[]): ParsedRow[] {
  return rows.map(r => {
    const { agent, csat, transcript } = extractWint(r.messages || '');
    const contactPhone = r.user_phone || r.contact_phone || r.phone || r.mobile || r.phone_number || '';
    return { chatId: r.chat_id || '', agent, date: (r.conversation_started || '').slice(0, 10), csat, transcript, contactPhone: contactPhone || undefined };
  });
}

export async function parseMetaFile(file: File): Promise<{ map: MetaMap; headers: string[]; rows: number; error?: string }> {
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
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return toMap(raw.map(r => { const o: Record<string, string> = {}; for (const k of Object.keys(r)) o[String(k)] = String(r[k]); return o; }));
  }
  return toMap(parseRawCSV(await file.text()));
}

// ── Date Range Picker ─────────────────────────────────────────────────────────
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

export function DateRangePicker({ from, to, onChange, onClose }: {
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

// ── Filter Builder ───────────────────────────────────────────────────────────
import type { LogFilters } from './types';

export function buildParams(page: number, f: LogFilters): URLSearchParams {
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
  if (!f.chatId) {
    const localDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    };
    if (f.dateRange === 'today') {
      const d = localDate(new Date());
      p.set('dateFrom', d); p.set('dateTo', d);
    } else if (f.dateRange === 'yesterday') {
      const d = localDate(new Date(Date.now() - 86400000));
      p.set('dateFrom', d); p.set('dateTo', d);
    } else if (f.dateRange === '1w') {
      p.set('dateFrom', localDate(new Date(Date.now() - 6 * 86400000)));
      p.set('dateTo', localDate(new Date()));
    } else if (f.dateRange === 'custom') {
      if (f.dateFrom) p.set('dateFrom', f.dateFrom);
      if (f.dateTo)   p.set('dateTo', f.dateTo);
    }
  }
  return p;
}
