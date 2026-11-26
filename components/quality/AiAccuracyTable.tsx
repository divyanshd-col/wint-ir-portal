'use client';

import React, { useState, useEffect, useCallback } from 'react';
import CallEvalPanel from './CallEvalPanel';
import ScoreRing from './ScoreRing';

interface Props {
  channel: 'calls' | 'chats' | 'emails';
  filter: 'accurate' | 'hallucinated';
  qa?: string;
  onQAsLoaded?: (qas: string[]) => void;
}

function fmtDateShort(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return '—';
  }
}

function fmtDuration(secs?: number | null) {
  if (secs == null) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AiAccuracyTable({ channel, filter, qa, onQAsLoaded }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<any | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/cx/qa/ai-accuracy?channel=${channel}&filter=${filter}`;
      if (qa && qa !== 'all') {
        url += `&qa=${encodeURIComponent(qa)}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        if (data.qas && onQAsLoaded) {
          onQAsLoaded(data.qas);
        }
      } else {
        setItems([]);
      }
    } catch (err) {
      console.error('Failed to load AI accuracy items:', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [channel, filter, qa, onQAsLoaded]);

  useEffect(() => {
    setSelectedCall(null);
    fetchItems();
  }, [fetchItems]);

  const channelLabel = channel === 'calls' ? 'Calls' : channel === 'chats' ? 'Chats' : 'Emails';
  const filterLabel = filter === 'accurate' ? 'AI Accurate' : 'AI Hallucinated';

  return (
    <div className="space-y-4">
      {/* Active Evaluation Panel Overlay / Modal if a call is selected */}
      {selectedCall && (
        <div style={{ marginBottom: 24, border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <CallEvalPanel
            callId={selectedCall.call_id}
            chatId={selectedCall.chat_id}
            durationSeconds={selectedCall.duration_seconds}
            agentName={selectedCall.agent_name}
            iqsScore={selectedCall.iqs_percent ? parseFloat(selectedCall.iqs_percent) : null}
            calledAt={selectedCall.called_at}
            disposition={selectedCall.disposition}
            gates={selectedCall.gates}
            iqsScores={selectedCall.iqs_scores}
            mode="review"
            onClose={() => setSelectedCall(null)}
            onDone={() => {
              setSelectedCall(null);
              fetchItems();
            }}
          />
        </div>
      )}

      {/* Main Table Container */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-2xs">
        {loading ? (
          <div className="p-12 text-center text-xs text-gray-400 font-mono">
            Loading {filterLabel.toLowerCase()} {channelLabel.toLowerCase()}…
          </div>
        ) : items.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-sm font-semibold text-gray-900">
              No {channelLabel.toLowerCase()} marked as {filterLabel}
            </div>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              Only moving forward, as QAs audit {channelLabel.toLowerCase()} and mark them as {filterLabel}, they will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50/90 border-b border-gray-200 text-gray-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Identifier</th>
                  <th className="py-3 px-4">Agent</th>
                  {channel === 'calls' && <th className="py-3 px-4">Duration</th>}
                  <th className="py-3 px-4">Disposition / Intent</th>
                  <th className="py-3 px-4 text-center">Score</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Audit Reason</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((row, idx) => {
                  const id = row.call_id || row.chat_id || row.ticket_id || row.id;
                  const isHallucinated = Boolean(row.ai_hallucinated);
                  const reason = row.ai_hallucination_reason || '—';
                  const score = row.iqs_percent || row.iqs_score || row.quality_score;
                  const dateVal = row.called_at || row.updated_at || row.created_at || row.sent_at;

                  return (
                    <tr key={idx} className="hover:bg-gray-50/60 transition">
                      <td className="py-3.5 px-4 font-mono font-medium text-gray-900">
                        {id}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-gray-900">
                        {row.agent_name || '—'}
                      </td>
                      {channel === 'calls' && (
                        <td className="py-3.5 px-4 font-mono text-gray-600">
                          {fmtDuration(row.duration_seconds)}
                        </td>
                      )}
                      <td className="py-3.5 px-4 text-gray-700">
                        {row.disposition || row.intent || '—'}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-bold text-gray-900">
                        {score != null ? Math.round(Number(score)) : '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            isHallucinated
                              ? 'bg-black text-white'
                              : 'bg-gray-100 text-gray-800 border border-gray-200'
                          }`}
                        >
                          {isHallucinated ? 'AI Hallucinated' : 'AI Accurate'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-gray-600 max-w-xs truncate" title={reason}>
                        {reason}
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 font-mono text-[11px]">
                        {fmtDateShort(dateVal)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {channel === 'calls' ? (
                          <button
                            type="button"
                            onClick={() => setSelectedCall(row)}
                            className="px-3 py-1 bg-black text-white text-xs font-semibold rounded-lg hover:bg-gray-800 transition cursor-pointer"
                          >
                            Evaluate
                          </button>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
