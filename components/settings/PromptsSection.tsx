'use client';

import { useState } from 'react';
import PromptEditor from './PromptEditor';
import { CATALOG, CHANNELS, ROLES, type CatalogEntry } from '@/lib/prompt-catalog';
import { buildEmailEvaluationPrompt, buildEmailOutputFormat, DEFAULT_EMAIL_PARAMETERS, type EvaluationParameterConfig } from '@/lib/email/context-builder';

/** Editing from Settings is switched off for now: every prompt is view-only. Set to true to bring back Edit / Reset. */
const EDITING_ENABLED = false;

const KEEP_FORMAT = 'The output format below the editor is locked and added automatically, so an edit here cannot break scoring. If scoring still misbehaves after an edit, use Reset to default.';

interface Props {
  /** 'quality' = IQS and compliance agents per channel; 'chatbot' = the live support chatbot's prompts. */
  area: 'quality' | 'chatbot';
  activeDomain: 'cx' | 'pcg';
  config: {
    systemPrompt?: string; defaultChatPrompt?: string; iqsScoringPrompt?: string; defaultIqsScoringPrompt?: string;
    prompts?: Record<string, { value: string; defaultValue: string }>;
    emailParameters?: EvaluationParameterConfig[];
    /** Hardcoded prompt texts by catalog id (read-only). */
    readOnlyPrompts?: Record<string, string>;
  };
  onSaved: (msg: string) => void;
}

/** Settings → Prompts: every prompt grouped by channel, then by agent (IQS, compliance, assistant, supporting). */
export default function PromptsSection({ area, activeDomain, config, onSaved }: Props) {
  const channels = CHANNELS.filter(c => c.workspace === activeDomain);
  const inArea = (e: CatalogEntry) => (e.area === 'chatbot') === (area === 'chatbot');
  const [channel, setChannel] = useState(channels[0]?.id);

  const editableData = (e: CatalogEntry) =>
    e.field === 'systemPrompt' ? { value: config.systemPrompt || '', defaultValue: config.defaultChatPrompt || '' }
    : e.field === 'iqsScoringPrompt' ? { value: config.iqsScoringPrompt || '', defaultValue: config.defaultIqsScoringPrompt || '' }
    : e.field ? config.prompts?.[e.field] : undefined;

  function body(e: CatalogEntry) {
    if (e.missing) return <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{e.missing}</p>;
    if (e.field) {
      const d = editableData(e);
      if (!d) return null;
      const isEmailIqs = e.id === 'email_iqs';
      return (
        <PromptEditor
          title={e.title} description={e.description} note={EDITING_ENABLED ? (e.note ?? KEEP_FORMAT) : e.note} onSaved={onSaved} viewOnly={!EDITING_ENABLED}
          fields={[{ field: e.field, value: d.value, defaultValue: d.defaultValue }]}
          lockedOutput={isEmailIqs ? buildEmailOutputFormat((config.emailParameters ?? DEFAULT_EMAIL_PARAMETERS).map(p => p.key)) : undefined}
          preview={isEmailIqs ? {
            label: 'Preview the full prompt the AI receives (sample email; uses the saved Scoring Rubric and compliance rules)',
            build: texts => buildEmailEvaluationPrompt({
              parameters: config.emailParameters, promptText: { intro: texts.emailPromptIntro, compliance: config.prompts?.emailPromptCompliance?.value },
              ticketId: 'SAMPLE', messageId: 'SAMPLE', agentName: 'Sample Agent', sentAt: '2026-01-01T10:00:00Z',
              customerMessage: "[the investor's latest email appears here]", agentReplyText: "[the agent's reply being scored appears here]",
              historyCount: 0, knowledgeBase: '[knowledge-base excerpts matched to the email appear here]',
            }),
          } : undefined}
        />
      );
    }
    const text = config.readOnlyPrompts?.[e.id];
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-400">{e.description}</p>
        <textarea readOnly value={text ?? '(prompt text not available)'} rows={16} aria-label={`${e.title} (read-only)`}
          className="w-full border border-gray-100 rounded-xl px-4 py-3 text-sm text-gray-500 bg-gray-50 font-mono leading-relaxed resize-y cursor-not-allowed focus:outline-none" />
        <p className="text-xs text-gray-400">Hardcoded in <code>{e.source}</code>. Changing it needs a code change and deploy.</p>
      </div>
    );
  }

  function badge(e: CatalogEntry) {
    if (e.missing) return <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">No separate prompt</span>;
    if (e.field) return <span className="text-xs font-semibold text-[#1f7a4d] bg-green-50 border border-green-200 px-2 py-0.5 rounded-lg">{EDITING_ENABLED ? 'Editable' : 'View only'}</span>;
    return <span className="text-xs font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-lg">Hardcoded · read-only</span>;
  }

  const visible = (c: string) => CATALOG.filter(e => e.channel === c && inArea(e) && (!e.field || editableData(e)));
  const [selected, setSelected] = useState<Record<string, string>>({});
  const current = (c: string) => selected[c] ?? visible(c)[0]?.id;

  function dot(e: CatalogEntry) {
    const cls = e.missing ? 'bg-amber-400' : e.field ? 'bg-[#1f7a4d]' : 'bg-gray-300';
    return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden />;
  }

  return (
    <div className="space-y-5">
      <div className={area === 'chatbot' ? 'hidden' : 'flex gap-1 bg-gray-100 rounded-xl p-1 w-fit'}>
        {channels.map(c => (
          <button key={c.id} onClick={() => setChannel(c.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${channel === c.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Every channel and prompt stays mounted so unsaved edits survive switching */}
      {channels.map(c => (
        <div key={c.id} className={c.id === channel ? 'flex flex-col md:flex-row gap-6 items-start' : 'hidden'}>
          <nav aria-label={`${c.label} prompts`} className="w-full md:w-64 shrink-0 md:sticky md:top-4 space-y-4">
            {ROLES.map(r => {
              const rows = visible(c.id).filter(e => e.role === r.id);
              if (!rows.length) return null;
              return (
                <div key={r.id}>
                  <h3 className="px-3 mb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{r.label}</h3>
                  <ul className="space-y-0.5">
                    {rows.map(e => (
                      <li key={e.id}>
                        <button onClick={() => setSelected(m => ({ ...m, [c.id]: e.id }))} aria-current={current(c.id) === e.id}
                          className={`w-full flex gap-2 text-left px-3 py-2 rounded-lg text-sm transition ${current(c.id) === e.id ? 'bg-green-50 text-[#1f7a4d] font-semibold' : 'text-gray-600 hover:bg-gray-100'}`}>
                          {dot(e)}<span className="leading-snug">{e.title}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="px-3 text-[11px] text-gray-400 leading-relaxed">
              <span className="inline-block h-2 w-2 rounded-full bg-[#1f7a4d] mr-1" />{EDITING_ENABLED ? 'Editable' : 'In Settings'}
              <span className="inline-block h-2 w-2 rounded-full bg-gray-300 ml-3 mr-1" />Hardcoded
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400 ml-3 mr-1" />No prompt
            </p>
          </nav>

          <div className="flex-1 min-w-0 w-full">
            {visible(c.id).map(e => (
              <div key={e.id} className={current(c.id) === e.id ? 'space-y-3' : 'hidden'}>
                {!e.field && (
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-gray-900">{e.title}</h3>
                    {badge(e)}
                  </div>
                )}
                {body(e)}
              </div>
            ))}
          </div>
        </div>
      ))}
      {channels.every(c => visible(c.id).length === 0) && <p className="text-sm text-gray-400">No prompts for this workspace.</p>}
    </div>
  );
}
