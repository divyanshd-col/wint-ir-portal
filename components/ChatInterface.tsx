'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { SavedConversation } from '@/lib/types';

interface FormQuestion {
  id: string;
  label: string;
  placeholder?: string;
  options?: string[];
  type?: 'select' | 'text';
}

interface MessageForm {
  questions: FormQuestion[];
  stepTitle?: string;
  answers: Record<string, string>;
  submitted: boolean;
  queryMessages: { role: string; content: string }[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
  form?: MessageForm;
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const tokenRegex = /\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <strong key={`${keyPrefix}-b-${match.index}`} className="font-[650] text-[#0a0a0a]">
          {match[1]}
        </strong>
      );
    } else {
      const href = match[3] || match[4];
      const label = match[2] || match[4];
      parts.push(
        <a key={`${keyPrefix}-link-${match.index}`} href={href} target="_blank" rel="noopener noreferrer"
           className="text-[#2d9e4f] underline underline-offset-2 hover:text-[#238a42] break-all">
          {label}
        </a>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderContent(text: string): React.ReactNode {
  const paragraphs = text.split(/\n{2,}/);

  return (
    <div className="space-y-4">
      {paragraphs.map((para, pi) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        // Section heading: ## or ###
        if (/^#{1,3}\s+/.test(trimmed)) {
          const content = trimmed.replace(/^#{1,3}\s+/, '');
          return (
            <div key={pi} className="flex items-center gap-2 pt-0.5">
              <span className="w-[3px] h-3.5 bg-[#2d9e4f] rounded-full shrink-0" />
              <p className="text-[11.5px] font-[700] text-[#2d9e4f] uppercase tracking-[0.09em]">
                {renderInline(content, `${pi}`)}
              </p>
            </div>
          );
        }

        const lines = trimmed.split('\n').filter(l => l.trim());

        // Numbered list
        const allNumbered = lines.length > 1 && lines.every(l => /^\d+[\.)]\s+/.test(l.trim()));
        if (allNumbered) {
          return (
            <ol key={pi} className="space-y-3">
              {lines.map((line, li) => {
                const content = line.replace(/^\d+[\.)]\s+/, '');
                const num = (line.match(/^(\d+)/) || [])[1];
                return (
                  <li key={li} className="flex gap-3 text-[15px] leading-[1.7]">
                    <span className="shrink-0 w-5 h-5 rounded-md bg-[#2d9e4f]/10 text-[#2d9e4f] text-[11px] font-[700] flex items-center justify-center mt-[2px]">
                      {num}
                    </span>
                    <span className="text-[#111827]">{renderInline(content, `${pi}-${li}`)}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Bullet list
        const allBullet = lines.every(l => /^[-•]\s+/.test(l.trim()));
        if (allBullet) {
          return (
            <ul key={pi} className="space-y-2.5">
              {lines.map((line, li) => {
                const content = line.replace(/^[-•]\s+/, '');
                return (
                  <li key={li} className="flex gap-3 text-[15px] leading-[1.7]">
                    <span className="shrink-0 w-[5px] h-[5px] rounded-sm bg-[#2d9e4f] mt-[9px]" />
                    <span className="text-[#111827]">{renderInline(content, `${pi}-${li}`)}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        // Plain paragraph
        return (
          <p key={pi} className="text-[15px] leading-[1.72] text-[#111827]">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInline(line.trim(), `${pi}-${li}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const SUGGESTED_QUESTIONS = [
  "User's KYC is still showing pending",
  "Bond not showing in portfolio after payment",
  "Referral reward not credited",
  "User wants to cancel SIP",
  "Repayment not received on scheduled date",
  "User wants to sell bonds",
];

interface ChatInterfaceProps {
  username?: string;
  historyEnabled?: boolean;
  initialConversation?: SavedConversation | null;
}

export default function ChatInterface({ username, historyEnabled = false, initialConversation }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [accumulatedAnswers, setAccumulatedAnswers] = useState<Record<string, string>>({});
  const [formStepCount, setFormStepCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Restore a past conversation on mount (key prop causes remount for each restore)
  useEffect(() => {
    if (!initialConversation) return;
    const restored: Message[] = initialConversation.messages.map((m, i) => ({
      id: `restored-${i}`,
      role: m.role,
      content: m.content,
    }));
    setMessages(restored);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const editMessage = (msg: Message, index: number) => {
    setMessages(prev => prev.slice(0, index));
    setAccumulatedAnswers({});
    setFormStepCount(0);
    setInput(msg.content);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // Stream the final answer with all accumulated evidence
  const streamAnswer = async (
    queryMessages: { role: string; content: string }[],
    formAnswers?: Record<string, string>,
    queryType: 'direct' | 'process' = 'process'
  ) => {
    const assistantId = (Date.now() + 2).toString();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', loading: true };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: queryMessages, formAnswers, queryType }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text') {
              fullText += parsed.text;
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: fullText, loading: false } : m)
              );
            }
          } catch {}
        }
      }
      // Save conversation to history after successful answer
      if (historyEnabled && fullText) {
        const firstUserMsg = queryMessages.find(m => m.role === 'user');
        const title = (firstUserMsg?.content || 'Conversation').slice(0, 60);
        const conversation: SavedConversation = {
          id: Date.now().toString(),
          title,
          messages: [
            ...queryMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
            { role: 'assistant' as const, content: fullText },
          ],
          timestamp: Date.now(),
        };
        fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(conversation),
        }).catch(() => {});
      }
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: 'Sorry, I encountered an error. Please try again or connect with CX-TL or Divyansh.', loading: false }
            : m
        )
      );
    } finally {
      setLoading(false);
    }
  };

  // Call analyze with accumulated answers — show next step form or stream final answer
  const analyzeAndProceed = async (
    queryMessages: { role: string; content: string }[],
    accumulated: Record<string, string>,
    stepCount: number = 0
  ) => {
    // Hard cap: after 6 steps always go to final answer regardless
    if (stepCount >= 6) {
      await streamAnswer(queryMessages, accumulated);
      return;
    }

    // Inject accumulated form answers into the conversation so the analyze model
    // sees them in its history — prevents asking questions that are already answered
    const messagesForAnalyze = Object.keys(accumulated).length > 0
      ? [
          ...queryMessages,
          {
            role: 'user' as const,
            content: `[Already confirmed by agent:\n${Object.entries(accumulated).map(([k, v]) => `${k}: ${v}`).join('\n')}]`,
          },
        ]
      : queryMessages;

    try {
      const analyzeRes = await fetch('/api/chat/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messagesForAnalyze, allAnswers: accumulated }),
      });

      const { queryType, questions, stepTitle, clarificationMessage } = await analyzeRes.json();

      // Direct queries skip the form entirely
      if (queryType === 'direct') {
        await streamAnswer(queryMessages, undefined, 'direct');
        return;
      }

      // Clarify: show as a conversational text message — agent can respond naturally
      if (queryType === 'clarify' && clarificationMessage) {
        const clarifyId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, {
          id: clarifyId,
          role: 'assistant',
          content: clarificationMessage,
          loading: false,
        }]);
        setLoading(false);
        return;
      }

      // Filter out any questions whose IDs are already answered in accumulated
      const genuinelyNew = (questions || []).filter(
        (q: FormQuestion) => accumulated[q.id] === undefined || accumulated[q.id] === ''
      );

      if (genuinelyNew.length > 0) {
        // Show next step form with only unanswered questions
        const formId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, {
          id: formId,
          role: 'assistant',
          content: '',
          loading: false,
          form: {
            questions: genuinelyNew,
            stepTitle,
            answers: {},
            submitted: false,
            queryMessages,
          },
        }]);
        setLoading(false);
      } else {
        // No new questions — all evidence collected, stream final answer
        await streamAnswer(queryMessages, accumulated, 'process');
      }
    } catch {
      await streamAnswer(queryMessages, accumulated);
    }
  };

  // Initial message send — resets accumulated answers and starts Step 1
  const sendMessage = async (query: string, currentMessages: Message[] = messages) => {
    if (!query.trim() || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query };
    const thinkingMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', loading: true };
    const newMessages = [...currentMessages, userMsg, thinkingMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Reset accumulated answers and step count for new query
    setAccumulatedAnswers({});
    setFormStepCount(0);

    const apiMessages = newMessages
      .filter(m => !m.loading && !m.form)
      .map(m => ({ role: m.role, content: m.content }));

    try {
      const analyzeRes = await fetch('/api/chat/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, allAnswers: {} }),
      });

      const { queryType, questions, stepTitle, clarificationMessage } = await analyzeRes.json();

      // Direct queries: skip form, answer immediately
      if (queryType === 'direct' || !questions || questions.length === 0) {
        setMessages(prev => prev.filter(m => m.id !== thinkingMsg.id));
        await streamAnswer(apiMessages, undefined, queryType === 'direct' ? 'direct' : 'process');
      } else if (queryType === 'clarify' && clarificationMessage) {
        // Clarify: replace thinking dot with a conversational question
        setMessages(prev =>
          prev.map(m =>
            m.id === thinkingMsg.id
              ? { ...m, loading: false, content: clarificationMessage }
              : m
          )
        );
        setLoading(false);
      } else {
        // Process query: show Step 1 form
        setMessages(prev =>
          prev.map(m =>
            m.id === thinkingMsg.id
              ? {
                  ...m,
                  loading: false,
                  form: {
                    questions,
                    stepTitle,
                    answers: {},
                    submitted: false,
                    queryMessages: apiMessages,
                  },
                }
              : m
          )
        );
        setLoading(false);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkingMsg.id));
      await streamAnswer(apiMessages);
    }
  };

  // Form submission — merges answers and re-analyzes for next step
  const submitForm = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.form) return;

    // Mark as submitted
    setMessages(prev =>
      prev.map(m => m.id === msgId && m.form ? { ...m, form: { ...m.form, submitted: true } } : m)
    );

    // Merge new answers into accumulated
    const newAccumulated = { ...accumulatedAnswers, ...msg.form.answers };
    setAccumulatedAnswers(newAccumulated);

    const newStepCount = formStepCount + 1;
    setFormStepCount(newStepCount);
    setLoading(true);

    // Re-analyze with all accumulated answers to determine next step or final answer
    await analyzeAndProceed(msg.form.queryMessages, newAccumulated, newStepCount);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const updateFormAnswer = (msgId: string, fieldId: string, value: string) => {
    setMessages(prev =>
      prev.map(m =>
        m.id === msgId && m.form
          ? { ...m, form: { ...m.form, answers: { ...m.form.answers, [fieldId]: value } } }
          : m
      )
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#f7f8fa]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="mb-5 bg-white rounded-xl px-4 py-2.5 shadow-sm border border-gray-100 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wint-logo.png" alt="Wint Wealth" width={110} height={40} className="object-contain block" />
            </div>
            <h2 className="text-[19px] font-[650] text-[#0a0a0a] mb-1.5 tracking-[-0.01em]">IR Support Assistant</h2>
            <p className="text-[13.5px] text-gray-400 max-w-xs mb-8 leading-relaxed">
              Select a common issue below or describe the investor&apos;s problem.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-left px-4 py-3 bg-white border border-gray-200/80 rounded-xl text-[13.5px] font-[500] text-[#374151] hover:border-[#2d9e4f]/50 hover:bg-[#2d9e4f]/5 hover:text-[#2d9e4f] transition-all shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`w-full ${msg.role === 'user' ? 'max-w-lg' : 'max-w-2xl'}`}>

                {msg.role === 'assistant' && (
                  <div className="flex items-center gap-2 mb-2 ml-0.5">
                    <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 bg-white border border-gray-200 shadow-sm flex items-center justify-center p-0.5">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/wint-logo.png" alt="Wint" className="object-contain w-full h-full" />
                    </div>
                    <span className="text-[11.5px] font-[600] text-gray-400 tracking-wide uppercase">Wint IR</span>
                  </div>
                )}

                {/* User message */}
                {msg.role === 'user' && (
                  <div className="group flex items-end gap-2 justify-end">
                    <button
                      onClick={() => editMessage(msg, index)}
                      disabled={loading}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 disabled:hidden shrink-0 mb-1"
                      title="Edit message"
                    >
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M10 2l2 2-7 7H3v-2l7-7z"/>
                      </svg>
                    </button>
                    <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-[14.5px] leading-[1.6] font-[450] bg-[#2d9e4f] text-white shadow-sm">
                      {msg.content}
                    </div>
                  </div>
                )}

                {/* Assistant: loading / thinking */}
                {msg.role === 'assistant' && msg.loading && (
                  <div className="px-4 py-3.5 rounded-2xl rounded-tl-sm bg-white border border-gray-200/80 shadow-[0_1px_4px_rgba(0,0,0,0.05)] inline-flex">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-[#2d9e4f]/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-[#2d9e4f]/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-[#2d9e4f]/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}

                {/* Assistant: form step */}
                {msg.role === 'assistant' && msg.form && !msg.loading && (
                  <div className="bg-white border border-gray-200/80 rounded-2xl rounded-tl-sm shadow-[0_1px_4px_rgba(0,0,0,0.05)] overflow-hidden">
                    {msg.form.submitted ? (
                      <div className="px-5 py-3.5 flex items-center gap-2.5">
                        <span className="w-4 h-4 rounded-full bg-[#2d9e4f]/10 flex items-center justify-center shrink-0">
                          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="#2d9e4f" strokeWidth="2.5">
                            <path d="M3 8l4 4 6-6"/>
                          </svg>
                        </span>
                        <span className="text-[13px] text-gray-400">
                          {msg.form.stepTitle ? `${msg.form.stepTitle} — submitted` : 'Step submitted'}
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="px-5 pt-4 pb-3 border-b border-gray-100">
                          <div className="flex items-center gap-2.5">
                            <span className="w-[3px] h-[14px] bg-[#2d9e4f] rounded-full shrink-0" />
                            <p className="text-[11px] font-[700] text-[#2d9e4f] uppercase tracking-[0.1em]">
                              {msg.form.stepTitle || 'Context Required'}
                            </p>
                          </div>
                          <p className="text-[12px] text-gray-400 mt-1.5 pl-[17px]">
                            {msg.form.questions.every(q => q.options && q.options.length > 0)
                              ? 'Select an answer for each field'
                              : 'Select or type an answer for each field'}
                          </p>
                        </div>
                        <div className="px-5 py-5 space-y-5">
                          {msg.form.questions.map(q => {
                            const isText = q.type === 'text' || !q.options || q.options.length === 0;
                            return (
                            <div key={q.id}>
                              <label className="block text-[13.5px] font-[600] text-[#111827] mb-3">{q.label}</label>
                              {isText ? (
                                <input
                                  type="text"
                                  disabled={loading}
                                  value={msg.form!.answers[q.id] || ''}
                                  onChange={e => updateFormAnswer(msg.id, q.id, e.target.value)}
                                  placeholder={q.placeholder || 'Type your answer…'}
                                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13.5px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/40 focus:border-[#2d9e4f]/60 placeholder-gray-400 disabled:opacity-50 transition"
                                />
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {(q.options ?? []).map(opt => {
                                    const selected = msg.form!.answers[q.id] === opt;
                                    return (
                                      <button
                                        key={opt}
                                        type="button"
                                        disabled={loading}
                                        onClick={() => updateFormAnswer(msg.id, q.id, opt)}
                                        className={`px-4 py-1.5 text-[13px] rounded-full border transition-all font-[500] disabled:opacity-50 ${
                                          selected
                                            ? 'bg-[#2d9e4f] border-[#2d9e4f] text-white shadow-sm'
                                            : 'bg-white border-gray-200 text-gray-600 hover:border-[#2d9e4f]/70 hover:text-[#2d9e4f] hover:bg-[#2d9e4f]/5'
                                        }`}
                                      >
                                        {opt}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                        <div className="px-5 pb-5">
                          <button
                            onClick={() => submitForm(msg.id)}
                            disabled={loading || msg.form.questions.some(q => !msg.form!.answers[q.id]?.trim())}
                            className="w-full bg-[#111827] hover:bg-[#1f2937] disabled:opacity-25 disabled:cursor-not-allowed text-white text-[13.5px] font-[600] py-2.5 rounded-xl transition-all"
                          >
                            {loading
                              ? 'Processing…'
                              : `Continue — ${msg.form.questions.filter(q => msg.form!.answers[q.id]?.trim()).length} / ${msg.form.questions.length} answered`}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Assistant: text answer */}
                {msg.role === 'assistant' && !msg.loading && !msg.form && msg.content && (
                  <div className="px-6 py-5 rounded-2xl rounded-tl-sm bg-white border border-gray-200/80 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
                    {renderContent(msg.content)}
                  </div>
                )}

              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-6 py-4">
        <form onSubmit={handleSubmit} className="flex gap-3 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Describe the user issue or ask a policy question..."
            rows={1}
            className="flex-1 resize-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/40 focus:border-[#2d9e4f]/60 transition max-h-36 placeholder-gray-400"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-[#2d9e4f] hover:bg-[#27883f] disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-3 rounded-xl transition-all flex items-center gap-2 text-sm font-semibold shrink-0 shadow-sm"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 13.5L14 8 2 2.5v4l8.5 1.5L2 9.5v4z"/>
            </svg>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
