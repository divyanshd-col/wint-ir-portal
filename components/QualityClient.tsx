'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSScoreEntry, ParamScore } from '@/lib/quality';

// ── Helpers ──────────────────────────────────────────────────────────────────
function scoreColor(iqs: number) {
  if (iqs >= 90) return '#16a34a';
  if (iqs >= 80) return '#d97706';
  if (iqs >= 70) return '#ea580c';
  return '#dc2626';
}

function badge(val: ParamScore | undefined) {
  if (val === 'Yes') return <span className="text-green-600 font-bold">✓</span>;
  if (val === 'No')  return <span className="text-red-500 font-bold">✗</span>;
  if (val === 'NA')  return <span className="text-gray-400">—</span>;
  return <span className="text-gray-300">?</span>;
}

function IQSBadge({ iqs }: { iqs: number }) {
  return (
    <span className="font-bold text-sm" style={{ color: scoreColor(iqs) }}>{iqs}%</span>
  );
}

// ── CSV Parser ───────────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // Simple CSV parse — handles quoted fields with commas
    const values: string[] = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; }
      else if (line[i] === ',' && !inQuotes) { values.push(cur); cur = ''; }
      else cur += line[i];
    }
    values.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim().replace(/^"|"$/g, ''); });
    return row;
  });
}

// ── AgentStatsRow ─────────────────────────────────────────────────────────────
interface AgentStat { agent: string; chats: number; avgIqs: number; minIqs: number; maxIqs: number; high: number; atRisk: number; }

