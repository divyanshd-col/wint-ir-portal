'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import type { AnalyticsFilters, InsightBlock, StreamChunk } from '@/lib/analytics/types';
import PageNav from '@/components/PageNav';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: InsightBlock[];
  logs?: string;
  loading?: boolean;
}

interface DispositionTree { disposition: string; subDispositions: string[] }
interface AgentOption { id: number; name: string }

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function resolveDateRange(
  range: string,
  customFrom: string,
  customTo: string,
): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const todayStr = isoDate(today);

  if (range === '7d') {
    const from = new Date(today); from.setDate(today.getDate() - 6);
    return { dateFrom: isoDate(from), dateTo: todayStr };
  }
  if (range === '15d') {
    const from = new Date(today); from.setDate(today.getDate() - 14);
    return { dateFrom: isoDate(from), dateTo: todayStr };
  }
  if (range === 'this_month') {
    return { dateFrom: todayStr.slice(0, 8) + '01', dateTo: todayStr };
  }
  if (range === 'last_month') {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last  = new Date(today.getFullYear(), today.getMonth(), 0);
    return { dateFrom: isoDate(first), dateTo: isoDate(last) };
  }
  if (range === 'custom') {
    if (customFrom && customTo) {
      const diff = (new Date(customTo).getTime() - new Date(customFrom).getTime()) / 86400_000;
      if (diff > 90) {
        const clamped = new Date(customTo); clamped.setDate(clamped.getDate() - 90);
        return { dateFrom: isoDate(clamped), dateTo: customTo };
      }
      return { dateFrom: customFrom, dateTo: customTo };
    }
    return { dateFrom: isoDate(new Date(today.getTime() - 6 * 86400_000)), dateTo: todayStr };
  }
  const from = new Date(today); from.setDate(today.getDate() - 6);
  return { dateFrom: isoDate(from), dateTo: todayStr };
}

// ── Inline markdown renderer ──────────────────────────────────────────────────

function renderInlineMd(text: string, keyPrefix: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let lastIndex = 0;
  let match;
  let k = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <strong key={`${keyPrefix}-b${k++}`} className="font-semibold text-gray-900">
          {match[1]}
        </strong>,
      );
    } else if (match[2] !== undefined) {
      parts.push(<em key={`${keyPrefix}-i${k++}`}>{match[2]}</em>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length === 1 ? parts[0] : parts;
}

function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let listKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    const Tag = listOrdered ? 'ol' : 'ul';
    result.push(
      <Tag key={`list-${listKey++}`} className={`my-2 space-y-1 ${listOrdered ? 'list-none' : 'list-none'}`}>
        {listItems.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-gray-700 leading-relaxed">
            <span className="text-emerald-600 shrink-0 mt-0.5 font-medium select-none">
              {listOrdered ? `${i + 1}.` : '•'}
            </span>
            <span>{renderInlineMd(item, `li-${listKey}-${i}`)}</span>
          </li>
        ))}
      </Tag>,
    );
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Unordered list
    if (/^[-*] /.test(line)) {
      if (listItems.length && listOrdered) flushList();
      listOrdered = false;
      listItems.push(line.slice(2));
      continue;
    }

    // Ordered list
    const orderedMatch = line.match(/^(\d+)\. (.+)/);
    if (orderedMatch) {
      if (listItems.length && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(orderedMatch[2]);
      continue;
    }

    flushList();

    // H2
    if (line.startsWith('## ')) {
      result.push(
        <h3 key={i} className="text-sm font-semibold text-gray-900 mt-4 mb-1.5 first:mt-0">
          {line.slice(3)}
        </h3>,
      );
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      result.push(
        <h4 key={i} className="text-xs font-semibold text-gray-500 uppercase tracking-wider mt-3 mb-1">
          {line.slice(4)}
        </h4>,
      );
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      result.push(<hr key={i} className="border-gray-100 my-3" />);
      continue;
    }

    // Blank line → small gap
    if (line.trim() === '') {
      result.push(<div key={i} className="h-1.5" />);
      continue;
    }

    // Normal paragraph
    result.push(
      <p key={i} className="text-sm text-gray-700 leading-relaxed">
        {renderInlineMd(line, `p-${i}`)}
      </p>,
    );
  }

  flushList();
  return <div className="space-y-0.5">{result}</div>;
}

