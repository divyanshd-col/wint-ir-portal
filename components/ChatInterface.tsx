'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { SavedConversation } from '@/lib/types';
import type { SourceChunk } from '@/lib/corrections';
import CorrectionPanel from './CorrectionPanel';

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
  reasoning?: string;
  answers: Record<string, string>;
  submitted: boolean;
  queryMessages: { role: string; content: string }[];
  category?: string | null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
  form?: MessageForm;
  education?: string;
  draft?: string;
  queryType?: string;
  formAnswers?: Record<string, string>;
  isClarify?: boolean;
  imagePreviewUrl?: string;
  sourceChunks?: SourceChunk[];
  showCorrectionPanel?: boolean;
  category?: string;
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
  const [collapsedPanels, setCollapsedPanels] = useState<Record<string, boolean>>({});
  const [copiedDraft, setCopiedDraft] = useState<Record<string, boolean>>({});
  const [draftLoading, setDraftLoading] = useState<Record<string, boolean>>({});
  const [draftExpanded, setDraftExpanded] = useState<Record<string, boolean>>({});
  const [draftContext, setDraftContext] = useState<Record<string, string>>({});
  const [attachedImage, setAttachedImage] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Persists the image through the async form loop so Stage 2 can also receive it
  const pendingImageRef = useRef<{ base64: string; mimeType: string } | null>(null);

  const compressImage = (file: File): Promise<{ base64: string; mimeType: string; previewUrl: string }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        URL.revokeObjectURL(url);
        resolve({ base64, mimeType: 'image/jpeg', previewUrl: dataUrl });
      };
      img.onerror = reject;
      img.src = url;
    });

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) { alert('Image must be under 10 MB'); return; }
    try {
      const compressed = await compressImage(file);
      setAttachedImage(compressed);
    } catch { /* silent — image simply won't be attached */ }
    e.target.value = '';
  };

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

  const fetchDraft = async (msgId: string, briefing: string, formAnswers?: Record<string, string>, agentContext?: string) => {
    setDraftLoading(prev => ({ ...prev, [msgId]: true }));
    setDraftExpanded(prev => ({ ...prev, [msgId]: false }));
    try {
      const res = await fetch('/api/chat/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefing, formAnswers: formAnswers || {}, agentContext: agentContext || '' }),
      });
      if (!res.ok) throw new Error('Failed');
      const { draft } = await res.json();
      if (draft) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, draft } : m));
      }
    } catch {
      // silent failure — button reappears
    } finally {
      setDraftLoading(prev => ({ ...prev, [msgId]: false }));
    }
  };

  // Stream the final answer with all accumulated evidence
  const streamAnswer = async (
    queryMessages: { role: string; content: string }[],
    formAnswers?: Record<string, string>,
    queryType: 'direct' | 'process' = 'process',
    category?: string | null,
    imageData?: { base64: string; mimeType: string } | null
  ) => {
    const assistantId = (Date.now() + 2).toString();
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', loading: true, queryType, formAnswers, category: category ?? undefined };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: queryMessages, formAnswers, queryType, category, imageData: imageData ?? undefined }),
      });

      if (!res.ok) throw new Error('Failed to get response');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let streamDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[FINAL]') { streamDone = true; break; }
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text') {
              fullText += parsed.text;
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, content: fullText, loading: false } : m)
              );
            } else if (parsed.type === 'education') {
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, education: parsed.text } : m)
              );
            } else if (parsed.type === 'sources' && Array.isArray(parsed.sources)) {
              // Capture source chunks so the correction panel can reference them
              const chunks: SourceChunk[] = parsed.sources.map((s: any) => ({
                fileId: s.fileId || '',
                fileName: s.fileName || '',
                breadcrumb: s.excerpt?.split('\n')[0] || '',
                excerpt: s.excerpt || '',
              }));
              setMessages(prev =>
                prev.map(m => m.id === assistantId ? { ...m, sourceChunks: chunks } : m)
              );
            }
          } catch {}
        }
        if (streamDone) break;
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
    stepCount: number = 0,
    knownCategory?: string | null
  ) => {
    // Hard cap: after 6 steps always go to final answer regardless
    if (stepCount >= 6) {
      await streamAnswer(queryMessages, accumulated, 'process', knownCategory);
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

      const { queryType, category: responseCategory, questions, stepTitle, clarificationMessage, reasoning } = await analyzeRes.json();
      // Persist category once identified — subsequent steps reuse it
      const category = responseCategory || knownCategory || null;

      // Direct queries skip the form entirely
      if (queryType === 'direct') {
        await streamAnswer(queryMessages, undefined, 'direct', null);
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
          isClarify: true,
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
            reasoning: reasoning || '',
            answers: {},
            submitted: false,
            queryMessages,
            category,
          },
        }]);
        setLoading(false);
      } else {
        // No new questions — all evidence collected, stream final answer
        await streamAnswer(queryMessages, accumulated, 'process', category, pendingImageRef.current);
        pendingImageRef.current = null;
      }
    } catch {
      await streamAnswer(queryMessages, accumulated, 'process', knownCategory, pendingImageRef.current);
      pendingImageRef.current = null;
    }
  };

  // Initial message send — resets accumulated answers and starts Step 1
  const sendMessage = async (query: string, currentMessages: Message[] = messages) => {
    if ((!query.trim() && !attachedImage) || loading) return;

    // Gap 3: preserve accumulated answers if the agent is responding to a clarify message
    const lastAssistant = [...currentMessages].reverse().find(m => m.role === 'assistant' && !m.loading);
    const respondingToClarify = lastAssistant?.isClarify === true;

    // Capture image for this send — store in ref so it persists through the async form loop
    const capturedImage = attachedImage ? { base64: attachedImage.base64, mimeType: attachedImage.mimeType } : null;
    pendingImageRef.current = capturedImage;
    const previewUrl = attachedImage?.previewUrl;
    setAttachedImage(null);

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: query, imagePreviewUrl: previewUrl };
    const thinkingMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: '', loading: true };
    const newMessages = [...currentMessages, userMsg, thinkingMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    // Reset accumulated answers and step count for new query, but preserve them if continuing after clarify
    if (!respondingToClarify) {
      setAccumulatedAnswers({});
      setFormStepCount(0);
    }

    const apiMessages = newMessages
      .filter(m => !m.loading && !m.form)
      .map(m => ({ role: m.role, content: m.content }));

    // Pass preserved answers to analyze so it doesn't re-ask already-answered questions
    const answersForAnalyze = respondingToClarify ? accumulatedAnswers : {};

    try {
      const analyzeRes = await fetch('/api/chat/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, allAnswers: answersForAnalyze, imageData: capturedImage }),
      });

      const { queryType, category, questions, stepTitle, clarificationMessage, reasoning, extractedFacts } = await analyzeRes.json();

      // Direct queries: skip form, answer immediately
      if (queryType === 'direct' || !questions || questions.length === 0) {
        setMessages(prev => prev.filter(m => m.id !== thinkingMsg.id));
        // Gap 2: when process resolves immediately, pass extracted facts as formAnswers so Stage 2 uses scenario mapping
        const facts = (queryType === 'process' && extractedFacts && Object.keys(extractedFacts).length > 0)
          ? extractedFacts : undefined;
        await streamAnswer(apiMessages, facts, queryType === 'direct' ? 'direct' : 'process', category, capturedImage);
        pendingImageRef.current = null;
      } else if (queryType === 'clarify' && clarificationMessage) {
        // Clarify: replace thinking dot with a conversational question
        setMessages(prev =>
          prev.map(m =>
            m.id === thinkingMsg.id
              ? { ...m, loading: false, content: clarificationMessage, isClarify: true }
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
                    reasoning: reasoning || '',
                    answers: {},
                    submitted: false,
                    queryMessages: apiMessages,
                    category,
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
    await analyzeAndProceed(msg.form.queryMessages, newAccumulated, newStepCount, msg.form.category);
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
                    <div className="flex flex-col items-end gap-1.5 max-w-full">
                      {msg.imagePreviewUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={msg.imagePreviewUrl} alt="Attached screenshot" className="rounded-xl max-w-[220px] max-h-[160px] object-cover border border-white/20 shadow-sm" />
                      )}
                      {msg.content && (
                        <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-[14.5px] leading-[1.6] font-[450] bg-[#2d9e4f] text-white shadow-sm">
                          {msg.content}
                        </div>
                      )}
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
                          {msg.form.reasoning && (
                            <p className="text-[12.5px] text-gray-500 mt-1.5 pl-[17px] leading-relaxed italic">
                              {msg.form.reasoning}
                            </p>
                          )}
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
                                  {/* Other: escape hatch when no option fits */}
                                  {(() => {
                                    const cur = msg.form!.answers[q.id] ?? '';
                                    const isOtherMode = cur === '__other__' || (cur !== '' && !(q.options ?? []).includes(cur));
                                    return (
                                      <>
                                        <button
                                          type="button"
                                          disabled={loading}
                                          onClick={() => updateFormAnswer(msg.id, q.id, '__other__')}
                                          className={`px-4 py-1.5 text-[13px] rounded-full border transition-all font-[500] disabled:opacity-50 ${
                                            isOtherMode
                                              ? 'bg-[#2d9e4f] border-[#2d9e4f] text-white shadow-sm'
                                              : 'bg-white border-gray-200 text-gray-600 hover:border-[#2d9e4f]/70 hover:text-[#2d9e4f] hover:bg-[#2d9e4f]/5'
                                          }`}
                                        >
                                          Other
                                        </button>
                                        {isOtherMode && (
                                          <input
                                            type="text"
                                            autoFocus
                                            disabled={loading}
                                            value={cur === '__other__' ? '' : cur}
                                            onChange={e => updateFormAnswer(msg.id, q.id, e.target.value || '__other__')}
                                            placeholder="Describe the situation…"
                                            className="w-full mt-2 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-[13.5px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/40 focus:border-[#2d9e4f]/60 placeholder-gray-400 disabled:opacity-50 transition"
                                          />
                                        )}
                                      </>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                        <div className="px-5 pb-5">
                          <button
                            onClick={() => submitForm(msg.id)}
                            disabled={loading || msg.form.questions.some(q => {
                              const ans = msg.form!.answers[q.id] ?? '';
                              return !ans.trim() || ans === '__other__';
                            })}
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
                  <>
                    {/* Why This Happens — shown FIRST, before the answer */}
                    {msg.education && (
                      <div className="mb-3 bg-amber-50 border border-amber-200/70 rounded-xl overflow-hidden">
                        <button
                          className="w-full px-4 py-2.5 flex items-center gap-2 text-left"
                          onClick={() => setCollapsedPanels(prev => ({ ...prev, [`${msg.id}-education`]: !prev[`${msg.id}-education`] }))}
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#92400e" strokeWidth="1.5" className="shrink-0">
                            <circle cx="8" cy="8" r="6"/>
                            <path d="M8 7v3M8 5.5v.5"/>
                          </svg>
                          <span className="flex-1 text-[11px] font-[700] text-amber-700 uppercase tracking-[0.09em]">Why This Happens</span>
                          <svg
                            width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#92400e" strokeWidth="1.5"
                            className={`shrink-0 transition-transform ${collapsedPanels[`${msg.id}-education`] ? '-rotate-90' : ''}`}
                          >
                            <path d="M2 4l4 4 4-4"/>
                          </svg>
                        </button>
                        {!collapsedPanels[`${msg.id}-education`] && (
                          <div className="px-4 pb-3.5">
                            <p className="text-[13.5px] leading-[1.7] text-amber-900">{msg.education}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Main answer */}
                    <div className="px-6 py-5 rounded-2xl rounded-tl-sm bg-white border border-gray-200/80 shadow-[0_1px_4px_rgba(0,0,0,0.05)]">
                      {renderContent(msg.content)}
                    </div>

                    {/* Draft panel (if generated) or Frame a response with context input */}
                    {msg.queryType === 'process' && (
                      msg.draft ? (
                        <div className="mt-3 bg-blue-50 border border-blue-200/70 rounded-xl overflow-hidden">
                          <div className="px-4 py-2.5 flex items-center gap-2">
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#1d4ed8" strokeWidth="1.5" className="shrink-0">
                              <rect x="1" y="4" width="14" height="10" rx="1"/>
                              <path d="M1 7l7 4 7-4"/>
                            </svg>
                            <span className="flex-1 text-[11px] font-[700] text-blue-700 uppercase tracking-[0.09em]">Customer Message Draft</span>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => {
                                  setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, draft: undefined } : m));
                                  setDraftExpanded(prev => ({ ...prev, [msg.id]: true }));
                                }}
                                className="text-blue-400 hover:text-blue-600 transition-colors text-[11px] font-medium mr-1"
                                title="Regenerate with different context"
                              >
                                Redo
                              </button>
                              <button
                                onClick={() => setCollapsedPanels(prev => ({ ...prev, [`${msg.id}-draft`]: !prev[`${msg.id}-draft`] }))}
                                className="text-blue-400 hover:text-blue-600 transition-colors"
                                title="Toggle"
                              >
                                <svg
                                  width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
                                  className={`shrink-0 transition-transform ${collapsedPanels[`${msg.id}-draft`] ? '-rotate-90' : ''}`}
                                >
                                  <path d="M2 4l4 4 4-4"/>
                                </svg>
                              </button>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.draft!);
                                  setCopiedDraft(prev => ({ ...prev, [msg.id]: true }));
                                  setTimeout(() => setCopiedDraft(prev => ({ ...prev, [msg.id]: false })), 2000);
                                }}
                                className="text-blue-400 hover:text-blue-600 transition-colors"
                                title="Copy to clipboard"
                              >
                                {copiedDraft[msg.id] ? (
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M3 8l4 4 6-6"/>
                                  </svg>
                                ) : (
                                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <rect x="5" y="5" width="8" height="8" rx="1"/>
                                    <path d="M11 5V3H3v8h2"/>
                                  </svg>
                                )}
                              </button>
                            </div>
                          </div>
                          {!collapsedPanels[`${msg.id}-draft`] && (
                            <div className="px-4 pb-3.5">
                              <p className="text-[13.5px] leading-[1.7] text-blue-900 whitespace-pre-wrap">{msg.draft}</p>
                            </div>
                          )}
                        </div>
                      ) : draftExpanded[msg.id] ? (
                        /* Expanded: context input form */
                        <div className="mt-3 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
                          <div className="px-4 pt-3.5 pb-1 flex items-center gap-2 border-b border-gray-100">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400 shrink-0">
                              <path d="M10 2l2 2-7 7H3v-2l7-7z"/>
                            </svg>
                            <span className="text-[11px] font-[700] text-gray-500 uppercase tracking-[0.09em]">Frame a response</span>
                          </div>
                          <div className="px-4 py-3.5 space-y-3">
                            <div>
                              <label className="block text-[12px] font-[600] text-gray-500 mb-1.5">
                                Add context <span className="text-gray-400 font-normal">(optional)</span>
                              </label>
                              <textarea
                                autoFocus
                                rows={2}
                                value={draftContext[msg.id] || ''}
                                onChange={e => setDraftContext(prev => ({ ...prev, [msg.id]: e.target.value }))}
                                placeholder="e.g. User already tried reinstalling the app · This is a premium investor · User is frustrated, second time reaching out…"
                                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[13px] text-[#111827] placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 focus:border-[#2d9e4f]/50 resize-none leading-relaxed transition"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => fetchDraft(msg.id, msg.content, msg.formAnswers, draftContext[msg.id])}
                                disabled={draftLoading[msg.id]}
                                className="flex items-center gap-1.5 bg-[#111827] hover:bg-[#1f2937] text-white text-[12.5px] font-[600] px-4 py-2 rounded-lg transition disabled:opacity-40"
                              >
                                {draftLoading[msg.id] ? (
                                  <>
                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="animate-spin">
                                      <path d="M8 2a6 6 0 1 0 6 6"/>
                                    </svg>
                                    Drafting…
                                  </>
                                ) : (
                                  <>Generate draft →</>
                                )}
                              </button>
                              <button
                                onClick={() => setDraftExpanded(prev => ({ ...prev, [msg.id]: false }))}
                                className="text-[12px] text-gray-400 hover:text-gray-600 px-2 py-2 transition"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Collapsed: just the button */
                        <button
                          onClick={() => setDraftExpanded(prev => ({ ...prev, [msg.id]: true }))}
                          disabled={draftLoading[msg.id]}
                          className="mt-3 flex items-center gap-2 text-[12px] text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 bg-white"
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                            <path d="M10 2l2 2-7 7H3v-2l7-7z"/>
                          </svg>
                          Frame a response
                        </button>
                      )
                    )}

                    {/* Flag & Correct button — available on all process answers */}
                    {msg.queryType === 'process' && !msg.showCorrectionPanel && (
                      <button
                        onClick={() => setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, showCorrectionPanel: true } : m))}
                        className="mt-3 flex items-center gap-2 text-[12px] text-gray-400 hover:text-red-500 border border-gray-200 hover:border-red-300 rounded-lg px-3 py-1.5 transition-colors bg-white"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0">
                          <path d="M3 2v12M3 2l10 5-10 5"/>
                        </svg>
                        Flag & Correct
                      </button>
                    )}

                    {/* Correction panel */}
                    {msg.showCorrectionPanel && (
                      <CorrectionPanel
                        originalQuery={messages.find(m => m.role === 'user' && messages.indexOf(m) < messages.indexOf(msg))?.content || ''}
                        originalAnswer={msg.content}
                        sourceChunks={msg.sourceChunks || []}
                        formAnswers={msg.formAnswers}
                        category={msg.category}
                        onClose={() => setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, showCorrectionPanel: false } : m))}
                      />
                    )}
                  </>
                )}

              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-6 py-4">
        {/* Image preview */}
        {attachedImage && (
          <div className="mb-3 flex items-start gap-2">
            <div className="relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={attachedImage.previewUrl} alt="Attached" className="h-16 w-auto rounded-lg object-cover border border-gray-200 shadow-sm" />
              <button
                type="button"
                onClick={() => setAttachedImage(null)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gray-500 text-white flex items-center justify-center hover:bg-gray-700 transition-colors"
              >
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 1l6 6M7 1L1 7"/>
                </svg>
              </button>
            </div>
            <span className="text-[12px] text-gray-400 mt-1">Screenshot attached</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-3 items-end">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageSelect}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            title="Attach screenshot"
            className="shrink-0 p-3 rounded-xl border border-gray-200 bg-gray-50 text-gray-400 hover:text-[#2d9e4f] hover:border-[#2d9e4f]/50 hover:bg-[#2d9e4f]/5 transition-all disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="3" width="14" height="10" rx="1.5"/>
              <circle cx="5.5" cy="7" r="1.5"/>
              <path d="M1 11l4-3.5 3 2.5 2.5-2 4.5 3.5"/>
            </svg>
          </button>
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
            disabled={loading || (!input.trim() && !attachedImage)}
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
