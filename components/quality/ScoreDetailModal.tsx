import { useState, useEffect } from 'react';
import { PARAM_ORDER, PARAM_NAMES, WEIGHTS } from '@/lib/quality';
import type { IQSScoreEntry } from '@/lib/quality';
import TranscriptBubbles, { renderContentWithLinks } from '@/components/quality/TranscriptBubbles';
import { IQSRing } from '@/components/quality/IQSRing';
import ParamBadge from '@/components/quality/ParamBadge';
import { ChatLink } from './helpers';

interface ScoreDetailProps {
  entry: IQSScoreEntry;
  onClose: () => void;
  onEdit?: (e: IQSScoreEntry) => void;
  userRole?: string;
}

export default function ScoreDetail({ entry, onClose, onEdit, userRole }: ScoreDetailProps) {
  const fails = PARAM_ORDER.filter(p => entry.scores[p] === 'No');
  const canEdit = userRole === 'quality' || userRole === 'admin';
  const [showTranscript, setShowTranscript] = useState(true);
  const [transcript, setTranscript] = useState<{ timedMessages?: any[]; rawTranscript?: string } | null>(null);
  const [callRecordings, setCallRecordings] = useState<any[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState('');

  useEffect(() => {
    setTranscriptLoading(true);
    setTranscriptError('');
    fetch(`/api/quality/transcript?chatId=${encodeURIComponent(entry.chatId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.found) {
          setTranscript({ timedMessages: d.timedMessages, rawTranscript: d.rawTranscript });
          setCallRecordings(d.callRecordings || []);
        } else {
          setTranscript({});
          setCallRecordings([]);
        }
      })
      .catch(() => setTranscriptError('Failed to load transcript'))
      .finally(() => setTranscriptLoading(false));
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
            <div className="flex-1 overflow-y-auto max-h-[85vh]">
              <div className="px-6 py-5 space-y-6">
                {transcriptLoading && (
                  <div className="flex items-center justify-center py-12 text-gray-400 gap-2 text-sm">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin"><path d="M8 2a6 6 0 1 0 6 6" /></svg>
                    Loading transcript…
                  </div>
                )}
                {transcriptError && <p className="text-sm text-red-500 text-center py-8">{transcriptError}</p>}
                {!transcriptLoading && !transcriptError && (
                  <>
                    {transcript !== null && (
                      (transcript.timedMessages && transcript.timedMessages.length > 0) || (callRecordings && callRecordings.length > 0) ? (
                        <TranscriptBubbles messages={transcript.timedMessages || []} callRecordings={callRecordings} />
                      ) : transcript.rawTranscript ? (
                        <>
                          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Raw Transcript</p>
                          <pre className="text-[12px] text-gray-600 bg-gray-50 rounded-xl px-4 py-3 whitespace-pre-wrap leading-relaxed font-sans">{renderContentWithLinks(transcript.rawTranscript, false)}</pre>
                        </>
                      ) : (
                        <div className="text-center py-12">
                          <p className="text-sm text-gray-400">No transcript saved for this chat.</p>
                          <p className="text-xs text-gray-300 mt-1">Transcripts are saved for new chats scored after this update.</p>
                        </div>
                      )
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
