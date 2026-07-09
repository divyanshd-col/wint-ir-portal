'use client';

import React, { useState, useRef, useMemo } from 'react';
import { useQuality } from './QualityContext';
import { PARAM_ORDER, PARAM_NAMES, iqsTheme } from '@/lib/quality';
import type { IQSScoreEntry, ParamScore } from '@/lib/quality';
import { IQSPill } from '@/components/quality/IQSRing';
import {
  parseRawCSV,
  isWintFormat,
  buildParsedRows,
  parseMetaFile,
  ChatLink,
} from './helpers';
import type { ParsedRow, MetaMap } from './types';

export default function UploadTab() {
  const { setDetailEntry, setToast } = useQuality();

  // Local Upload State
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

  // Meta file state
  const [metaMap, setMetaMap] = useState<MetaMap>({});
  const [metaFileName, setMetaFileName] = useState('');
  const [metaRowCount, setMetaRowCount] = useState(0);
  const [metaError, setMetaError] = useState('');
  const metaFileRef = useRef<HTMLInputElement>(null);

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

  return (
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
                  className="w-20 text-xs border border-gray-200 rounded-xl px-2 py-1.5 text-center focus:outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white text-gray-800" />
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
                className="w-24 text-xs border border-gray-200 rounded-xl px-3 py-2 focus:outline-none bg-white text-gray-800" />
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
  );
}
