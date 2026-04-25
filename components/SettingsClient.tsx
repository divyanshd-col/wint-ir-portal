'use client';

import { useState, useEffect, useRef } from 'react';

interface SafeConfig {
  llmProvider?: string;
  geminiModel?: string;
  hasGeminiKey?: boolean;
  hasGeminiKey2?: boolean;
  hasGeminiKey3?: boolean;
  hasGeminiKey4?: boolean;
  hasGeminiKey5?: boolean;
  activeGeminiKey?: number;
  hasAnthropicKey?: boolean;
  hasIqsGeminiKey?: boolean;
  hasIqsAnthropicKey?: boolean;
  knowledgeBaseUrls?: string[];
  systemPrompt?: string;
  iqsScoringPrompt?: string;
  analyticsPlannerPrompt?: string;
  analyticsSynthesizerPrompt?: string;
  defaultChatPrompt?: string;
  defaultIqsScoringPrompt?: string;
  defaultAnalyticsPlannerPrompt?: string;
  defaultAnalyticsSynthesizerPrompt?: string;
  conversationHistoryEnabled?: boolean;
  hasSlackToken?: boolean;
  qualityAlertSheetUrl?: string;
}

interface User {
  email: string;
  username?: string;
  agentName?: string;
  role: string;
  isAdmin?: boolean;
}

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'kb', label: 'Knowledge Base' },
  { id: 'prompt', label: 'Prompts' },
  { id: 'users', label: 'Users' },
  { id: 'tl', label: 'Team Leads' },
  { id: 'integrations', label: 'Integrations' },
];

const PROMPT_TABS = [
  {
    id: 'chat',
    label: 'Chat Assistant',
    description: 'Shapes how the AI responds to customer queries in the chat interface. Injected at the start of every conversation.',
  },
  {
    id: 'iqs',
    label: 'IQS Scoring',
    description: 'System prompt used when scoring agent conversations. Defines the scoring rubric, parameters, and output format.',
  },
  {
    id: 'planner',
    label: 'Analytics Planner',
    description: 'First-pass prompt for the analytics agent. Converts natural-language questions into SQL query plans.',
  },
  {
    id: 'synthesizer',
    label: 'Analytics Synthesizer',
    description: 'Second-pass prompt for the analytics agent. Turns SQL results into analytical narratives and charts.',
  },
];