// ── Thought process (collapsible logs) ───────────────────────────────────────

function ThoughtProcess({ logs, isStreaming }: { logs?: string; isStreaming?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!logs && !isStreaming) return null;
  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {isStreaming && !logs ? (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Thinking…
          </span>
        ) : isStreaming ? (
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            Working…
          </span>
        ) : (
          <span>Thought process</span>
        )}
      </button>
      {open && logs && (
        <div className="mt-2 font-mono text-[11px] text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5 whitespace-pre-wrap leading-relaxed border border-gray-100 max-h-80 overflow-y-auto">
          {logs}
        </div>
      )}
    </div>
  );
}

// ── Block renderer ────────────────────────────────────────────────────────────

function BlockRenderer({ block }: { block: InsightBlock }) {
  // filter_header no longer shown inline — it's handled by the filter bar
  if (block.type === 'filter_header') return null;

  if (block.type === 'stat_row') {
    const colorCls: Record<string, string> = {
      green:  'text-emerald-600',
      red:    'text-red-500',
      orange: 'text-orange-500',
    };
    return (
      <div className="flex flex-wrap gap-3 my-3">
        {block.stats.map((s, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl px-4 py-3 min-w-[100px] shadow-sm">
            <div className="text-[11px] text-gray-400 mb-0.5 font-medium">{s.label}</div>
            <div className={`text-xl font-semibold tracking-tight ${s.color ? colorCls[s.color] : 'text-gray-900'}`}>
              {s.value}
            </div>
            {s.sub && <div className="text-[11px] text-gray-400 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'bar_chart') {
    return (
      <div className="my-4">
        {block.title && (
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{block.title}</div>
        )}
        <div className="bg-white rounded-xl border border-gray-100 px-3 py-3 shadow-sm">
          <ResponsiveContainer width="100%" height={Math.min(48 + block.data.length * 32, 360)}>
            <BarChart data={block.data} layout="vertical" margin={{ left: 0, right: 28, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
                unit={block.unit ?? ''} />
              <YAxis type="category" dataKey="name" width={148} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v: any) => [`${v}${block.unit ?? ''}`, 'Value']}
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              />
              <Bar dataKey="value" fill="#2d6a4f" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (block.type === 'line_chart') {
    return (
      <div className="my-4">
        {block.title && (
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{block.title}</div>
        )}
        <div className="bg-white rounded-xl border border-gray-100 px-3 py-3 shadow-sm">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={block.data} margin={{ left: 0, right: 20, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f4" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit={block.unit ?? ''} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #f0f0f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
              />
              <Line type="monotone" dataKey="value" stroke="#2d6a4f" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (block.type === 'table') {
    return (
      <div className="my-4">
        {block.title && (
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{block.title}</div>
        )}
        <div className="overflow-x-auto rounded-xl border border-gray-100 shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-gray-50/80">
              <tr>
                {block.columns.map((col, i) => (
                  <th key={i} className="text-left px-3.5 py-2.5 text-gray-500 font-semibold whitespace-nowrap tracking-wide">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className={`border-t border-gray-50 ${ri % 2 === 0 ? '' : 'bg-gray-50/40'} hover:bg-emerald-50/30 transition-colors`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3.5 py-2.5 text-gray-700 whitespace-nowrap">{cell ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (block.type === 'insight') {
    const cls: Record<string, string> = {
      info:    'bg-blue-50 border-blue-100 text-blue-800',
      warning: 'bg-amber-50 border-amber-100 text-amber-800',
      danger:  'bg-red-50 border-red-100 text-red-800',
    };
    return (
      <div className={`rounded-xl border px-4 py-3 text-sm my-3 ${cls[block.severity ?? 'info']}`}>
        {block.text}
      </div>
    );
  }

  if (block.type === 'analysis_card') {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 my-3 shadow-sm space-y-3">
        {block.finding && (
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Finding</div>
            <p className="text-sm text-gray-800 leading-relaxed font-medium">{block.finding}</p>
          </div>
        )}
        {block.evidence && block.evidence.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Evidence</div>
            <ul className="space-y-1.5">
              {block.evidence.map((e, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2 leading-relaxed">
                  <span className="text-emerald-600 shrink-0 font-medium">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(block.coverage || block.caveats) && (
          <div className="pt-2 border-t border-gray-50 text-[11px] text-gray-400 space-y-0.5">
            {block.coverage && <p>{block.coverage}</p>}
            {block.caveats  && <p className="italic">{block.caveats}</p>}
          </div>
        )}
      </div>
    );
  }

  if (block.type === 'theme_card') {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 my-3 shadow-sm">
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{block.name}</h3>
          <span className="text-xs text-gray-400 whitespace-nowrap shrink-0 bg-gray-50 px-2 py-0.5 rounded-full">
            {block.count} chats · {block.pct}%
          </span>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed mb-2">{block.description}</p>
        {block.topParams.length > 0 && (
          <p className="text-[11px] text-red-500 font-medium">
            Failing: {block.topParams.join(', ')}
          </p>
        )}
      </div>
    );
  }

  return null;
}

// ── Example chips ─────────────────────────────────────────────────────────────

const EXAMPLE_QUERIES = [
  'What are the top issues causing bad CSAT this week?',
  'Show CSAT distribution for the last 15 days',
  'Which agent has the most bad-CSAT conversations?',
  'Show disposition breakdown for this month',
  'What is the bot vs agent resolution time?',
  'Which IQS parameters are failing most often?',
];

// ── Multi-select dropdown ─────────────────────────────────────────────────────

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (v: string) => {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  };

  const displayLabel = value.length === 0 ? `All ${label}` :
    value.length === 1 ? options.find(o => o.value === value[0])?.label ?? value[0] :
    `${value.length} ${label}`;

  const isActive = value.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`h-7 px-2.5 text-xs rounded-lg flex items-center gap-1 whitespace-nowrap transition-colors border ${
          isActive
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        {displayLabel}
        <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[160px] max-h-52 overflow-y-auto py-1">
          {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="accent-emerald-600"
              />
              {opt.label}
            </label>
          ))}
          {value.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border-t border-gray-100 mt-1"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Disposition multi-select ──────────────────────────────────────────────────

function DispositionSelect({
  trees,
  value,
  onChange,
}: {
  trees: DispositionTree[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (d: string) => onChange(value.includes(d) ? value.filter(x => x !== d) : [...value, d]);

  const label = value.length === 0 ? 'All Dispositions' :
    value.length === 1 ? value[0] : `${value.length} Dispositions`;

  const isActive = value.length > 0;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`h-7 px-2.5 text-xs rounded-lg flex items-center gap-1 whitespace-nowrap max-w-[160px] truncate transition-colors border ${
          isActive
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium'
            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
        }`}
      >
        <span className="truncate">{label}</span>
        <svg className="w-3 h-3 opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-xl shadow-lg w-52 max-h-64 overflow-y-auto py-1">
          {trees.map(t => (
            <label key={t.disposition} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs font-medium">
              <input
                type="checkbox"
                checked={value.includes(t.disposition)}
                onChange={() => toggle(t.disposition)}
                className="accent-emerald-600"
              />
              {t.disposition}
            </label>
          ))}
          {value.length > 0 && (
            <button onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border-t border-gray-100 mt-1">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface InsightsChatClientProps {
  username?: string;
  role?: string;
  isAdmin?: boolean;
}

export default function InsightsChatClient({ username = 'admin', role = 'admin', isAdmin = true }: InsightsChatClientProps) {
  // Filter bar state
  const [dateRange, setDateRange] = useState<'7d' | '15d' | 'this_month' | 'last_month' | 'custom'>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [csatLabels, setCsatLabels]     = useState<string[]>(['good', 'bad', 'could_be_better']);
  const [convTypes, setConvTypes]       = useState<string[]>([]);
  const [minUserMsgs, setMinUserMsgs]   = useState<number | null>(null);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);

  const [dispTrees, setDispTrees] = useState<DispositionTree[]>([]);
  const [agentOptions]            = useState<AgentOption[]>([]);

  // Multi-chat state
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string }>>(() =>
    [{ id: 'chat-1', title: 'New chat' }],
  );
  const [activeId, setActiveId] = useState('chat-1');
  const [allMessages, setAllMessages] = useState<Record<string, ChatMessage[]>>({});
  const activeIdRef = useRef(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  const messages = allMessages[activeId] ?? [];
  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setAllMessages(prev => {
      const id = activeIdRef.current;
      const current = prev[id] ?? [];
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [id]: next };
    });
  }, []);

  // Chat input / streaming state
  const [input, setInput]         = useState('');
  const [streaming, setStreaming] = useState(false);
  const [maxConversations, setMaxConversations] = useState(60);

  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLTextAreaElement>(null);
  const isInitialLoad = useRef(true);

  // Derived: non-default filters active
  const defaultCsat = ['good', 'bad', 'could_be_better'];
  const hasNonDefaultFilters =
    dateRange !== '7d' ||
    dispositions.length > 0 ||
    convTypes.length > 0 ||
    minUserMsgs != null ||
    csatLabels.length !== defaultCsat.length ||
    !csatLabels.every(c => defaultCsat.includes(c));

  const resetFilters = () => {
    setDateRange('7d');
    setCustomFrom('');
    setCustomTo('');
    setDispositions([]);
    setCsatLabels(['good', 'bad', 'could_be_better']);
    setConvTypes([]);
    setMinUserMsgs(null);
  };

  function newChat() {
    if (streaming) return;
    const id = crypto.randomUUID();
    setChatSessions(prev => [...prev, { id, title: 'New chat' }]);
    setActiveId(id);
    activeIdRef.current = id;
  }

  function closeChat(id: string) {
    if (streaming || chatSessions.length === 1) return;
    const idx = chatSessions.findIndex(s => s.id === id);
    const remaining = chatSessions.filter(s => s.id !== id);
    setChatSessions(remaining);
    if (id === activeId) {
      const next = remaining[Math.max(0, idx - 1)];
      setActiveId(next.id);
      activeIdRef.current = next.id;
    }
    setAllMessages(prev => { const { [id]: _, ...rest } = prev; return rest; });
  }

  // Load dispositions + session history on mount
  useEffect(() => {
    fetch('/api/analytics/dispositions')
      .then(r => r.json())
      .then(d => { if (d.dispositions) setDispTrees(d.dispositions); })
      .catch(() => {});

    fetch('/api/analytics/history')
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.history) && d.history.length) {
          // Sort oldest-first so newest is at bottom
          const sorted = [...d.history].sort(
            (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
          );
          const loaded: ChatMessage[] = sorted.flatMap((h: any) => [
            { id: h.id + '-u', role: 'user' as const, content: h.message, blocks: [] },
            { id: h.id + '-a', role: 'assistant' as const, content: h.response || '', blocks: h.blocks || [] },
          ]);
          setMessages(loaded);
        }
      })
      .catch(() => {});
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (isInitialLoad.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
      isInitialLoad.current = false;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  function buildFilters(): AnalyticsFilters {
    const { dateFrom, dateTo } = resolveDateRange(dateRange, customFrom, customTo);
    return {
      dateFrom,
      dateTo,
      dispositions,
      subDispositions: [],
      teams: [],
      csatLabels,
      conversationTypes: convTypes,
      agentIds: [],
      minUserMessages: minUserMsgs,
    };
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    // Auto-title the session from the first message sent in it
    setChatSessions(prev => prev.map(s =>
      s.id === activeIdRef.current && s.title === 'New chat'
        ? { ...s, title: text.slice(0, 36) + (text.length > 36 ? '…' : '') }
        : s,
    ));

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      blocks: [],
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      blocks: [],
      logs: '',
      loading: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    let accText = '';
    let accLogs = '';
    const accBlocks: InsightBlock[] = [];

    const priorContext = (() => {
      const assistantMsgs = messages.filter(m => m.role === 'assistant' && m.content);
      return assistantMsgs.length ? assistantMsgs[assistantMsgs.length - 1].content : undefined;
    })();

    const activeFilters = buildFilters();

    // Helper: read an SSE stream and update message state
    async function readSseStream(res: Response) {
      if (!res.body) throw new Error('No response body');
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let chunk: StreamChunk;
          try { chunk = JSON.parse(raw); } catch { continue; }

          if (chunk.event === 'text') {
            accText += chunk.delta;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accText } : m));
          }
          if (chunk.event === 'log') {
            accLogs += chunk.delta;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, logs: accLogs } : m));
          }
          if (chunk.event === 'blocks') {
            accBlocks.push(...chunk.blocks);
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, blocks: [...accBlocks] } : m));
          }
          if (chunk.event === 'error') {
            accText += `\n\nError: ${chunk.message}`;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accText, loading: false } : m));
          }
          if (chunk.event === 'done') {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, loading: false } : m));
          }
        }
      }
    }

    try {
      // ── Phase 1: Plan + SQL (JSON, fast) ──────────────────────────────────
      accLogs += 'Planning query…\n';
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, logs: accLogs } : m));

      const planRes = await fetch('/api/analytics/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, filters: activeFilters, priorContext, maxConversations }),
      });
      if (!planRes.ok) throw new Error(planRes.statusText || 'Plan request failed');
      const planData = await planRes.json();

      if (planData.status === 'clarify') {
        accText = planData.question;
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accText, loading: false } : m));
        return;
      }
      if (planData.status === 'error') {
        throw new Error(planData.message ?? 'Plan failed');
      }

      // SQL-only question — answer already complete from phase 1
      if (planData.status === 'complete') {
        accText = planData.answer_text ?? '';
        const blocks: InsightBlock[] = Array.isArray(planData.blocks) ? planData.blocks : [];
        setMessages(prev => prev.map(m => m.id === assistantId
          ? { ...m, content: accText, blocks, loading: false }
          : m,
        ));
        return;
      }

      // ── Phase 2: Transcripts + parallel summarise + synthesis (SSE) ────────

      const insightsRes = await fetch('/api/analytics/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message:           text,
          intent:            planData.intent,
          output_shape:      planData.output_shape,
          transcript_intent: planData.transcript_intent,
          transcript_ids:    planData.transcript_ids,
          sql_results:       planData.sql_results,
          filters:           activeFilters,
        }),
      });
      if (!insightsRes.ok) throw new Error(insightsRes.statusText || 'Insights request failed');
      await readSseStream(insightsRes);

    } catch (err: any) {
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${err.message}`, loading: false } : m),
      );
    } finally {
      setStreaming(false);
    }
  }, [streaming, dateRange, customFrom, customTo, dispositions, csatLabels, convTypes, activeId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  const csatOptions = [
    { value: 'bad', label: 'Bad' },
    { value: 'could_be_better', label: 'Could Be Better' },
    { value: 'good', label: 'Good' },
  ];
  const typeOptions = [
    { value: 'bot',    label: 'Bot' },
    { value: 'agent',  label: 'Agent' },
    { value: 'hybrid', label: 'Hybrid' },
  ];

  // Active filter summary chips
  const filterChips: { label: string; onRemove: () => void }[] = [];
  if (dateRange !== '7d') {
    const labels: Record<string, string> = { '15d': 'Last 15d', this_month: 'This month', last_month: 'Last month', custom: 'Custom range' };
    filterChips.push({ label: labels[dateRange] ?? dateRange, onRemove: () => setDateRange('7d') });
  }
  dispositions.forEach(d => filterChips.push({ label: d, onRemove: () => setDispositions(prev => prev.filter(x => x !== d)) }));
  convTypes.forEach(t => filterChips.push({ label: t.charAt(0).toUpperCase() + t.slice(1), onRemove: () => setConvTypes(prev => prev.filter(x => x !== t)) }));
  if (!csatLabels.every(c => defaultCsat.includes(c)) || csatLabels.length !== defaultCsat.length) {
    filterChips.push({ label: `CSAT: ${csatLabels.join(', ')}`, onRemove: () => setCsatLabels(defaultCsat) });
  }
  if (minUserMsgs != null) {
    filterChips.push({ label: `>=${minUserMsgs} user msgs`, onRemove: () => setMinUserMsgs(null) });
  }

  return (
    <div className="flex h-screen bg-[#1a1a1a]">
      {/* Sidebar */}
      <PageNav username={username} role={role} isAdmin={isAdmin} />

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0 bg-[#f5f3ee]">

        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-sm font-semibold text-gray-900">Insight Chat</h1>
            <p className="text-xs text-gray-400">Ask questions about CX conversation data</p>
          </div>
          {hasNonDefaultFilters && (
            <button
              onClick={resetFilters}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Reset filters
            </button>
          )}
        </div>

        {/* Chat tabs */}
        <div className="bg-white border-b border-gray-100 px-4 py-2 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {chatSessions.map(session => (
            <button
              key={session.id}
              onClick={() => { if (!streaming) { setActiveId(session.id); activeIdRef.current = session.id; } }}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all max-w-[180px] ${
                session.id === activeId
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <span className="truncate">{session.title}</span>
              {chatSessions.length > 1 && (
                <span
                  onClick={e => { e.stopPropagation(); closeChat(session.id); }}
                  className={`shrink-0 ml-0.5 text-[14px] leading-none ${session.id === activeId ? 'opacity-60 hover:opacity-100' : 'opacity-30 hover:opacity-60'}`}
                >×</span>
              )}
            </button>
          ))}
          <button
            onClick={newChat}
            disabled={streaming}
            title="New chat"
            className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-500 hover:bg-gray-200 disabled:opacity-40 transition"
          >
            + New
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-white border-b border-gray-100 px-6 py-2.5 shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Time Range dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowTimeDropdown(v => !v)}
                className={`flex items-center gap-1.5 h-7 px-3 text-[11px] border rounded-lg transition font-medium ${
                  showTimeDropdown ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="3" width="12" height="11" rx="1.5"/>
                  <path d="M5 1v3M11 1v3M2 7h12"/>
                </svg>
                {({ '7d': '7 days', '15d': '15 days', 'this_month': 'This month', 'last_month': 'Last month', 'custom': customFrom && customTo ? `${customFrom} → ${customTo}` : 'Custom' } as Record<string, string>)[dateRange]}
                <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><path d="M2 3l3 3 3-3" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
              </button>
              {showTimeDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg z-50 p-1.5 min-w-[160px]">
                  {([
                    { id: '7d',         label: '7 days' },
                    { id: '15d',        label: '15 days' },
                    { id: 'this_month', label: 'This month' },
                    { id: 'last_month', label: 'Last month' },
                    { id: 'custom',     label: 'Custom range' },
                  ] as const).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setDateRange(opt.id); if (opt.id !== 'custom') setShowTimeDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition ${
                        dateRange === opt.id ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {dateRange === 'custom' && (
                    <div className="px-2 pt-2 pb-1 border-t border-gray-100 mt-1 space-y-1.5">
                      <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                        className="w-full h-7 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-emerald-300" />
                      <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                        className="w-full h-7 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-emerald-300" />
                      <button onClick={() => setShowTimeDropdown(false)}
                        className="w-full py-1.5 bg-emerald-600 text-white text-xs rounded-lg font-semibold mt-0.5 hover:bg-emerald-700 transition">
                        Apply
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="w-px h-5 bg-gray-200 mx-0.5" />

            <DispositionSelect trees={dispTrees} value={dispositions} onChange={setDispositions} />

            <MultiSelect label="CSAT" options={csatOptions} value={csatLabels} onChange={setCsatLabels} />
            <MultiSelect label="Types" options={typeOptions} value={convTypes} onChange={setConvTypes} />

            {/* Min user messages filter */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-gray-500 font-semibold whitespace-nowrap">≥</span>
              <input
                type="number"
                min={1}
                max={200}
                value={minUserMsgs ?? ''}
                onChange={e => setMinUserMsgs(e.target.value ? parseInt(e.target.value) : null)}
                placeholder="7"
                title="Minimum user messages"
                className="w-12 text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-center bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              <span className="text-[11px] text-gray-400 whitespace-nowrap">user msgs</span>
            </div>
          </div>
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && (
            <div className="max-w-2xl mx-auto mt-10">
              <p className="text-sm text-gray-400 text-center mb-6">
                Ask anything about your CX conversations
              </p>
              <div className="grid grid-cols-2 gap-2">
                {EXAMPLE_QUERIES.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(q)}
                    className="text-left text-xs text-gray-600 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors leading-relaxed"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="max-w-3xl mx-auto space-y-5">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'user' ? (
                  <div className="max-w-[72%] bg-[#1a3a2a] text-white rounded-2xl rounded-tr-md px-4 py-3 text-sm leading-relaxed shadow-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div className="flex-1 min-w-0">
                    {/* Thought process / loading */}
                    <ThoughtProcess
                      logs={msg.logs}
                      isStreaming={!!(msg.loading && (msg.logs !== undefined))}
                    />

                    {/* Loading state — no content yet */}
                    {msg.loading && !msg.content && !msg.blocks.length && !msg.logs && (
                      <div className="flex items-center gap-2 text-xs text-gray-400 py-1">
                        <span className="flex gap-1">
                          <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:150ms]" />
                          <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:300ms]" />
                        </span>
                      </div>
                    )}

                    {/* Rendered answer text */}
                    {msg.content && (
                      <div className="mb-1">
                        {renderMarkdown(msg.content)}
                      </div>
                    )}

                    {/* Visual blocks */}
                    {msg.blocks.map((block, bi) => (
                      <BlockRenderer key={bi} block={block} />
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Premium input area */}
        <div className="bg-white border-t border-gray-100 px-6 py-5 shrink-0">
          <div className="max-w-3xl mx-auto">

            {/* Active filter chips */}
            {filterChips.length > 0 && (
              <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                <span className="text-[11px] text-gray-400 font-medium">Active filters:</span>
                {filterChips.map((chip, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-full px-2.5 py-0.5 font-medium"
                  >
                    {chip.label}
                    <button
                      onClick={chip.onRemove}
                      className="hover:text-red-500 transition-colors ml-0.5 leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button
                  onClick={resetFilters}
                  className="text-[11px] text-gray-400 hover:text-red-500 transition-colors underline ml-1"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Input box */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_2px_16px_rgba(0,0,0,0.06)] focus-within:border-emerald-400 focus-within:shadow-[0_2px_20px_rgba(45,158,79,0.10)] transition-all duration-200">
              <div className="px-4 pt-4 pb-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about CSAT, agent performance, IQS trends, dispositions…"
                  rows={1}
                  className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 resize-none outline-none min-h-[28px] max-h-40 overflow-y-auto leading-relaxed"
                  disabled={streaming}
                  style={{ lineHeight: '1.6' }}
                />
              </div>
              <div className="flex items-center justify-between px-3 pb-3 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 select-none">
                    Enter to send · Shift+Enter for new line
                  </span>
                  <label className="flex items-center gap-1 text-[11px] text-gray-500 select-none">
                    Max chats:
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={maxConversations}
                      onChange={e => setMaxConversations(Math.max(1, parseInt(e.target.value) || 1))}
                      className={`w-16 text-[11px] text-center border rounded px-1 py-0.5 outline-none focus:border-emerald-400 transition-colors ${
                        maxConversations > 60
                          ? 'border-amber-300 bg-amber-50 text-amber-700'
                          : 'border-gray-200 bg-gray-50 text-gray-600'
                      }`}
                      title="Number of conversations to read transcripts for. Higher = slower but more thorough."
                    />
                  </label>
                </div>
                <button
                  onClick={() => sendMessage(input)}
                  disabled={streaming || !input.trim()}
                  className="flex items-center gap-1.5 bg-[#1a3a2a] hover:bg-[#0f2a1a] active:bg-[#0a1f14] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-4 py-1.5 rounded-xl transition-all shadow-sm"
                >
                  {streaming ? (
                    <>
                      <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                      <span>Thinking</span>
                    </>
                  ) : (
                    <>
                      <span>Send</span>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
