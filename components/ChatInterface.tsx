'use client';

import { useState, useRef, useEffect } from 'react';

interface FormQuestion {
  id: string;
  label: string;
  placeholder?: string;
  options?: string[];
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

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1');
}

function renderInlineContent(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/\S+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const href = match[2] || match[3];
    const label = match[1] || match[3];
    parts.push(
      <a key={`${keyPrefix}-link-${match.index}`} href={href} target="_blank" rel="noopener noreferrer"
         className="text-[#2d9e4f] underline underline-offset-2 hover:text-[#27883f] break-all">
        {label}
      </a>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderContent(text: string): React.ReactNode {
  const stripped = stripMarkdown(text);
  const paragraphs = stripped.split(/\n{2,}/);

  return (
    <div className="space-y-3">
      {paragraphs.map((para, pi) => {
        const lines = para.split('\n').filter(l => l.trim());
        if (lines.length === 0) return null;

        // Check if all lines in this paragraph are numbered steps
        const allNumbered = lines.every(l => /^\d+[\.)]\s+/.test(l.trim()));

        if (allNumbered) {
          return (
            <ol key={pi} className="space-y-1.5 pl-1">
              {lines.map((line, li) => {
                const content = line.replace(/^\d+[\.)]\s+/, '');
                const num = (line.match(/^(\d+)/) || [])[1];
                return (
                  <li key={li} className="flex gap-2.5 text-sm leading-relaxed">
                    <span className="flex-shrink-0 w-5 h-5 bg-[#2d9e4f]/10 text-[#2d9e4f] rounded-full text-[11px] font-bold flex items-center justify-center mt-0.5">{num}</span>
                    <span className="text-gray-700">{renderInlineContent(content, `${pi}-${li}`)}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Mixed or single lines — render as paragraph with line breaks
        return (
          <p key={pi} className="text-sm leading-relaxed text-gray-700">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInlineContent(line.trim(), `${pi}-${li}`)}
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

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [accumulatedAnswers, setAccumulatedAnswers] = useState<Record<string, string>>({});
  const [formStepCount, setFormStepCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    } catch {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: 'Sorry, I encountered an error. Please try again or contact ir@wintwealth.com.', loading: false }
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

    try {
      const analyzeRes = await fetch('/api/chat/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: queryMessages, allAnswers: accumulated }),
      });

      const { queryType, questions, stepTitle } = await analyzeRes.json();

      // Direct queries skip the form entirely
      if (queryType === 'direct') {
        await streamAnswer(queryMessages, undefined, 'direct');
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

      const { queryType, questions, stepTitle } = await analyzeRes.json();

      // Direct queries: skip form, answer immediately
      if (queryType === 'direct' || !questions || questions.length === 0) {
        setMessages(prev => prev.filter(m => m.id !== thinkingMsg.id));
        await streamAnswer(apiMessages, undefined, queryType === 'direct' ? 'direct' : 'process');
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
    <div className="flex flex-col h-full bg-[#f8f9fb]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="mb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wint-logo.png" alt="Wint Wealth" width={120} height={48} className="object-contain mx-auto" />
            </div>
            <h2 className="text-2xl font-semibold text-[#111] mb-2 tracking-tight">IR Support Assistant</h2>
            <p className="text-gray-400 text-sm max-w-xs mb-10">
              Select a common issue below or describe the user&apos;s problem.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
              {SUGGESTED_QUESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-left px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:border-[#2d9e4f]/60 hover:bg-[#2d9e4f]/5 hover:text-[#2d9e4f] transition-all shadow-sm"
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
                  <div className="flex items-center gap-2 mb-2 ml-1">
                    <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 bg-white border border-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/wint-logo.png" alt="Wint" className="object-contain w-full h-full p-0.5" />
                    </div>
                    <span className="text-xs font-medium text-gray-400 tracking-wide">Wint IR Assistant</span>
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
                    <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed bg-[#2d9e4f] text-white shadow-sm">
                      {msg.content}
                    </div>
                  </div>
                )}

                {/* Assistant: loading / thinking */}
                {msg.role === 'assistant' && msg.loading && (
                  <div className="px-4 py-3.5 rounded-2xl rounded-tl-sm bg-white border border-gray-100 shadow-sm inline-flex">
                    <div className="flex gap-1.5 items-center">
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}

                {/* Assistant: form step */}
                {msg.role === 'assistant' && msg.form && !msg.loading && (
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm overflow-hidden">
                    {msg.form.submitted ? (
                      <div className="px-5 py-4 flex items-center gap-2.5 text-sm text-gray-500">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2d9e4f" strokeWidth="2">
                          <path d="M3 8l4 4 6-6"/>
                        </svg>
                        {msg.form.stepTitle ? `${msg.form.stepTitle} — submitted` : 'Step submitted — processing...'}
                      </div>
                    ) : (
                      <>
                        <div className="px-5 pt-4 pb-3 border-b border-gray-100 bg-gray-50/60">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">
                            {msg.form.stepTitle || 'Context Required'}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">Answer all fields to continue</p>
                        </div>
                        <div className="px-5 py-4 space-y-4">
                          {msg.form.questions.map(q => (
                            <div key={q.id}>
                              <label className="block text-xs font-semibold text-gray-600 mb-2">{q.label}</label>
                              <div className="flex flex-wrap gap-2">
                                {(q.options ?? []).map(opt => {
                                  const selected = msg.form!.answers[q.id] === opt;
                                  return (
                                    <button
                                      key={opt}
                                      type="button"
                                      disabled={loading}
                                      onClick={() => updateFormAnswer(msg.id, q.id, opt)}
                                      className={`px-3.5 py-1.5 text-xs rounded-lg border transition-all font-medium disabled:opacity-50 ${
                                        selected
                                          ? 'bg-[#2d9e4f] border-[#2d9e4f] text-white shadow-sm'
                                          : 'bg-white border-gray-200 text-gray-500 hover:border-[#2d9e4f]/50 hover:text-[#2d9e4f]'
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="px-5 pb-5">
                          <button
                            onClick={() => submitForm(msg.id)}
                            disabled={loading || msg.form.questions.some(q => !msg.form!.answers[q.id]?.trim())}
                            className="w-full bg-[#2d9e4f] hover:bg-[#27883f] disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-semibold py-2.5 rounded-lg transition-all tracking-wide"
                          >
                            {loading
                              ? 'Processing…'
                              : `Continue  ${msg.form.questions.filter(q => msg.form!.answers[q.id]?.trim()).length}/${msg.form.questions.length} answered`}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Assistant: text answer */}
                {msg.role === 'assistant' && !msg.loading && !msg.form && msg.content && (
                  <div className="px-5 py-4 rounded-2xl rounded-tl-sm bg-white border border-gray-100 shadow-sm">
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
