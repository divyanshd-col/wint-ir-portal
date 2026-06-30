'use client';

import React from 'react';

const BOT_NAMES = new Set(['myra', 'bot', 'wint bot', 'wintbot']);
const CUSTOMER_LABELS = new Set(['user', 'customer', 'visitor']);

export function renderContentWithLinks(text: string, isOutgoing?: boolean) {
  if (!text) return '';
  const urlRegex = /(https?:\/\/[^\s\]\)\>]+)/gi;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;

  const linkClass = isOutgoing
    ? "underline text-white font-medium hover:opacity-90 break-all"
    : "underline text-blue-600 font-medium hover:text-blue-800 break-all";

  return parts.map((part, index) => {
    if (urlRegex.test(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          Link
        </a>
      );
    }
    return part;
  });
}

import { CallTranscriptCard } from '@/components/CallTranscriptCard';

interface TranscriptMsg {
  sender: string;
  content: string;
  timestamp?: string;
}

interface CallRec {
  id: string;
  recordingUrl?: string | null;
  durationSeconds: number | null;
  calledAt: string | null;
  language: string | null;
  segments: any[];
  interruptionCount: number;
  deadAirCount: number;
}

export default function TranscriptBubbles({
  messages,
  callRecordings = [],
}: {
  messages: TranscriptMsg[];
  callRecordings?: CallRec[];
}) {
  // Merge messages and calls chronologically
  const items = [
    ...messages.map(m => ({
      type: 'message' as const,
      timestamp: m.timestamp,
      time: m.timestamp ? new Date(m.timestamp).getTime() : 0,
      data: m,
    })),
    ...callRecordings.map(c => ({
      type: 'call' as const,
      timestamp: c.calledAt,
      time: c.calledAt ? new Date(c.calledAt).getTime() : 0,
      data: c,
    })),
  ];

  // Sort by time ascending
  items.sort((a, b) => a.time - b.time);

  return (
    <div className="space-y-4 py-1">
      {items.map((item, idx) => {
        if (item.type === 'call') {
          const rec = item.data;
          return (
            <div key={`call-${rec.id}`} className="my-4">
              <CallTranscriptCard
                rec={{
                  id: rec.id,
                  label: `Call #${rec.id} (${rec.language || 'English'})`,
                  calledAt: rec.calledAt,
                  durationSeconds: rec.durationSeconds,
                  recordingUrl: rec.recordingUrl,
                  segments: rec.segments || [],
                  interruptionCount: rec.interruptionCount || 0,
                  deadAirCount: rec.deadAirCount || 0,
                }}
                index={idx}
              />
            </div>
          );
        }

        const m = item.data;
        const senderLc = (m.sender || '').toLowerCase().trim();
        const isCustomer = CUSTOMER_LABELS.has(senderLc);
        const isBot = BOT_NAMES.has(senderLc);
        const isActivity = senderLc === 'activity' || senderLc === 'system';
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

        if (isActivity) {
          return (
            <div key={idx} className="flex justify-center my-2">
              <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-3 py-1 font-sans italic border border-gray-200">
                {m.content}{timeStr && `  •  ${timeStr}`}
              </span>
            </div>
          );
        }

        // Customer messages → LEFT (incoming)
        if (isCustomer) {
          return (
            <div key={idx} className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mt-1">
                <span className="text-[9px] font-bold text-gray-500">U</span>
              </div>
              <div className="max-w-[78%]">
                <p className="text-[9px] font-semibold text-gray-400 mb-0.5">{m.sender}{timeStr && ` · ${timeStr}`}</p>
                <div className="bg-gray-100 text-gray-800 px-3.5 py-2 rounded-2xl rounded-tl-sm text-[12.5px] leading-relaxed font-sans">
                  {renderContentWithLinks(m.content, false)}
                </div>
              </div>
            </div>
          );
        }

        // Bot → RIGHT (outgoing)
        if (isBot) {
          return (
            <div key={idx} className="flex justify-end gap-2">
              <div className="max-w-[78%]">
                <p className="text-[9px] font-semibold text-violet-400 text-right mb-0.5 pr-1">{m.sender}{timeStr && ` · ${timeStr}`}</p>
                <div className="bg-violet-500 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-[12.5px] leading-relaxed font-sans">
                  {renderContentWithLinks(m.content, true)}
                </div>
              </div>
            </div>
          );
        }

        // Human agent → RIGHT (outgoing)
        return (
          <div key={idx} className="flex justify-end gap-2">
            <div className="max-w-[78%]">
              <p className="text-[9px] font-semibold text-emerald-600 text-right mb-0.5 pr-1">{m.sender}{timeStr && ` · ${timeStr}`}</p>
              <div className="bg-emerald-500 text-white px-3.5 py-2 rounded-2xl rounded-tr-sm text-[12.5px] leading-relaxed font-sans">
                {renderContentWithLinks(m.content, true)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
