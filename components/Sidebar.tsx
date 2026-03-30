'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import type { SavedConversation } from '@/lib/types';

interface SidebarProps {
  username: string;
  isAdmin?: boolean;
  role?: string;
  historyEnabled?: boolean;
  onRestoreConversation?: (conv: SavedConversation) => void;
  onNewChat?: () => void;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortLabel(url: string): string {
  try {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1].slice(0, 14) + '…';
    return url.slice(0, 30) + '…';
  } catch { return url; }
}

export default function Sidebar({ username, isAdmin, role, historyEnabled = false, onRestoreConversation, onNewChat }: SidebarProps) {
  const canSeeQuality = isAdmin || role === 'quality' || role === 'tl';
  const [open, setOpen] = useState(true);
  const [view, setView] = useState<'main' | 'settings'>('main');

  // Admin state
  const [docs, setDocs] = useState<string[]>([]);
  const [llmProvider, setLlmProvider] = useState<'gemini' | 'claude'>('gemini');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash'); // routing model (analyze); answers always use Pro
  const [newUrl, setNewUrl] = useState('');
  const [addingDoc, setAddingDoc] = useState(false);
  const [docError, setDocError] = useState('');
  const [refreshingKB, setRefreshingKB] = useState(false);
  const [kbRefreshed, setKbRefreshed] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [hasAnthropicKey, setHasAnthropicKey] = useState(false);
  const [activeGeminiKey, setActiveGeminiKey] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [geminiKeysSet, setGeminiKeysSet] = useState<Record<number, boolean>>({});
  const [newKeyInput, setNewKeyInput] = useState('');
  const [editingKeySlot, setEditingKeySlot] = useState<number | null>(null);
  const [savingNewKey, setSavingNewKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [slackToken, setSlackToken] = useState('');
  const [hasSlackToken, setHasSlackToken] = useState(false);
  const [savingSlack, setSavingSlack] = useState(false);
  const [slackSaved, setSlackSaved] = useState(false);

  // User management
  const [users, setUsers] = useState<{ username: string; email: string; role: string; isAdmin: boolean }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'agent' | 'admin' | 'quality' | 'tl'>('agent');
  const [addingUser, setAddingUser] = useState(false);
  const [userError, setUserError] = useState('');
  const [downloadingLogs, setDownloadingLogs] = useState(false);

  // Conversation history
  const [conversations, setConversations] = useState<SavedConversation[]>([]);
  const [historyEnabledLocal, setHistoryEnabledLocal] = useState(historyEnabled);

  useEffect(() => {
    if (!historyEnabled) return;
    fetch('/api/conversations')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setConversations(data); })
      .catch(() => {});
  }, [historyEnabled]);

  useEffect(() => {
    if (!isAdmin) return;
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setDocs(data.knowledgeBaseUrls || []);
        setLlmProvider(data.llmProvider || 'gemini');
        setGeminiModel(data.geminiModel || 'gemini-2.5-flash');
        setActiveGeminiKey(data.activeGeminiKey || 1);
        setGeminiKeysSet({
          1: !!data.geminiApiKey,
          2: !!data.geminiApiKey2,
          3: !!data.geminiApiKey3,
          4: !!data.geminiApiKey4,
          5: !!data.geminiApiKey5,
        });
        setHasAnthropicKey(!!data.anthropicApiKey);
        setSystemPrompt(data.systemPrompt || '');
        setHasSlackToken(!!data.slackUserToken);
      })
      .catch(() => {});
    refreshUsers();
  }, [isAdmin]);

  const toggleHistory = async () => {
    const next = !historyEnabledLocal;
    setHistoryEnabledLocal(next);
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationHistoryEnabled: next }),
    });
    if (next) {
      // Load conversations immediately after enabling
      fetch('/api/conversations')
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setConversations(data); })
        .catch(() => {});
    }
  };

  const refreshKB = async () => {
    setRefreshingKB(true);
    setKbRefreshed(false);
    try {
      await fetch('/api/kb-refresh', { method: 'POST' });
      setKbRefreshed(true);
      setTimeout(() => setKbRefreshed(false), 3000);
    } finally { setRefreshingKB(false); }
  };

  const addDoc = async () => {
    if (!newUrl.trim()) return;
    setAddingDoc(true);
    setDocError('');
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setDocError(data.error || 'Failed to add'); return; }
      setDocs(data.knowledgeBaseUrls);
      setNewUrl('');
    } catch { setDocError('Network error'); }
    finally { setAddingDoc(false); }
  };

  const removeDoc = async (url: string) => {
    try {
      const res = await fetch('/api/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (res.ok) setDocs(data.knowledgeBaseUrls);
    } catch {}
  };

  const switchProvider = async (provider: 'gemini' | 'claude') => {
    setLlmProvider(provider);
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llmProvider: provider }),
    });
  };

  const switchGeminiKey = async (key: 1 | 2 | 3 | 4 | 5) => {
    setActiveGeminiKey(key);
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeGeminiKey: key }),
    });
  };

  const saveNewKey = async (slot: number) => {
    if (!newKeyInput.trim()) return;
    setSavingNewKey(true);
    try {
      await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [`geminiApiKey${slot > 1 ? slot : ''}`]: newKeyInput.trim() }),
      });
      setGeminiKeysSet(prev => ({ ...prev, [slot]: true }));
      setNewKeyInput('');
      setEditingKeySlot(null);
    } finally { setSavingNewKey(false); }
  };

  const switchGeminiModel = async (model: string) => {
    setGeminiModel(model);
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geminiModel: model }),
    });
  };

  const saveAnthropicKey = async () => {
    if (!anthropicKey.trim()) return;
    setSavingKey(true);
    try {
      await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropicApiKey: anthropicKey.trim() }),
      });
      setHasAnthropicKey(true);
      setAnthropicKey('');
    } finally { setSavingKey(false); }
  };

  const saveSystemPrompt = async () => {
    setSavingPrompt(true);
    setPromptSaved(false);
    try {
      await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt }),
      });
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2000);
    } finally { setSavingPrompt(false); }
  };

  const saveSlackToken = async () => {
    if (!slackToken.trim()) return;
    setSavingSlack(true);
    setSlackSaved(false);
    try {
      await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackUserToken: slackToken.trim() }),
      });
      setHasSlackToken(true);
      setSlackToken('');
      setSlackSaved(true);
      setTimeout(() => setSlackSaved(false), 2000);
    } finally { setSavingSlack(false); }
  };

  const refreshUsers = async () => {
    setLoadingUsers(true);
    try {
      const data = await fetch('/api/users').then(r => r.json());
      setUsers(Array.isArray(data) ? data : []);
    } catch {} finally { setLoadingUsers(false); }
  };

  const addUser = async () => {
    if (!newEmail.trim()) return;
    setAddingUser(true);
    setUserError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) { setUserError(data.error || 'Failed'); return; }
      await refreshUsers();
      setNewEmail('');
      setNewRole('agent');
    } finally { setAddingUser(false); }
  };

  const updateUserRole = async (email: string, role: string) => {
    await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    await refreshUsers();
  };

  const deleteUser = async (email: string) => {
    const res = await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) setUsers(prev => prev.filter(u => u.email !== email));
  };

  const downloadLogs = async () => {
    setDownloadingLogs(true);
    try {
      const res = await fetch('/api/logs?format=csv');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wint-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    } finally {
      setDownloadingLogs(false);
    }
  };

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="lg:hidden fixed top-4 left-4 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-sm"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#1a1a1a" strokeWidth="1.5">
          <path d="M2 4h14M2 9h14M2 14h14"/>
        </svg>
      </button>

      <aside className={`${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 transition-transform fixed lg:static inset-y-0 left-0 z-40 w-72 bg-[#1a1a1a] flex flex-col`}>

        {/* Logo */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <div className="bg-white rounded-lg px-2.5 py-1.5 inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wint-logo.png" alt="Wint Wealth" width={68} height={22} className="object-contain block" />
            </div>
            <p className="text-gray-500 text-xs mt-2">IR Portal{role ? ` · ${role.charAt(0).toUpperCase() + role.slice(1)}` : ''}</p>
          </div>
          {isAdmin && view === 'settings' && (
            <button onClick={() => setView('main')} className="text-gray-400 hover:text-white transition p-1" title="Back">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M10 3L5 8l5 5"/>
              </svg>
            </button>
          )}
        </div>

        {/* ── MAIN VIEW ── */}
        {view === 'main' && (
          <nav className="px-4 py-4 flex-1 overflow-y-auto space-y-1">
            <button
              onClick={onNewChat}
              className="w-full flex items-center gap-3 px-3 py-2.5 bg-[#2d9e4f]/20 text-[#2d9e4f] rounded-lg text-sm font-medium hover:bg-[#2d9e4f]/30 transition"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 13.5L14 8 2 2.5v4l8.5 1.5L2 9.5v4z"/>
              </svg>
              New Chat
            </button>

            {/* Recent conversations */}
            {historyEnabledLocal && conversations.length > 0 && (
              <div className="pt-3">
                <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-3 mb-1.5">Recent</p>
                <div className="space-y-0.5">
                  {conversations.map(conv => (
                    <button
                      key={conv.id}
                      onClick={() => onRestoreConversation?.(conv)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 transition group"
                    >
                      <p className="text-gray-300 text-xs truncate group-hover:text-white transition">{conv.title}</p>
                      <p className="text-gray-600 text-[10px] mt-0.5">{formatTimeAgo(conv.timestamp)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="pt-2">
                <Link
                  href="/analytics"
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M2 12l3-4 3 2 3-5 3 3"/>
                    <rect x="1" y="1" width="14" height="14" rx="1.5"/>
                  </svg>
                  Analytics
                </Link>
              </div>
            )}
            {canSeeQuality && (
              <div className={isAdmin ? '' : 'pt-2'}>
                <Link
                  href="/quality"
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M8 1l1.8 3.6L14 5.6l-3 2.9.7 4.1L8 10.5l-3.7 2.1.7-4.1-3-2.9 4.2-.4z"/>
                  </svg>
                  Quality
                </Link>
              </div>
            )}
          </nav>
        )}

        {/* ── SETTINGS VIEW ── */}
        {view === 'settings' && isAdmin && (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">

            {/* Knowledge Base */}
            <section>
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-1 mb-2">Knowledge Base</p>
              <div className="space-y-1 mb-2">
                {docs.length === 0 && <p className="text-gray-600 text-xs px-1">No documents added yet.</p>}
                {docs.map(url => (
                  <div key={url} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 group">
                    <span className="text-sm">📄</span>
                    <span className="text-gray-300 text-xs truncate flex-1" title={url}>{shortLabel(url)}</span>
                    <button onClick={() => removeDoc(url)} className="text-gray-600 hover:text-red-400 text-xs opacity-0 group-hover:opacity-100 transition" title="Remove">×</button>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <input
                  type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addDoc()}
                  placeholder="Paste Google Doc URL…"
                  className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f] placeholder-gray-600"
                />
                {docError && <p className="text-red-400 text-xs">{docError}</p>}
                <button onClick={addDoc} disabled={addingDoc || !newUrl.trim()}
                  className="w-full bg-[#2d9e4f]/20 hover:bg-[#2d9e4f]/40 disabled:opacity-40 text-[#2d9e4f] text-xs font-medium py-1.5 rounded-lg transition">
                  {addingDoc ? 'Adding…' : '+ Add Document'}
                </button>
                <button onClick={refreshKB} disabled={refreshingKB}
                  className="w-full bg-white/5 hover:bg-white/10 disabled:opacity-40 text-gray-300 hover:text-white text-xs font-medium py-1.5 rounded-lg transition flex items-center justify-center gap-1.5">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className={refreshingKB ? 'animate-spin' : ''}>
                    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2M14 2v3h-3"/>
                  </svg>
                  {refreshingKB ? 'Refreshing…' : kbRefreshed ? '✓ KB Refreshed' : 'Refresh KB'}
                </button>
              </div>
            </section>

            <div className="border-t border-white/10" />

            {/* AI Model */}
            <section>
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-1 mb-1">AI Model</p>
              <p className="text-gray-600 text-[10px] px-1 mb-2">Routing uses Flash · Answers use Pro</p>
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                {(['gemini', 'claude'] as const).map(p => (
                  <button key={p} onClick={() => switchProvider(p)}
                    className={`flex-1 py-1.5 text-xs font-medium transition ${llmProvider === p ? 'bg-[#2d9e4f] text-white' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
                    {p === 'gemini' ? 'Gemini' : 'Claude'}
                  </button>
                ))}
              </div>

              {llmProvider === 'gemini' && (
                <>
                  <div className="mt-2">
                    <p className="text-gray-500 text-xs mb-1">Routing model</p>
                    <select value={geminiModel} onChange={e => switchGeminiModel(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f]">
                      <optgroup label="Gemini 3">
                        <option value="gemini-3-flash-preview">3 Flash (default)</option>
                      </optgroup>
                      <optgroup label="Gemini 2.5">
                        <option value="gemini-2.5-pro">2.5 Pro (fallback)</option>
                        <option value="gemini-2.5-flash">2.5 Flash</option>
                        <option value="gemini-2.5-flash-lite">2.5 Flash Lite</option>
                      </optgroup>
                      <optgroup label="Gemini 2.0">
                        <option value="gemini-2.0-flash">2.0 Flash</option>
                        <option value="gemini-2.0-flash-lite">2.0 Flash Lite</option>
                      </optgroup>
                    </select>
                  </div>
                  <div className="mt-3">
                    <p className="text-gray-500 text-xs mb-1">API Key slot</p>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                      {([1, 2, 3, 4, 5] as const).map(k => (
                        <button key={k} onClick={() => switchGeminiKey(k)}
                          className={`flex-1 py-1.5 text-xs font-medium transition ${activeGeminiKey === k ? 'bg-[#2d9e4f] text-white' : geminiKeysSet[k] ? 'bg-white/5 text-gray-300 hover:text-white' : 'bg-white/5 text-gray-600 hover:text-gray-400'}`}
                          title={geminiKeysSet[k] ? `Key ${k} (set)` : `Key ${k} (not set)`}>
                          {k}
                        </button>
                      ))}
                    </div>
                    {!geminiKeysSet[activeGeminiKey] && editingKeySlot !== activeGeminiKey && (
                      <button onClick={() => setEditingKeySlot(activeGeminiKey)}
                        className="mt-1.5 w-full text-xs text-amber-400 hover:text-amber-300 transition text-left px-1">
                        + Set Key {activeGeminiKey}
                      </button>
                    )}
                    {editingKeySlot === activeGeminiKey && (
                      <div className="mt-2 space-y-1">
                        <input type="password" value={newKeyInput} onChange={e => setNewKeyInput(e.target.value)} placeholder="AIza..."
                          className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f] placeholder-gray-600" />
                        <div className="flex gap-1">
                          <button onClick={() => saveNewKey(activeGeminiKey)} disabled={savingNewKey || !newKeyInput.trim()}
                            className="flex-1 bg-[#2d9e4f]/20 hover:bg-[#2d9e4f]/40 disabled:opacity-40 text-[#2d9e4f] text-xs font-medium py-1.5 rounded-lg transition">
                            {savingNewKey ? 'Saving…' : `Save Key ${activeGeminiKey}`}
                          </button>
                          <button onClick={() => { setEditingKeySlot(null); setNewKeyInput(''); }}
                            className="px-3 bg-white/5 text-gray-400 hover:text-white text-xs rounded-lg transition">✕</button>
                        </div>
                      </div>
                    )}
                    {geminiKeysSet[activeGeminiKey] && editingKeySlot !== activeGeminiKey && (
                      <p className="text-green-400 text-xs mt-1">✓ Using Key {activeGeminiKey}</p>
                    )}
                  </div>
                </>
              )}

              {llmProvider === 'claude' && !hasAnthropicKey && (
                <div className="mt-2 space-y-1">
                  <p className="text-amber-400 text-xs">No Anthropic key set.</p>
                  <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-..."
                    className="w-full bg-white/5 border border-amber-400/30 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder-gray-600" />
                  <button onClick={saveAnthropicKey} disabled={savingKey || !anthropicKey.trim()}
                    className="w-full bg-amber-400/20 hover:bg-amber-400/30 disabled:opacity-40 text-amber-400 text-xs font-medium py-1.5 rounded-lg transition">
                    {savingKey ? 'Saving…' : 'Save Key'}
                  </button>
                </div>
              )}
              {llmProvider === 'claude' && hasAnthropicKey && (
                <p className="text-green-400 text-xs mt-2">✓ Anthropic key configured</p>
              )}
            </section>

            <div className="border-t border-white/10" />

            {/* Conversation History toggle */}
            <section>
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-1 mb-2">Conversation History</p>
              <button
                onClick={toggleHistory}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border transition ${
                  historyEnabledLocal
                    ? 'bg-[#2d9e4f]/10 border-[#2d9e4f]/30 text-[#2d9e4f]'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                <span className="text-xs font-medium">Save last 5 conversations</span>
                <span className={`w-8 h-4 rounded-full relative transition-colors ${historyEnabledLocal ? 'bg-[#2d9e4f]' : 'bg-white/20'}`}>
                  <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${historyEnabledLocal ? 'left-4' : 'left-0.5'}`} />
                </span>
              </button>
              <p className="text-gray-600 text-[10px] px-1 mt-1.5">Only active for your account until you enable for all users.</p>
            </section>

            <div className="border-t border-white/10" />

            {/* System Prompt */}
            <section>
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-1 mb-2">System Prompt</p>
              <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={5}
                placeholder="Leave blank to use the default prompt…"
                className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f] placeholder-gray-600 resize-y" />
              <button onClick={saveSystemPrompt} disabled={savingPrompt}
                className="w-full mt-1 bg-[#2d9e4f]/20 hover:bg-[#2d9e4f]/40 disabled:opacity-40 text-[#2d9e4f] text-xs font-medium py-1.5 rounded-lg transition">
                {savingPrompt ? 'Saving…' : promptSaved ? '✓ Saved' : 'Save Prompt'}
              </button>
            </section>

            <div className="border-t border-white/10" />

            {/* Slack Fallback */}
            <section>
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-1 mb-2">Slack Fallback</p>
              {hasSlackToken ? (
                <p className="text-green-400 text-xs px-1 mb-2">✓ Slack token configured — searched when KB has no match</p>
              ) : (
                <p className="text-gray-500 text-xs px-1 mb-2">No token set — Slack fallback disabled</p>
              )}
              <div className="flex gap-1">
                <input
                  type="password"
                  value={slackToken}
                  onChange={e => setSlackToken(e.target.value)}
                  placeholder="xoxp-... user token"
                  className="flex-1 bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f] placeholder-gray-600"
                />
                <button
                  onClick={saveSlackToken}
                  disabled={savingSlack || !slackToken.trim()}
                  className="bg-[#2d9e4f]/20 hover:bg-[#2d9e4f]/40 disabled:opacity-40 text-[#2d9e4f] text-xs font-medium px-3 rounded-lg transition"
                >
                  {savingSlack ? '…' : slackSaved ? '✓' : 'Save'}
                </button>
              </div>
            </section>

            <div className="border-t border-white/10" />

            {/* Users */}
            <section>
              <div className="flex items-center justify-between px-1 mb-2">
                <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider">Users</p>
                <button onClick={refreshUsers} disabled={loadingUsers} className="text-gray-500 hover:text-gray-300 transition disabled:opacity-40" title="Refresh">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className={loadingUsers ? 'animate-spin' : ''}>
                    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2M14 2v3h-3"/>
                  </svg>
                </button>
              </div>

              <div className="rounded-lg overflow-hidden border border-white/10 mb-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/5">
                      <th className="text-left px-3 py-2 text-gray-400 font-medium">Email</th>
                      <th className="text-left px-3 py-2 text-gray-400 font-medium">Role</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.email} className="border-t border-white/5">
                        <td className="px-3 py-2 text-gray-200 text-[10px] truncate max-w-[100px]">{u.email}</td>
                        <td className="px-3 py-2">
                          <select
                            value={u.role}
                            onChange={e => updateUserRole(u.email, e.target.value)}
                            className="bg-transparent border border-white/10 text-gray-300 text-[10px] rounded px-1.5 py-0.5 focus:outline-none focus:border-[#2d9e4f]"
                          >
                            <option value="agent">Agent</option>
                            <option value="tl">TL</option>
                            <option value="quality">Quality</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => deleteUser(u.email)} className="text-gray-500 hover:text-red-400 transition" title="Remove">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="name@wintwealth.com"
                  className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f] placeholder-gray-600" />
                <select value={newRole} onChange={e => setNewRole(e.target.value as any)}
                  className="w-full bg-white/5 border border-white/10 text-gray-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#2d9e4f]">
                  <option value="agent">Agent</option>
                  <option value="tl">TL</option>
                  <option value="quality">Quality</option>
                  <option value="admin">Admin</option>
                </select>
                {userError && <p className="text-red-400 text-xs">{userError}</p>}
                <button onClick={addUser} disabled={addingUser || !newEmail.trim()}
                  className="w-full bg-[#2d9e4f]/20 hover:bg-[#2d9e4f]/40 disabled:opacity-40 text-[#2d9e4f] text-xs font-medium py-1.5 rounded-lg transition">
                  {addingUser ? 'Adding…' : '+ Add / Update User'}
                </button>
                <p className="text-gray-600 text-[10px]">User signs in via Google — no password needed</p>
              </div>
            </section>

            {/* Logs */}
            <section>
              <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider px-1 mb-2">Logs</p>
              <button onClick={downloadLogs} disabled={downloadingLogs}
                className="w-full bg-white/5 hover:bg-white/10 disabled:opacity-40 text-gray-300 hover:text-white text-xs font-medium py-1.5 rounded-lg transition">
                {downloadingLogs ? 'Downloading…' : '↓ Download Logs (CSV)'}
              </button>
            </section>

          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/10 space-y-2">
          {isAdmin && view === 'main' && (
            <button
              onClick={() => setView('settings')}
              className="w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg text-sm font-medium transition"
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2.5"/>
                <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/>
              </svg>
              Settings
            </button>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-[#2d9e4f] rounded-full flex items-center justify-center text-white text-xs font-bold uppercase">
                {username?.[0] || 'I'}
              </div>
              <div>
                <span className="text-gray-300 text-sm truncate max-w-[100px] block">{username.split('@')[0]}</span>
                {role && <span className="text-gray-600 text-[10px] capitalize">{role}</span>}
              </div>
            </div>
            <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-gray-500 hover:text-white transition text-xs" title="Sign out">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M10 8H2M6 5l-3 3 3 3M7 2h5a1 1 0 011 1v10a1 1 0 01-1 1H7"/>
              </svg>
            </button>
          </div>
        </div>

      </aside>
    </>
  );
}