// ── ScoreDetail ───────────────────────────────────────────────────────────────
function ScoreDetail({ entry, onClose }: { entry: IQSScoreEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold" style={{ color: scoreColor(entry.iqs) }}>{entry.iqs}%</span>
              <span className="text-gray-500 text-sm font-medium">IQS — Chat {entry.chatId}</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {entry.agentName && <><span className="font-semibold text-gray-600">{entry.agentName}</span> · </>}
              {entry.scoredAt.slice(0, 10)} · {entry.provider}/{entry.model}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2l12 12M14 2L2 14"/></svg>
          </button>
        </div>
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Param scores */}
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Parameter Scores</h3>
            <div className="space-y-2">
              {PARAM_ORDER.map(p => (
                <div key={p} className="flex items-start gap-2">
                  <div className="w-4 mt-0.5 shrink-0">{badge(entry.scores[p])}</div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">{PARAM_NAMES[p]}</span>
                      <span className="text-[10px] text-gray-400">{Math.round(WEIGHTS[p] * 100)}%</span>
                    </div>
                    {entry.reasoning[p] && (
                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{entry.reasoning[p]}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Summary + transcript */}
          <div className="space-y-4">
            {entry.summary && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Summary</h3>
                <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-xl px-4 py-3">{entry.summary}</p>
              </div>
            )}
            {entry.tags && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Tags</h3>
                <p className="text-sm text-gray-600">{entry.tags}</p>
              </div>
            )}
            {entry.transcript && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Transcript</h3>
                <pre className="text-[11px] text-gray-600 bg-gray-50 rounded-xl px-4 py-3 whitespace-pre-wrap max-h-64 overflow-y-auto leading-relaxed">{entry.transcript}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function QualityClient() {
  const [tab, setTab] = useState<'upload' | 'performance' | 'log'>('upload');

  // Upload tab state
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [colTranscript, setColTranscript] = useState('');
  const [colChatId, setColChatId] = useState('');
  const [colAgent, setColAgent] = useState('');
  const [colTags, setColTags] = useState('');
  const [colDate, setColDate] = useState('');
  const [colCsat, setColCsat] = useState('');
  const [rowLimit, setRowLimit] = useState(0);
  const [scoring, setScoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [batchResults, setBatchResults] = useState<IQSScoreEntry[]>([]);
  const [batchErrors, setBatchErrors] = useState<{ row: number; chatId: string; error: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Performance + log state
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

  // Detail modal
  const [detailEntry, setDetailEntry] = useState<IQSScoreEntry | null>(null);

  const loadScores = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterAgent) params.set('agent', filterAgent);
      if (filterMin > 0) params.set('minScore', String(filterMin));
      if (filterMax < 100) params.set('maxScore', String(filterMax));
      if (filterTag) params.set('tag', filterTag);
      const data = await fetch(`/api/quality/scores?${params}`).then(r => r.json());
      setEntries(data.entries || []);
      setAgentStats(data.agentStats || []);
      setParamFails(data.paramFails || {});
      setAvailableAgents(data.availableAgents || []);
      setLogsLoaded(true);
    } catch {}
    setLogsLoading(false);
  }, [filterAgent, filterMin, filterMax, filterTag]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBatchResults([]);
    setBatchErrors([]);
    setProgress(0);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length) {
        setCsvRows(rows);
        const headers = Object.keys(rows[0]);
        setCsvHeaders(headers);
        // Auto-detect common column names
        const lc = (s: string) => s.toLowerCase();
        setColTranscript(headers.find(h => lc(h).includes('transcript') || lc(h).includes('chat') || lc(h).includes('message')) || '');
        setColChatId(headers.find(h => lc(h).includes('id')) || '');
        setColAgent(headers.find(h => lc(h).includes('agent') || lc(h).includes('name')) || '');
        setColTags(headers.find(h => lc(h).includes('tag')) || '');
        setColDate(headers.find(h => lc(h).includes('date')) || '');
        setColCsat(headers.find(h => lc(h).includes('csat') || lc(h).includes('rating')) || '');
      }
    };
    reader.readAsText(file);
  };

  const runBatch = async () => {
    if (!csvRows.length || !colTranscript) return;
    setScoring(true);
    setBatchResults([]);
    setBatchErrors([]);
    const toScore = rowLimit > 0 ? csvRows.slice(0, rowLimit) : csvRows;
    const results: IQSScoreEntry[] = [];
    const errors: { row: number; chatId: string; error: string }[] = [];

    for (let i = 0; i < toScore.length; i++) {
      const row = toScore[i];
      const transcript = row[colTranscript] || '';
      const chatId = colChatId ? row[colChatId] : `row_${i + 1}`;
      setProgressLabel(`Scoring ${i + 1}/${toScore.length}: ${chatId}`);
      setProgress(Math.round(((i + 1) / toScore.length) * 100));

      if (!transcript.trim() || transcript === 'nan' || transcript === 'None') {
        errors.push({ row: i + 1, chatId, error: 'Empty transcript' });
        continue;
      }

      try {
        const res = await fetch('/api/quality/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            chatId,
            agentName: colAgent ? row[colAgent] : '',
            tags: colTags ? row[colTags] : '',
            date: colDate ? row[colDate] : '',
            csat: colCsat ? row[colCsat] : '',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Score failed');
        results.push(data.entry);
      } catch (err: any) {
        errors.push({ row: i + 1, chatId, error: err.message });
      }
    }

    setBatchResults(results);
    setBatchErrors(errors);
    setProgressLabel(`Done — ${results.length} scored, ${errors.length} errors`);
    setScoring(false);
    setLogsLoaded(false); // refresh on next tab visit
  };

  const exportCSV = () => {
    if (!batchResults.length) return;
    const headers = ['Chat ID', 'Agent', 'IQS', 'Tags', 'CSAT', ...PARAM_ORDER, 'Summary'];
    const rows = batchResults.map(e => [
      e.chatId, e.agentName, e.iqs, e.tags || '', e.csat || '',
      ...PARAM_ORDER.map(p => e.scores[p] || ''),
      e.summary,
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `iqs_scores_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const avgIqs = batchResults.length ? Math.round(batchResults.reduce((s, e) => s + e.iqs, 0) / batchResults.length) : 0;

  // Trigger load when switching to performance or log tab
  const switchTab = (t: typeof tab) => {
    setTab(t);
    if ((t === 'performance' || t === 'log') && !logsLoaded) {
      loadScores();
    }
  };

  const maxFailRate = Math.max(...Object.values(paramFails), 1);

  return (
    <div className="h-screen flex flex-col bg-gray-50 font-sans antialiased">
      {detailEntry && <ScoreDetail entry={detailEntry} onClose={() => setDetailEntry(null)} />}

      {/* Header */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4L6 9l5 5"/>
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-bold text-gray-900 tracking-tight">Quality Scoring</h1>
            <p className="text-xs text-gray-400">Wint Wealth · IQS Dashboard</p>
          </div>
        </div>
        <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
          {(['upload', 'performance', 'log'] as const).map(t => (
            <button
              key={t}
              onClick={() => switchTab(t)}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition capitalize ${tab === t ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t === 'upload' ? 'Upload & Score' : t === 'performance' ? 'Agent Performance' : 'Score Log'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── UPLOAD TAB ── */}
        {tab === 'upload' && (
          <div className="max-w-4xl mx-auto space-y-5">
            {/* File upload */}
            <div
              className="bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 text-center cursor-pointer hover:border-[#2d6a4f]/40 hover:bg-[#2d6a4f]/5 transition"
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
              <svg className="mx-auto mb-3 text-gray-300" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
              {fileName ? (
                <p className="text-sm font-semibold text-gray-800">{fileName} <span className="text-gray-400 font-normal">({csvRows.length} rows)</span></p>
              ) : (
                <>
                  <p className="text-sm font-semibold text-gray-700">Upload CSV file</p>
                  <p className="text-xs text-gray-400 mt-1">Click to browse or drag and drop</p>
                </>
              )}
            </div>

            {csvRows.length > 0 && (
              <>
                {/* Column mapping */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Column Mapping</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {[
                      { label: 'Transcript *', val: colTranscript, set: setColTranscript, required: true },
                      { label: 'Chat ID', val: colChatId, set: setColChatId, required: false },
                      { label: 'Agent Name', val: colAgent, set: setColAgent, required: false },
                      { label: 'Tags', val: colTags, set: setColTags, required: false },
                      { label: 'Date', val: colDate, set: setColDate, required: false },
                      { label: 'CSAT', val: colCsat, set: setColCsat, required: false },
                    ].map(({ label, val, set, required }) => (
                      <div key={label}>
                        <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
                        <select value={val} onChange={e => set(e.target.value)}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30">
                          {!required && <option value="">(none)</option>}
                          {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4">
                    <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Max rows to score (0 = all)</label>
                    <input type="number" min={0} value={rowLimit} onChange={e => setRowLimit(parseInt(e.target.value) || 0)}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30 w-32" />
                  </div>

                  {/* Preview */}
                  <div className="mt-4 overflow-x-auto">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Preview (3 rows)</p>
                    <table className="w-full text-xs border border-gray-100 rounded-xl overflow-hidden">
                      <thead><tr className="bg-gray-50">{csvHeaders.slice(0, 6).map(h => <th key={h} className="text-left px-3 py-2 text-gray-500 font-medium truncate max-w-[120px]">{h}</th>)}</tr></thead>
                      <tbody>{csvRows.slice(0, 3).map((r, i) => <tr key={i} className="border-t border-gray-50">{csvHeaders.slice(0, 6).map(h => <td key={h} className="px-3 py-2 text-gray-600 truncate max-w-[120px]">{r[h]}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </div>

                <button
                  onClick={runBatch}
                  disabled={scoring || !colTranscript}
                  className="w-full py-3 bg-[#2d6a4f] text-white rounded-2xl font-bold text-sm hover:bg-[#245a41] disabled:opacity-50 transition"
                >
                  {scoring ? progressLabel || 'Scoring…' : `Score ${rowLimit > 0 ? rowLimit : csvRows.length} Chats`}
                </button>

                {scoring && (
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-gray-500">{progressLabel}</span>
                      <span className="text-xs font-bold text-[#2d6a4f]">{progress}%</span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2">
                      <div className="bg-[#2d6a4f] rounded-full h-2 transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Results */}
            {batchResults.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-gray-900">Results</h2>
                  <button onClick={exportCSV} className="text-xs px-3 py-1.5 bg-[#2d6a4f] text-white rounded-xl font-semibold hover:bg-[#245a41] transition">
                    Export CSV
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{batchResults.length}</p>
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mt-1">Scored</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold" style={{ color: scoreColor(avgIqs) }}>{avgIqs}%</p>
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mt-1">Avg IQS</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-bold text-red-600">{batchResults.filter(e => e.iqs < 70).length}</p>
                    <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mt-1">Below 70%</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-100">
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Chat ID</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Agent</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">IQS</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden md:table-cell">Tags</th>
                      <th className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide hidden lg:table-cell">Summary</th>
                      <th className="py-2" />
                    </tr></thead>
                    <tbody>
                      {batchResults.map((e, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer" onClick={() => setDetailEntry(e)}>
                          <td className="py-2 text-gray-600 font-mono">{e.chatId}</td>
                          <td className="py-2 text-gray-700 font-semibold">{e.agentName || '—'}</td>
                          <td className="py-2"><IQSBadge iqs={e.iqs} /></td>
                          <td className="py-2 text-gray-400 hidden md:table-cell max-w-[100px] truncate">{e.tags || '—'}</td>
                          <td className="py-2 text-gray-400 hidden lg:table-cell max-w-[200px] truncate">{e.summary}</td>
                          <td className="py-2 text-gray-300 text-xs">→</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batchErrors.length > 0 && (
                  <details className="text-xs">
                    <summary className="text-red-500 cursor-pointer font-semibold">{batchErrors.length} errors</summary>
                    <div className="mt-2 space-y-1">
                      {batchErrors.map((e, i) => <p key={i} className="text-red-400">Row {e.row} ({e.chatId}): {e.error}</p>)}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE TAB ── */}
        {tab === 'performance' && (
          <div className="max-w-5xl mx-auto space-y-5">
            {logsLoading && <p className="text-gray-400 text-sm animate-pulse text-center py-20">Loading…</p>}

            {!logsLoading && agentStats.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
                <p className="text-gray-400 text-sm">No scored chats yet. Upload and score chats first.</p>
              </div>
            )}

            {!logsLoading && agentStats.length > 0 && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Total Scored</p>
                    <p className="text-3xl font-bold text-gray-900">{entries.length}</p>
                  </div>
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Avg IQS</p>
                    <p className="text-3xl font-bold" style={{ color: scoreColor(Math.round(entries.reduce((s, e) => s + e.iqs, 0) / (entries.length || 1))) }}>
                      {Math.round(entries.reduce((s, e) => s + e.iqs, 0) / (entries.length || 1))}%
                    </p>
                  </div>
                  <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Agents Tracked</p>
                    <p className="text-3xl font-bold text-gray-900">{agentStats.length}</p>
                  </div>
                </div>

                {/* League table */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Agent League Table</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-100">
                        {['#', 'Agent', 'Chats', 'Avg IQS', 'Min', 'Max', '≥90%', '<70%'].map(h => (
                          <th key={h} className="text-left py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {agentStats.map((a, i) => (
                          <tr key={a.agent} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="py-2.5 text-xs font-bold text-gray-300 w-6">{i + 1}</td>
                            <td className="py-2.5 font-semibold text-gray-800">{a.agent}</td>
                            <td className="py-2.5 text-gray-500 text-xs">{a.chats}</td>
                            <td className="py-2.5"><IQSBadge iqs={a.avgIqs} /></td>
                            <td className="py-2.5 text-gray-500 text-xs">{a.minIqs}%</td>
                            <td className="py-2.5 text-gray-500 text-xs">{a.maxIqs}%</td>
                            <td className="py-2.5 text-green-600 text-xs font-semibold">{a.high}</td>
                            <td className="py-2.5 text-red-500 text-xs font-semibold">{a.atRisk}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Parameter failure rates */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h2 className="text-sm font-bold text-gray-900 mb-4">Parameter Failure Rates</h2>
                  <div className="space-y-3">
                    {PARAM_ORDER
                      .map(p => ({ p, pct: paramFails[p] || 0 }))
                      .sort((a, b) => b.pct - a.pct)
                      .map(({ p, pct }) => (
                        <div key={p}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-gray-700">{PARAM_NAMES[p]}</span>
                            <span className="text-xs text-gray-400">{pct}% fail · {Math.round(WEIGHTS[p] * 100)}% weight</span>
                          </div>
                          <div className="bg-gray-100 rounded-full h-2">
                            <div className="rounded-full h-2 transition-all"
                              style={{
                                width: `${Math.round((pct / Math.max(maxFailRate, 1)) * 100)}%`,
                                backgroundColor: pct >= 40 ? '#dc2626' : pct >= 20 ? '#ea580c' : '#16a34a',
                              }} />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── SCORE LOG TAB ── */}
        {tab === 'log' && (
          <div className="max-w-5xl mx-auto space-y-5">
            {/* Filters */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Agent</label>
                <select value={filterAgent} onChange={e => setFilterAgent(e.target.value)}
                  className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30 min-w-[120px]">
                  <option value="">All agents</option>
                  {availableAgents.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">IQS Range</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={filterMin} onChange={e => setFilterMin(parseInt(e.target.value) || 0)}
                    className="w-16 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none" />
                  <span className="text-gray-400 text-xs">–</span>
                  <input type="number" min={0} max={100} value={filterMax} onChange={e => setFilterMax(parseInt(e.target.value) || 100)}
                    className="w-16 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-gray-700 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tag</label>
                <input value={filterTag} onChange={e => setFilterTag(e.target.value)} placeholder="e.g. Repayment"
                  className="text-xs border border-gray-200 rounded-xl px-3 py-1.5 text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d6a4f]/30" />
              </div>
              <button onClick={loadScores} disabled={logsLoading}
                className="text-xs px-4 py-1.5 bg-[#2d6a4f] text-white rounded-xl font-semibold hover:bg-[#245a41] disabled:opacity-50 transition">
                {logsLoading ? 'Loading…' : 'Apply'}
              </button>
            </div>

            {logsLoading && <p className="text-gray-400 text-sm animate-pulse text-center py-20">Loading…</p>}

            {!logsLoading && entries.length === 0 && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
                <p className="text-gray-400 text-sm">No scored chats match your filters.</p>
              </div>
            )}

            {!logsLoading && entries.length > 0 && (
              <>
                {/* Summary row */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Showing', value: entries.length, color: undefined },
                    { label: 'Avg IQS', value: `${Math.round(entries.reduce((s, e) => s + e.iqs, 0) / entries.length)}%`, color: scoreColor(Math.round(entries.reduce((s, e) => s + e.iqs, 0) / entries.length)) },
                    { label: 'Below 70%', value: entries.filter(e => e.iqs < 70).length, color: '#dc2626' },
                    { label: 'Perfect 100%', value: entries.filter(e => e.iqs === 100).length, color: '#16a34a' },
                  ].map(s => (
                    <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1">{s.label}</p>
                      <p className="text-2xl font-bold" style={{ color: s.color || '#111827' }}>{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-gray-100">
                      {['Time', 'Chat ID', 'Agent', 'IQS', 'Tags', 'Scored By'].map(h => (
                        <th key={h} className="text-left py-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {entries.map((e, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer" onClick={() => setDetailEntry(e)}>
                          <td className="py-2 text-gray-400 whitespace-nowrap">{e.scoredAt.slice(0, 16).replace('T', ' ')}</td>
                          <td className="py-2 text-gray-600 font-mono">{e.chatId}</td>
                          <td className="py-2 font-semibold text-gray-800">{e.agentName || '—'}</td>
                          <td className="py-2"><IQSBadge iqs={e.iqs} /></td>
                          <td className="py-2 text-gray-400 max-w-[100px] truncate">{e.tags || '—'}</td>
                          <td className="py-2 text-gray-400">{(e.scoredBy || '').split('@')[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