export default function SettingsClient({ config }: { config: SafeConfig }) {
  const [activeSection, setActiveSection] = useState('general');

  // ── General state ──────────────────────────────────────────────────────────
  const [llmProvider, setLlmProvider] = useState<'gemini' | 'claude'>((config.llmProvider as any) || 'gemini');
  const [geminiModel, setGeminiModel] = useState(config.geminiModel || 'gemini-2.5-flash');
  const [activeGeminiKey, setActiveGeminiKey] = useState<1 | 2 | 3 | 4 | 5>((config.activeGeminiKey as any) || 1);
  const [geminiKeysSet, setGeminiKeysSet] = useState<Record<number, boolean>>({
    1: !!config.hasGeminiKey,
    2: !!config.hasGeminiKey2,
    3: !!config.hasGeminiKey3,
    4: !!config.hasGeminiKey4,
    5: !!config.hasGeminiKey5,
  });
  const [editingKeySlot, setEditingKeySlot] = useState<number | null>(null);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [savingNewKey, setSavingNewKey] = useState(false);

  const [hasAnthropicKey, setHasAnthropicKey] = useState(!!config.hasAnthropicKey);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false);

  const [hasIqsGeminiKey, setHasIqsGeminiKey] = useState(!!config.hasIqsGeminiKey);
  const [hasIqsAnthropicKey, setHasIqsAnthropicKey] = useState(!!config.hasIqsAnthropicKey);
  const [iqsGeminiKey, setIqsGeminiKey] = useState('');
  const [iqsAnthropicKey, setIqsAnthropicKey] = useState('');
  const [savingIqsKeys, setSavingIqsKeys] = useState(false);

  const [historyEnabled, setHistoryEnabled] = useState(!!config.conversationHistoryEnabled);

  // ── KB state ───────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<string[]>(config.knowledgeBaseUrls || []);
  const [newUrl, setNewUrl] = useState('');
  const [addingDoc, setAddingDoc] = useState(false);
  const [docError, setDocError] = useState('');
  const [refreshingKB, setRefreshingKB] = useState(false);
  const [kbRefreshed, setKbRefreshed] = useState(false);

  // ── Prompt state — initialised with override, falling back to default ─────
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt || config.defaultChatPrompt || '');
  const [systemPromptIsCustom, setSystemPromptIsCustom] = useState(!!config.systemPrompt);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  const [iqsScoringPrompt, setIqsScoringPrompt] = useState(config.iqsScoringPrompt || config.defaultIqsScoringPrompt || '');
  const [iqsPromptIsCustom, setIqsPromptIsCustom] = useState(!!config.iqsScoringPrompt);
  const [savingIqsPrompt, setSavingIqsPrompt] = useState(false);
  const [iqsPromptSaved, setIqsPromptSaved] = useState(false);

  const [analyticsPlannerPrompt, setAnalyticsPlannerPrompt] = useState(config.analyticsPlannerPrompt || config.defaultAnalyticsPlannerPrompt || '');
  const [plannerPromptIsCustom, setPlannerPromptIsCustom] = useState(!!config.analyticsPlannerPrompt);
  const [savingPlannerPrompt, setSavingPlannerPrompt] = useState(false);
  const [plannerPromptSaved, setPlannerPromptSaved] = useState(false);

  const [analyticsSynthesizerPrompt, setAnalyticsSynthesizerPrompt] = useState(config.analyticsSynthesizerPrompt || config.defaultAnalyticsSynthesizerPrompt || '');
  const [synthesizerPromptIsCustom, setSynthesizerPromptIsCustom] = useState(!!config.analyticsSynthesizerPrompt);
  const [savingSynthesizerPrompt, setSavingSynthesizerPrompt] = useState(false);
  const [synthesizerPromptSaved, setSynthesizerPromptSaved] = useState(false);

  const [activePromptTab, setActivePromptTab] = useState('chat');

  // ── Users state ────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'agent' | 'tl' | 'quality' | 'admin'>('agent');
  const [newAgentName, setNewAgentName] = useState('');
  const [addingUser, setAddingUser] = useState(false);
  const [userError, setUserError] = useState('');
  const [editingAgentName, setEditingAgentName] = useState<Record<string, string>>({});
  const [userPage, setUserPage] = useState(0);
  const [userSearch, setUserSearch] = useState('');
  const [agentAssignments, setAgentAssignments] = useState<Record<string, { tl_name: string | null; qa_name: string | null }>>({});
  const [pendingAssignments, setPendingAssignments] = useState<Record<string, { tl_name?: string | null; qa_name?: string | null }>>({});
  const [savingAssignments, setSavingAssignments] = useState(false);
  // Password reset
  const [resetEmail, setResetEmail]       = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting]         = useState(false);
  const [resetMsg, setResetMsg]           = useState<{ ok: boolean; text: string } | null>(null);

  // ── Integrations state ─────────────────────────────────────────────────────
  const [hasSlackToken, setHasSlackToken] = useState(!!config.hasSlackToken);
  const [slackToken, setSlackToken] = useState('');
  const [savingSlack, setSavingSlack] = useState(false);
  const [slackSaved, setSlackSaved] = useState(false);

  const [qualitySheetUrl, setQualitySheetUrl] = useState(config.qualityAlertSheetUrl || '');
  const [savingSheet, setSavingSheet] = useState(false);
  const [sheetSaved, setSheetSaved] = useState(false);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Load users ─────────────────────────────────────────────────────────────
  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const data = await fetch('/api/users').then(r => r.json());
      setUsers(Array.isArray(data) ? data : []);
      const agentData = await fetch('/api/cx/admin/agents').then(r => r.ok ? r.json() : []).catch(() => []);
      const assignMap: Record<string, { tl_name: string | null; qa_name: string | null }> = {};
      for (const a of (agentData as { name: string; tl_name: string | null; qa_name: string | null }[])) {
        // Key by lowercase so lookups by portal agentName (which may differ in case) still work
        assignMap[a.name.toLowerCase()] = { tl_name: a.tl_name, qa_name: a.qa_name };
      }
      setAgentAssignments(assignMap);
    } catch {} finally { setLoadingUsers(false); }
  };

  useEffect(() => { loadUsers(); }, []);

  // ── API helpers ────────────────────────────────────────────────────────────
  const patchConfig = async (payload: Record<string, unknown>) => {
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  };

  const switchProvider = async (provider: 'gemini' | 'claude') => {
    setLlmProvider(provider);
    await patchConfig({ llmProvider: provider });
  };

  const switchGeminiModel = async (model: string) => {
    setGeminiModel(model);
    await patchConfig({ geminiModel: model });
  };

  const switchGeminiKey = async (key: 1 | 2 | 3 | 4 | 5) => {
    setActiveGeminiKey(key);
    await patchConfig({ activeGeminiKey: key });
  };

  const saveNewKey = async (slot: number) => {
    if (!newKeyInput.trim()) return;
    setSavingNewKey(true);
    try {
      await patchConfig({ [`geminiApiKey${slot > 1 ? slot : ''}`]: newKeyInput.trim() });
      setGeminiKeysSet(prev => ({ ...prev, [slot]: true }));
      setNewKeyInput('');
      setEditingKeySlot(null);
      showToast(`Key ${slot} saved`);
    } finally { setSavingNewKey(false); }
  };

  const saveAnthropicKey = async () => {
    if (!anthropicKey.trim()) return;
    setSavingAnthropicKey(true);
    try {
      await patchConfig({ anthropicApiKey: anthropicKey.trim() });
      setHasAnthropicKey(true);
      setAnthropicKey('');
      showToast('Anthropic key saved');
    } finally { setSavingAnthropicKey(false); }
  };

  const saveIqsKeys = async () => {
    if (!iqsGeminiKey.trim() && !iqsAnthropicKey.trim()) return;
    setSavingIqsKeys(true);
    try {
      const payload: Record<string, string> = {};
      if (iqsGeminiKey.trim()) payload.iqsGeminiApiKey = iqsGeminiKey.trim();
      if (iqsAnthropicKey.trim()) payload.iqsAnthropicApiKey = iqsAnthropicKey.trim();
      await patchConfig(payload);
      if (iqsGeminiKey.trim()) { setHasIqsGeminiKey(true); setIqsGeminiKey(''); }
      if (iqsAnthropicKey.trim()) { setHasIqsAnthropicKey(true); setIqsAnthropicKey(''); }
      showToast('IQS keys saved');
    } finally { setSavingIqsKeys(false); }
  };

  const toggleHistory = async () => {
    const next = !historyEnabled;
    setHistoryEnabled(next);
    await patchConfig({ conversationHistoryEnabled: next });
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
      showToast('Document added');
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
      if (res.ok) { setDocs(data.knowledgeBaseUrls); showToast('Document removed'); }
    } catch {}
  };

  const refreshKB = async () => {
    setRefreshingKB(true);
    setKbRefreshed(false);
    try {
      const res = await fetch('/api/kb-refresh', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(`Refresh failed: ${data.error || res.statusText}`);
        return;
      }
      setKbRefreshed(true);
      showToast('KB cache refreshed');
      setTimeout(() => setKbRefreshed(false), 3000);
    } finally { setRefreshingKB(false); }
  };

  const saveSystemPrompt = async () => {
    setSavingPrompt(true);
    setPromptSaved(false);
    try {
      await patchConfig({ systemPrompt });
      setSystemPromptIsCustom(true);
      setPromptSaved(true);
      showToast('Chat prompt saved');
      setTimeout(() => setPromptSaved(false), 2000);
    } finally { setSavingPrompt(false); }
  };

  const resetSystemPrompt = async () => {
    await patchConfig({ systemPrompt: '' });
    setSystemPrompt(config.defaultChatPrompt || '');
    setSystemPromptIsCustom(false);
    showToast('Chat prompt reset to default');
  };

  const saveIqsScoringPrompt = async () => {
    setSavingIqsPrompt(true);
    setIqsPromptSaved(false);
    try {
      await patchConfig({ iqsScoringPrompt });
      setIqsPromptIsCustom(true);
      setIqsPromptSaved(true);
      showToast('IQS scoring prompt saved');
      setTimeout(() => setIqsPromptSaved(false), 2000);
    } finally { setSavingIqsPrompt(false); }
  };

  const resetIqsScoringPrompt = async () => {
    await patchConfig({ iqsScoringPrompt: '' });
    setIqsScoringPrompt(config.defaultIqsScoringPrompt || '');
    setIqsPromptIsCustom(false);
    showToast('IQS prompt reset to default');
  };

  const saveAnalyticsPlannerPrompt = async () => {
    setSavingPlannerPrompt(true);
    setPlannerPromptSaved(false);
    try {
      await patchConfig({ analyticsPlannerPrompt });
      setPlannerPromptIsCustom(true);
      setPlannerPromptSaved(true);
      showToast('Analytics planner prompt saved');
      setTimeout(() => setPlannerPromptSaved(false), 2000);
    } finally { setSavingPlannerPrompt(false); }
  };

  const resetAnalyticsPlannerPrompt = async () => {
    await patchConfig({ analyticsPlannerPrompt: '' });
    setAnalyticsPlannerPrompt(config.defaultAnalyticsPlannerPrompt || '');
    setPlannerPromptIsCustom(false);
    showToast('Planner prompt reset to default');
  };

  const saveAnalyticsSynthesizerPrompt = async () => {
    setSavingSynthesizerPrompt(true);
    setSynthesizerPromptSaved(false);
    try {
      await patchConfig({ analyticsSynthesizerPrompt });
      setSynthesizerPromptIsCustom(true);
      setSynthesizerPromptSaved(true);
      showToast('Analytics synthesizer prompt saved');
      setTimeout(() => setSynthesizerPromptSaved(false), 2000);
    } finally { setSavingSynthesizerPrompt(false); }
  };

  const resetAnalyticsSynthesizerPrompt = async () => {
    await patchConfig({ analyticsSynthesizerPrompt: '' });
    setAnalyticsSynthesizerPrompt(config.defaultAnalyticsSynthesizerPrompt || '');
    setSynthesizerPromptIsCustom(false);
    showToast('Synthesizer prompt reset to default');
  };

  const addUser = async () => {
    if (!newEmail.trim()) return;
    setAddingUser(true);
    setUserError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole, agentName: newAgentName.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setUserError(data.error || 'Failed'); return; }
      await loadUsers();
      setNewEmail('');
      setNewAgentName('');
      setNewRole('agent');
      showToast('User added');
    } finally { setAddingUser(false); }
  };

  const updateUserRole = async (email: string, role: string) => {
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (res.ok) {
      setUsers(prev => prev.map(u =>
        u.email === email ? { ...u, role: role as any, isAdmin: role === 'admin' } : u
      ));
    }
  };

  const updateAgentName = async (email: string, agentName: string) => {
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, agentName }),
    });
    if (res.ok) {
      setUsers(prev => prev.map(u => u.email === email ? { ...u, agentName } : u));
      setEditingAgentName(prev => { const n = { ...prev }; delete n[email]; return n; });
      showToast('Agent name updated');
    }
  };

  const saveAssignments = async () => {
    const entries = Object.entries(pendingAssignments);
    if (!entries.length) return;
    setSavingAssignments(true);
    let failed = 0;
    await Promise.all(entries.map(async ([agentName, changes]) => {
      const res = await fetch('/api/cx/admin/agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agentName, ...changes }),
      });
      if (res.ok) {
        const key = agentName.toLowerCase();
        setAgentAssignments(prev => ({
          ...prev,
          [key]: { tl_name: changes.tl_name ?? prev[key]?.tl_name ?? null, qa_name: changes.qa_name ?? prev[key]?.qa_name ?? null },
        }));
      } else { failed++; }
    }));
    setPendingAssignments({});
    setSavingAssignments(false);
    showToast(failed ? `Saved with ${failed} error(s)` : 'Assignments saved');
  };

  const resetUserPassword = async () => {
    if (!resetEmail.trim() || !resetPassword.trim()) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail.trim(), newPassword: resetPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setResetMsg({ ok: true, text: 'Password updated successfully.' });
        setResetEmail(''); setResetPassword('');
      } else {
        setResetMsg({ ok: false, text: data.error || 'Failed to reset password.' });
      }
    } catch {
      setResetMsg({ ok: false, text: 'Network error.' });
    }
    setResetting(false);
  };

  const deleteUser = async (email: string) => {
    const res = await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (res.ok) { setUsers(prev => prev.filter(u => u.email !== email)); showToast('User removed'); }
  };

  const saveSlackToken = async () => {
    if (!slackToken.trim()) return;
    setSavingSlack(true);
    setSlackSaved(false);
    try {
      await patchConfig({ slackUserToken: slackToken.trim() });
      setHasSlackToken(true);
      setSlackToken('');
      setSlackSaved(true);
      showToast('Slack token saved');
      setTimeout(() => setSlackSaved(false), 2000);
    } finally { setSavingSlack(false); }
  };

  const saveQualitySheet = async () => {
    setSavingSheet(true);
    setSheetSaved(false);
    try {
      await patchConfig({ qualityAlertSheetUrl: qualitySheetUrl.trim() });
      setSheetSaved(true);
      showToast('Sheet webhook saved');
      setTimeout(() => setSheetSaved(false), 2000);
    } finally { setSavingSheet(false); }
  };

  function shortLabel(url: string): string {
    try {
      const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (match) return match[1].slice(0, 20) + '…';
      return url.slice(0, 40) + '…';
    } catch { return url; }
  }

  return (
    <div className="min-h-screen bg-[#f5f3ee] flex font-sans antialiased">
      {/* Left nav */}
      <aside className="w-56 shrink-0 bg-white border-r border-gray-100 flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-gray-100">
          <a href="/" className="flex items-center gap-2 text-gray-500 hover:text-gray-900 transition text-xs font-medium mb-4">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3L5 8l5 5" /></svg>
            Back to chat
          </a>
          <h1 className="text-base font-bold text-gray-900">Settings</h1>
          <p className="text-xs text-gray-400 mt-0.5">Admin only</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeSection === s.id
                  ? 'bg-[#2d9e4f] text-white'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto px-8 py-10 space-y-10">

        {/* ── GENERAL ── */}
        {activeSection === 'general' && (
          <div className="space-y-8">
            <h2 className="text-xl font-bold text-gray-900">General</h2>

            {/* LLM Provider */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <h3 className="text-sm font-bold text-gray-900">LLM Provider</h3>
              <div className="flex rounded-xl overflow-hidden border border-gray-200 w-fit">
                {(['gemini', 'claude'] as const).map(p => (
                  <button key={p} onClick={() => switchProvider(p)}
                    className={`px-6 py-2 text-sm font-semibold transition ${llmProvider === p ? 'bg-[#2d9e4f] text-white' : 'bg-white text-gray-500 hover:text-gray-800'}`}>
                    {p === 'gemini' ? 'Gemini' : 'Claude'}
                  </button>
                ))}
              </div>

              {llmProvider === 'gemini' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Routing Model</label>
                    <select value={geminiModel} onChange={e => switchGeminiModel(e.target.value)}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 min-w-[240px]">
                      <optgroup label="Gemini 3">
                        <option value="gemini-3-flash-preview">3 Flash (default)</option>
                      </optgroup>
                      <optgroup label="Gemini 2.5">
                        <option value="gemini-2.5-pro">2.5 Pro</option>
                        <option value="gemini-2.5-flash">2.5 Flash</option>
                        <option value="gemini-2.5-flash-lite">2.5 Flash Lite</option>
                      </optgroup>
                      <optgroup label="Gemini 2.0">
                        <option value="gemini-2.0-flash">2.0 Flash</option>
                        <option value="gemini-2.0-flash-lite">2.0 Flash Lite</option>
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">API Key Slot</label>
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 w-fit">
                      {([1, 2, 3, 4, 5] as const).map(k => (
                        <button key={k} onClick={() => switchGeminiKey(k)}
                          className={`w-10 py-2 text-sm font-semibold transition ${activeGeminiKey === k ? 'bg-[#2d9e4f] text-white' : geminiKeysSet[k] ? 'bg-white text-gray-700 hover:bg-gray-50' : 'bg-white text-gray-300 hover:bg-gray-50'}`}
                          title={geminiKeysSet[k] ? `Key ${k} (set)` : `Key ${k} (not set)`}>
                          {k}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{geminiKeysSet[activeGeminiKey] ? `✓ Key ${activeGeminiKey} configured` : `Key ${activeGeminiKey} not set`}</p>
                    {editingKeySlot !== activeGeminiKey ? (
                      <button onClick={() => setEditingKeySlot(activeGeminiKey)}
                        className="mt-2 text-xs text-[#2d9e4f] font-semibold hover:underline">
                        {geminiKeysSet[activeGeminiKey] ? `Replace Key ${activeGeminiKey}` : `+ Set Key ${activeGeminiKey}`}
                      </button>
                    ) : (
                      <div className="mt-2 flex gap-2 max-w-sm">
                        <input type="password" value={newKeyInput} onChange={e => setNewKeyInput(e.target.value)} placeholder="AIza..."
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                        <button onClick={() => saveNewKey(activeGeminiKey)} disabled={savingNewKey || !newKeyInput.trim()}
                          className="px-4 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                          {savingNewKey ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditingKeySlot(null); setNewKeyInput(''); }}
                          className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition">
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {llmProvider === 'claude' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Anthropic API Key</label>
                  {hasAnthropicKey ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-emerald-600 font-semibold">✓ Key configured</span>
                      <button onClick={() => setHasAnthropicKey(false)} className="text-xs text-gray-400 hover:text-gray-600 underline">Replace</button>
                    </div>
                  ) : (
                    <div className="flex gap-2 max-w-sm">
                      <input type="password" value={anthropicKey} onChange={e => setAnthropicKey(e.target.value)} placeholder="sk-ant-..."
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                      <button onClick={saveAnthropicKey} disabled={savingAnthropicKey || !anthropicKey.trim()}
                        className="px-4 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                        {savingAnthropicKey ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* IQS Keys */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Quality Scoring Keys</h3>
                <p className="text-xs text-gray-400 mt-0.5">Dedicated keys for IQS scoring — keeps spend separate from chat usage</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Gemini Key</label>
                  {hasIqsGeminiKey ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-emerald-600 font-semibold">✓ Set</span>
                      <button onClick={() => setHasIqsGeminiKey(false)} className="text-xs text-gray-400 hover:text-gray-600 underline">Replace</button>
                    </div>
                  ) : (
                    <input type="password" value={iqsGeminiKey} onChange={e => setIqsGeminiKey(e.target.value)} placeholder="AIza..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">IQS Anthropic Key</label>
                  {hasIqsAnthropicKey ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-emerald-600 font-semibold">✓ Set</span>
                      <button onClick={() => setHasIqsAnthropicKey(false)} className="text-xs text-gray-400 hover:text-gray-600 underline">Replace</button>
                    </div>
                  ) : (
                    <input type="password" value={iqsAnthropicKey} onChange={e => setIqsAnthropicKey(e.target.value)} placeholder="sk-ant-..."
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                  )}
                </div>
              </div>
              {(iqsGeminiKey.trim() || iqsAnthropicKey.trim()) && (
                <button onClick={saveIqsKeys} disabled={savingIqsKeys}
                  className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                  {savingIqsKeys ? 'Saving…' : 'Save IQS Keys'}
                </button>
              )}
            </div>

            {/* Conversation History */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Conversation History</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Save last 5 conversations per user</p>
                </div>
                <button
                  onClick={toggleHistory}
                  className={`relative w-12 h-6 rounded-full transition-colors ${historyEnabled ? 'bg-[#2d9e4f]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${historyEnabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── KNOWLEDGE BASE ── */}
        {activeSection === 'kb' && (
          <div className="space-y-8">
            <h2 className="text-xl font-bold text-gray-900">Knowledge Base</h2>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">Documents ({docs.length})</h3>
                <button onClick={refreshKB} disabled={refreshingKB}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-xl text-xs font-semibold hover:border-gray-400 disabled:opacity-50 transition">
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className={refreshingKB ? 'animate-spin' : ''}>
                    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.8 0 3.4.87 4.4 2.2M14 2v3h-3"/>
                  </svg>
                  {refreshingKB ? 'Refreshing…' : kbRefreshed ? '✓ Refreshed' : 'Refresh KB Cache'}
                </button>
              </div>

              {docs.length === 0 && (
                <p className="text-sm text-gray-400">No documents added yet. Add a Google Doc URL below.</p>
              )}

              <div className="space-y-2">
                {docs.map(url => (
                  <div key={url} className="flex items-center gap-3 px-4 py-3 bg-gray-50 rounded-xl group">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400 shrink-0">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="text-sm text-gray-700 flex-1 truncate" title={url}>{shortLabel(url)}</span>
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#2d9e4f] hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition">Open</a>
                    <button onClick={() => removeDoc(url)} className="text-gray-400 hover:text-red-500 transition shrink-0 opacity-0 group-hover:opacity-100" title="Remove">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 4h12M5 4V2h6v2M6 7v6M10 7v6M3 4l1 10h8l1-10" /></svg>
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Add Google Doc URL</label>
                <div className="flex gap-2">
                  <input type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDoc()}
                    placeholder="https://docs.google.com/document/d/..."
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                  <button onClick={addDoc} disabled={addingDoc || !newUrl.trim()}
                    className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {addingDoc ? 'Adding…' : '+ Add'}
                  </button>
                </div>
                {docError && <p className="text-xs text-red-500 mt-1.5">{docError}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ── PROMPTS ── */}
        {activeSection === 'prompt' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Prompts</h2>
              <p className="text-sm text-gray-500 mt-1">Customize any prompt used in the system. Leave blank to use the built-in default.</p>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              {PROMPT_TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActivePromptTab(tab.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activePromptTab === tab.id
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Chat Assistant */}
            {activePromptTab === 'chat' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Chat Assistant</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{PROMPT_TABS[0].description}</p>
                  </div>
                  {systemPromptIsCustom
                    ? <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Custom</span>
                    : <span className="shrink-0 text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">Default</span>}
                </div>
                <textarea
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                  rows={22}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 resize-y font-mono leading-relaxed"
                />
                <div className="flex items-center gap-3">
                  <button onClick={saveSystemPrompt} disabled={savingPrompt}
                    className="px-6 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {savingPrompt ? 'Saving…' : promptSaved ? '✓ Saved' : 'Save Changes'}
                  </button>
                  {systemPromptIsCustom && (
                    <button onClick={resetSystemPrompt} className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* IQS Scoring */}
            {activePromptTab === 'iqs' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">IQS Scoring</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{PROMPT_TABS[1].description}</p>
                  </div>
                  {iqsPromptIsCustom
                    ? <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Custom</span>
                    : <span className="shrink-0 text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">Default</span>}
                </div>
                <textarea
                  value={iqsScoringPrompt}
                  onChange={e => setIqsScoringPrompt(e.target.value)}
                  rows={22}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 resize-y font-mono leading-relaxed"
                />
                <div className="flex items-center gap-3">
                  <button onClick={saveIqsScoringPrompt} disabled={savingIqsPrompt}
                    className="px-6 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {savingIqsPrompt ? 'Saving…' : iqsPromptSaved ? '✓ Saved' : 'Save Changes'}
                  </button>
                  {iqsPromptIsCustom && (
                    <button onClick={resetIqsScoringPrompt} className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Analytics Planner */}
            {activePromptTab === 'planner' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Analytics Planner</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{PROMPT_TABS[2].description}</p>
                  </div>
                  {plannerPromptIsCustom
                    ? <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Custom</span>
                    : <span className="shrink-0 text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">Default</span>}
                </div>
                <textarea
                  value={analyticsPlannerPrompt}
                  onChange={e => setAnalyticsPlannerPrompt(e.target.value)}
                  rows={22}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 resize-y font-mono leading-relaxed"
                />
                <div className="flex items-center gap-3">
                  <button onClick={saveAnalyticsPlannerPrompt} disabled={savingPlannerPrompt}
                    className="px-6 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {savingPlannerPrompt ? 'Saving…' : plannerPromptSaved ? '✓ Saved' : 'Save Changes'}
                  </button>
                  {plannerPromptIsCustom && (
                    <button onClick={resetAnalyticsPlannerPrompt} className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Analytics Synthesizer */}
            {activePromptTab === 'synthesizer' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">Analytics Synthesizer</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{PROMPT_TABS[3].description}</p>
                  </div>
                  {synthesizerPromptIsCustom
                    ? <span className="shrink-0 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">Custom</span>
                    : <span className="shrink-0 text-xs font-semibold text-gray-400 bg-gray-50 border border-gray-200 px-2 py-1 rounded-lg">Default</span>}
                </div>
                <textarea
                  value={analyticsSynthesizerPrompt}
                  onChange={e => setAnalyticsSynthesizerPrompt(e.target.value)}
                  rows={22}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 resize-y font-mono leading-relaxed"
                />
                <div className="flex items-center gap-3">
                  <button onClick={saveAnalyticsSynthesizerPrompt} disabled={savingSynthesizerPrompt}
                    className="px-6 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {savingSynthesizerPrompt ? 'Saving…' : synthesizerPromptSaved ? '✓ Saved' : 'Save Changes'}
                  </button>
                  {synthesizerPromptIsCustom && (
                    <button onClick={resetAnalyticsSynthesizerPrompt} className="text-xs text-gray-400 hover:text-gray-600 underline transition">
                      Reset to default
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── USERS ── */}
        {activeSection === 'users' && (() => {
          const PAGE = 5;
          const filteredUsers = users.filter(u =>
            !userSearch ||
            u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
            (u.agentName || '').toLowerCase().includes(userSearch.toLowerCase())
          );
          const pagedUsers = filteredUsers.slice(userPage * PAGE, (userPage + 1) * PAGE);
          const totalPages = Math.ceil(filteredUsers.length / PAGE);
          return (
          <div className="space-y-8">
            <h2 className="text-xl font-bold text-gray-900">Users</h2>

            {/* Search */}
            <input
              type="text"
              placeholder="Search users..."
              value={userSearch}
              onChange={e => { setUserSearch(e.target.value); setUserPage(0); }}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30"
            />

            {/* User table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Agent Name</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">TL</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">QA</th>
                    <th className="px-4 py-3 w-12" />
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map(u => (
                    <tr key={u.email} className="border-b border-gray-50 hover:bg-gray-50/40 transition">
                      <td className="px-5 py-3 text-gray-700 text-sm truncate max-w-[220px]">{u.email}</td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={editingAgentName[u.email] ?? (u.agentName || '')}
                          onChange={e => setEditingAgentName(prev => ({ ...prev, [u.email]: e.target.value }))}
                          onBlur={e => {
                            const val = e.target.value;
                            if (val !== (u.agentName || '')) updateAgentName(u.email, val);
                          }}
                          placeholder="Agent name…"
                          className="border border-gray-200 rounded-lg px-2.5 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 w-32"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={u.role}
                          onChange={e => updateUserRole(u.email, e.target.value)}
                          className="border border-gray-200 rounded-lg px-2.5 py-1 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30"
                        >
                          <option value="agent">Agent</option>
                          <option value="tl">TL</option>
                          <option value="quality">Quality</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const key = (u.agentName || '').toLowerCase();
                          const saved = agentAssignments[key]?.tl_name || '';
                          const pending = pendingAssignments[u.agentName || ''];
                          const val = pending?.tl_name !== undefined ? (pending.tl_name || '') : saved;
                          const isDirty = pending?.tl_name !== undefined && (pending.tl_name || '') !== saved;
                          return (
                            <select
                              value={val}
                              onChange={e => {
                                if (!u.agentName) { showToast('Set an Agent Name first'); return; }
                                setPendingAssignments(prev => ({
                                  ...prev,
                                  [u.agentName!]: { ...prev[u.agentName!], tl_name: e.target.value || null },
                                }));
                              }}
                              className={`border rounded-lg px-2.5 py-1 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 w-32 ${isDirty ? 'border-amber-400' : 'border-gray-200'}`}
                            >
                              <option value="">—</option>
                              {users.filter(uu => uu.role === 'tl').map(uu => (
                                <option key={uu.email} value={uu.agentName || ''}>{uu.agentName || uu.email}</option>
                              ))}
                            </select>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const key = (u.agentName || '').toLowerCase();
                          const saved = agentAssignments[key]?.qa_name || '';
                          const pending = pendingAssignments[u.agentName || ''];
                          const val = pending?.qa_name !== undefined ? (pending.qa_name || '') : saved;
                          const isDirty = pending?.qa_name !== undefined && (pending.qa_name || '') !== saved;
                          return (
                            <select
                              value={val}
                              onChange={e => {
                                if (!u.agentName) { showToast('Set an Agent Name first'); return; }
                                setPendingAssignments(prev => ({
                                  ...prev,
                                  [u.agentName!]: { ...prev[u.agentName!], qa_name: e.target.value || null },
                                }));
                              }}
                              className={`border rounded-lg px-2.5 py-1 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 w-32 ${isDirty ? 'border-amber-400' : 'border-gray-200'}`}
                            >
                              <option value="">—</option>
                              {users.filter(uu => uu.role === 'quality').map(uu => (
                                <option key={uu.email} value={uu.agentName || ''}>{uu.agentName || uu.email}</option>
                              ))}
                            </select>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => deleteUser(u.email)} className="text-gray-300 hover:text-red-500 transition" title="Remove user">
                          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M2 4h12M5 4V2h6v2M6 7v6M10 7v6M3 4l1 10h8l1-10" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && !loadingUsers && (
                <p className="text-sm text-gray-400 text-center py-8">No users found</p>
              )}
            </div>

            {/* Save assignments bar */}
            {Object.keys(pendingAssignments).length > 0 && (
              <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
                <p className="text-sm text-amber-700 font-medium">
                  {Object.keys(pendingAssignments).length} unsaved assignment change{Object.keys(pendingAssignments).length !== 1 ? 's' : ''}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPendingAssignments({})}
                    className="text-xs text-amber-600 hover:underline font-medium">
                    Discard
                  </button>
                  <button onClick={saveAssignments} disabled={savingAssignments}
                    className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {savingAssignments ? 'Saving…' : 'Save Assignments'}
                  </button>
                </div>
              </div>
            )}

            {/* Pagination */}
            {filteredUsers.length > PAGE && (
              <div className="flex items-center justify-between text-sm text-gray-500">
                <span>Page {userPage + 1} of {totalPages}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUserPage(p => Math.max(0, p - 1))}
                    disabled={userPage === 0}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setUserPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={userPage >= totalPages - 1}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Add user */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h3 className="text-sm font-bold text-gray-900">Add / Update User</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="name@wintwealth.com"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Role</label>
                  <select value={newRole} onChange={e => setNewRole(e.target.value as any)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30">
                    <option value="agent">Agent</option>
                    <option value="tl">TL</option>
                    <option value="quality">Quality</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Agent Name (optional)</label>
                <input type="text" value={newAgentName} onChange={e => setNewAgentName(e.target.value)} placeholder="Display name for quality reports…"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
              </div>
              {userError && <p className="text-xs text-red-500">{userError}</p>}
              <div className="flex items-center gap-3">
                <button onClick={addUser} disabled={addingUser || !newEmail.trim()}
                  className="px-6 py-2.5 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                  {addingUser ? 'Adding…' : '+ Add / Update User'}
                </button>
                <span className="text-xs text-gray-400">After adding, use "Reset Password" below to set their initial password.</span>
              </div>
            </div>
          </div>

          );
        })()}

        {/* Reset Password — admin only */}
        {activeSection === 'users' && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Reset User Password</h3>
              <p className="text-xs text-gray-500 mt-0.5">Set or reset the password for any portal user.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">User Email</label>
                <input type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                  placeholder="name@wintwealth.com"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">New Password</label>
                <input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)}
                  placeholder="Min. 6 characters"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
              </div>
            </div>
            {resetMsg && (
              <p className={`text-xs font-medium ${resetMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{resetMsg.text}</p>
            )}
            <button onClick={resetUserPassword} disabled={resetting || !resetEmail.trim() || !resetPassword.trim()}
              className="px-6 py-2.5 bg-gray-800 text-white rounded-xl text-sm font-semibold hover:bg-gray-700 disabled:opacity-50 transition">
              {resetting ? 'Saving…' : 'Set Password'}
            </button>
          </div>
        )}

        {/* ── TEAM LEADS ── */}
        {activeSection === 'tl' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Team Leads</h2>
                <p className="text-sm text-gray-500 mt-1">Users with the TL role and their agent assignments</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left px-5 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Agent Name</th>
                    <th className="text-left px-4 py-3 text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Agents Managed</th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => u.role === 'tl').map(u => {
                    const count = Object.values(agentAssignments).filter(a => a.tl_name === u.agentName).length;
                    return (
                      <tr key={u.email} className="border-b border-gray-50 hover:bg-gray-50/40 transition">
                        <td className="px-5 py-3 text-gray-700">{u.email}</td>
                        <td className="px-4 py-3 text-gray-600">{u.agentName || <span className="text-gray-400 italic">No agent name set</span>}</td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-gray-700">{count}</span>
                          <span className="text-gray-400 text-xs ml-1">agent{count !== 1 ? 's' : ''}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {users.filter(u => u.role === 'tl').length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">No Team Leads yet. Add a user with role &quot;TL&quot; in the Users section.</p>
              )}
            </div>
            <p className="text-xs text-gray-400">To add a new Team Lead, go to the Users section and set their role to &quot;TL&quot;. Then assign agents to them using the TL column in the users table.</p>
          </div>
        )}

        {/* ── INTEGRATIONS ── */}
        {activeSection === 'integrations' && (
          <div className="space-y-8">
            <h2 className="text-xl font-bold text-gray-900">Integrations</h2>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Slack Fallback</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  When configured, Slack is searched when the knowledge base has no match.
                </p>
              </div>
              {hasSlackToken ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-emerald-600 font-semibold">✓ Slack token configured</span>
                  <button onClick={() => setHasSlackToken(false)} className="text-xs text-gray-400 hover:text-gray-600 underline">Replace</button>
                </div>
              ) : (
                <div className="flex gap-2 max-w-sm">
                  <input type="password" value={slackToken} onChange={e => setSlackToken(e.target.value)} placeholder="xoxp-... user token"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30" />
                  <button onClick={saveSlackToken} disabled={savingSlack || !slackToken.trim()}
                    className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition">
                    {savingSlack ? 'Saving…' : slackSaved ? '✓' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Quality Alert Sheet ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Quality Alert Sheet</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  When a chat fails a critical quality parameter, a row is appended to a Google Sheet alongside the Slack alert.
                  Uses a Google Apps Script web app — no service account needed.
                </p>
              </div>
              <div className="bg-stone-50 rounded-xl p-3 text-xs text-stone-600 space-y-1 max-w-lg">
                <p className="font-semibold text-stone-700">Setup (one-time):</p>
                <ol className="list-decimal list-inside space-y-0.5 text-stone-500">
                  <li>Open your Google Sheet → <strong>Extensions → Apps Script</strong></li>
                  <li>Paste the Apps Script from the docs and save</li>
                  <li>Click <strong>Deploy → New deployment → Web app</strong></li>
                  <li>Set <em>Execute as</em>: Me · <em>Who has access</em>: Anyone</li>
                  <li>Copy the deployment URL and paste it below</li>
                </ol>
              </div>
              <div className="space-y-3 max-w-lg">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Apps Script deployment URL</label>
                  <input
                    type="url"
                    value={qualitySheetUrl}
                    onChange={e => setQualitySheetUrl(e.target.value)}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2d9e4f]/30 font-mono"
                  />
                </div>
                <button
                  onClick={saveQualitySheet}
                  disabled={savingSheet || !qualitySheetUrl.trim()}
                  className="px-5 py-2 bg-[#2d9e4f] text-white rounded-xl text-sm font-semibold hover:bg-[#25883f] disabled:opacity-50 transition"
                >
                  {savingSheet ? 'Saving…' : sheetSaved ? '✓ Saved' : 'Save'}
                </button>
                {qualitySheetUrl && !sheetSaved && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✓ Active — rows will be appended on every parameter failure alert.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
