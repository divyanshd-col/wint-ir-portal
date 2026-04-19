'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts';
import type { AnalyticsFilters, InsightBlock, StreamChunk } from '@/lib/analytics/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks: InsightBlock[];
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
    // Clamp to max 90 days
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
  // default 7d
  const from = new Date(today); from.setDate(today.getDate() - 6);
  return { dateFrom: isoDate(from), dateTo: todayStr };
}

// ── Block renderer ────────────────────────────────────────────────────────────

function BlockRenderer({ block }: { block: InsightBlock }) {
  if (block.type === 'filter_header') {
    return (
      <div className="text-[11px] text-gray-400 bg-gray-50 rounded-md px-3 py-1.5 mb-2 border border-gray-100 leading-relaxed">
        Showing: {block.summary}
      </div>
    );
  }

  if (block.type === 'stat_row') {
    const colorCls: Record<string, string> = {
      green: 'text-emerald-600',
      red:   'text-red-600',
      orange:'text-orange-500',
    };
    return (
      <div className="flex flex-wrap gap-3 my-2">
        {block.stats.map((s, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl px-4 py-3 min-w-[100px]">
            <div className="text-[11px] text-gray-400 mb-0.5">{s.label}</div>
            <div className={`text-lg font-semibold ${s.color ? colorCls[s.color] : 'text-gray-900'}`}>{s.value}</div>
            {s.sub && <div className="text-[11px] text-gray-400 mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>
    );
  }

  if (block.type === 'bar_chart') {
    return (
      <div className="my-3">
        {block.title && <div className="text-xs font-medium text-gray-600 mb-1">{block.title}</div>}
        <ResponsiveContainer width="100%" height={Math.min(40 + block.data.length * 28, 320)}>
          <BarChart data={block.data} layout="vertical" margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
            <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false}
              unit={block.unit ?? ''} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: any) => [`${v}${block.unit ?? ''}`, 'Value']} />
            <Bar dataKey="value" fill="#2d6a4f" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (block.type === 'line_chart') {
    return (
      <div className="my-3">
        {block.title && <div className="text-xs font-medium text-gray-600 mb-1">{block.title}</div>}
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={block.data} margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} unit={block.unit ?? ''} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#2d6a4f" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (block.type === 'table') {
    return (
      <div className="my-3">
        {block.title && <div className="text-xs font-medium text-gray-600 mb-1">{block.title}</div>}
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                {block.columns.map((col, i) => (
                  <th key={i} className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-gray-50 hover:bg-gray-50/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-gray-700 whitespace-nowrap">{cell ?? '—'}</td>
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
      <div className={`rounded-lg border px-3 py-2 text-xs my-2 ${cls[block.severity ?? 'info']}`}>
        {block.text}
      </div>
    );
  }

  if (block.type === 'theme_card') {
    return (
      <div className="bg-white border border-gray-100 rounded-xl p-4 my-2 shadow-sm">
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{block.name}</h3>
          <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">
            {block.count} chats · {block.pct}%
          </span>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed mb-2">{block.description}</p>
        {block.topParams.length > 0 && (
          <p className="text-[11px] text-red-600">
            Top failing parameters: {block.topParams.join(', ')}
          </p>
        )}
        {block.examplesAvailable && (
          <button className="text-[11px] text-emerald-700 mt-2 underline">
            Show examples
          </button>
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="h-7 px-2.5 text-xs bg-white border border-gray-200 rounded-lg hover:border-gray-300 flex items-center gap-1 whitespace-nowrap"
      >
        {displayLabel}
        <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[160px] max-h-52 overflow-y-auto py-1">
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
            <button onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600 border-t border-gray-100 mt-1">
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="h-7 px-2.5 text-xs bg-white border border-gray-200 rounded-lg hover:border-gray-300 flex items-center gap-1 whitespace-nowrap max-w-[160px] truncate"
      >
        <span className="truncate">{label}</span>
        <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-52 max-h-64 overflow-y-auto py-1">
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

export default function InsightsChatClient() {
  // Filter bar state
  const [dateRange, setDateRange] = useState<'7d' | '15d' | 'this_month' | 'last_month' | 'custom'>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');
  const [dispositions, setDispositions] = useState<string[]>([]);
  const [csatLabels, setCsatLabels]     = useState<string[]>(['bad', 'could_be_better']);
  const [convTypes, setConvTypes]       = useState<string[]>([]);

  // Available options (from API)
  const [dispTrees, setDispTrees]   = useState<DispositionTree[]>([]);
  const [agentOptions]              = useState<AgentOption[]>([]); // future use

  // Chat state
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [input, setInput]         = useState('');
  const [streaming, setStreaming] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

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
          const loaded: ChatMessage[] = d.history.flatMap((h: any) => [
            { id: h.id + '-u', role: 'user' as const, content: h.message, blocks: [] },
            { id: h.id + '-a', role: 'assistant' as const, content: h.response || '', blocks: h.blocks || [] },
          ]);
          setMessages(loaded);
        }
      })
      .catch(() => {});
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    };
  }

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

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
      loading: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    let accText = '';
    const accBlocks: InsightBlock[] = [];

    try {
      const res = await fetch('/api/analytics/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, filters: buildFilters() }),
      });

      if (!res.ok || !res.body) {
        throw new Error(res.statusText || 'Request failed');
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text2 = decoder.decode(value);
        const lines = text2.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let chunk: StreamChunk;
          try { chunk = JSON.parse(raw); } catch { continue; }

          if (chunk.event === 'text') {
            accText += chunk.delta;
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, content: accText } : m),
            );
          }
          if (chunk.event === 'blocks') {
            accBlocks.push(...chunk.blocks);
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, blocks: [...accBlocks] } : m),
            );
          }
          if (chunk.event === 'error') {
            accText += `\n\nError: ${chunk.message}`;
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, content: accText, loading: false } : m),
            );
          }
          if (chunk.event === 'done') {
            setMessages(prev =>
              prev.map(m => m.id === assistantId ? { ...m, loading: false } : m),
            );
          }
        }
      }
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Error: ${err.message}`, loading: false }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
    }
  }, [streaming, dateRange, customFrom, customTo, dispositions, csatLabels, convTypes]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
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

  return (
    <div className="flex flex-col h-screen bg-[#f5f3ee]">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Insight Chat</h1>
          <p className="text-xs text-gray-400">Ask questions about CX conversation data</p>
        </div>
        <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
          Admin
        </span>
      </div>

      {/* Filter bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-2.5 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Date range */}
          <div className="flex items-center gap-1 bg-gray-50 rounded-lg p-0.5">
            {(['7d', '15d', 'this_month', 'last_month', 'custom'] as const).map(r => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`h-6 px-2 text-[11px] rounded-md transition-colors ${
                  dateRange === r ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {r === 'this_month' ? 'This month' : r === 'last_month' ? 'Last month' : r === 'custom' ? 'Custom' : r}
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          {dateRange === 'custom' && (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="h-7 px-2 text-xs border border-gray-200 rounded-lg"
              />
              <span className="text-xs text-gray-400">→</span>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="h-7 px-2 text-xs border border-gray-200 rounded-lg"
              />
            </div>
          )}

          <div className="w-px h-5 bg-gray-200 mx-1" />

          <DispositionSelect trees={dispTrees} value={dispositions} onChange={setDispositions} />

          <MultiSelect
            label="CSAT"
            options={csatOptions}
            value={csatLabels}
            onChange={setCsatLabels}
          />
          <MultiSelect
            label="Types"
            options={typeOptions}
            value={convTypes}
            onChange={setConvTypes}
          />
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && (
          <div className="max-w-2xl mx-auto mt-12">
            <p className="text-sm text-gray-400 text-center mb-6">
              Ask anything about your CX conversations
            </p>
            <div className="grid grid-cols-2 gap-2">
              {EXAMPLE_QUERIES.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-left text-xs text-gray-600 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[75%] bg-emerald-700 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
                  {msg.content}
                </div>
              ) : (
                <div className="flex-1 min-w-0">
                  {msg.loading && !msg.content && !msg.blocks.length && (
                    <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                      <span className="animate-pulse">Analysing…</span>
                    </div>
                  )}
                  {msg.content && (
                    <p className="text-sm text-gray-700 leading-relaxed mb-2 whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  )}
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

      {/* Input area */}
      <div className="bg-white border-t border-gray-100 px-6 py-4 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 items-end bg-gray-50 border border-gray-200 rounded-2xl px-4 py-2 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-100 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about CSAT, dispositions, agent performance, IQS trends…"
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 resize-none outline-none min-h-[20px] max-h-24 overflow-y-auto"
              style={{ lineHeight: '1.5' }}
              disabled={streaming}
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={streaming || !input.trim()}
              className="shrink-0 w-8 h-8 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-gray-400 text-center mt-1.5">
            Enter to send · Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
