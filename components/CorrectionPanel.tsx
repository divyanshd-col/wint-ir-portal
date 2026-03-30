'use client';

import React, { useState } from 'react';
import type { SourceChunk } from '@/lib/corrections';

interface CorrectionPanelProps {
  originalQuery: string;
  originalAnswer: string;
  sourceChunks: SourceChunk[];
  formAnswers?: Record<string, string>;
  category?: string;
  onClose: () => void;
}

export default function CorrectionPanel({
  originalQuery,
  originalAnswer,
  sourceChunks,
  formAnswers,
  category,
  onClose,
}: CorrectionPanelProps) {
  const [correctedAnswer, setCorrectedAnswer] = useState(originalAnswer);
  const [agentNote, setAgentNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!correctedAnswer.trim() || correctedAnswer.trim() === originalAnswer.trim()) {
      setError('Please edit the answer before submitting.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalQuery,
          originalAnswer,
          correctedAnswer,
          agentNote,
          sourceChunks,
          formAnswers,
          category,
        }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      setSubmitted(true);
    } catch {
      setError('Failed to submit correction. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#16a34a" strokeWidth="2">
            <path d="M3 8l4 4 6-6"/>
          </svg>
          <span className="text-[13px] text-green-800 font-[500]">Correction submitted — an admin will review it.</span>
        </div>
        <button onClick={onClose} className="text-[12px] text-green-600 hover:text-green-800 transition-colors">Dismiss</button>
      </div>
    );
  }

  return (
    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-200/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#92400e" strokeWidth="1.5">
            <path d="M10 2l2 2-7 7H3v-2l7-7z"/>
          </svg>
          <span className="text-[11px] font-[700] text-amber-800 uppercase tracking-[0.09em]">Flag & Correct</span>
        </div>
        <button onClick={onClose} className="text-amber-400 hover:text-amber-700 transition-colors">
          <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1l10 10M11 1L1 11"/>
          </svg>
        </button>
      </div>
      <div className="px-4 py-4 space-y-4">
        <div>
          <label className="block text-[11.5px] font-[600] text-amber-800 uppercase tracking-[0.07em] mb-2">
            Corrected Answer
          </label>
          <textarea
            value={correctedAnswer}
            onChange={e => { setCorrectedAnswer(e.target.value); setError(''); }}
            rows={6}
            className="w-full bg-white border border-amber-200 rounded-xl px-3.5 py-3 text-[13.5px] text-[#111827] leading-[1.6] focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/60 resize-none transition"
          />
        </div>
        <div>
          <label className="block text-[11.5px] font-[600] text-amber-800 uppercase tracking-[0.07em] mb-2">
            What was wrong? <span className="font-[400] text-amber-600 normal-case">(optional note for the admin)</span>
          </label>
          <input
            type="text"
            value={agentNote}
            onChange={e => setAgentNote(e.target.value)}
            placeholder="e.g. Wrong escalation channel, incorrect SLA mentioned..."
            className="w-full bg-white border border-amber-200 rounded-xl px-3.5 py-2.5 text-[13px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400/60 placeholder-gray-400 transition"
          />
        </div>
        {sourceChunks.length > 0 && (
          <p className="text-[11.5px] text-amber-700">
            Source: {sourceChunks.map(c => c.fileName).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
          </p>
        )}
        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] text-amber-700 hover:text-amber-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-[13px] font-[600] bg-amber-600 hover:bg-amber-700 text-white rounded-xl transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Correction'}
          </button>
        </div>
      </div>
    </div>
  );
}
