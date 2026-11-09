'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import UsersManager, { type User } from './settings/UsersManager';
import PcgUsersManager from './settings/PcgUsersManager';
import SecuritySection from './settings/SecuritySection';
import QualityThresholdsSection from './settings/QualityThresholdsSection';
import ScoringRubricSection from './settings/ScoringRubricSection';
import PromptEditor from './settings/PromptEditor';
import ChangeHistorySection from './settings/ChangeHistorySection';
import { DEFAULT_QUALITY_THRESHOLDS, type QualityThresholds } from '@/lib/quality-thresholds';
import type { EvaluationParameterConfig } from '@/lib/email/context-builder';

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
  knowledgeBaseDocNames?: Record<string, string>;
  systemPrompt?: string;
  iqsScoringPrompt?: string;
  defaultChatPrompt?: string;
  defaultIqsScoringPrompt?: string;
  conversationHistoryEnabled?: boolean;
  callAnalysisEnabled?: boolean;
  cxDashboardEnabled?: boolean;
  hasSlackToken?: boolean;
  qualityAlertSheetUrl?: string;
  hasPyannoteKey?: boolean;
  qualityThresholds?: QualityThresholds;
  emailParameters?: EvaluationParameterConfig[];
  /** Only the prompts for the workspace the admin is in: field name → saved text and built-in default. */
  prompts?: Record<string, { value: string; defaultValue: string }>;
}

interface SettingsClientProps {
  config: SafeConfig;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  hasPcgAccess?: boolean;
  platformDomain?: string;
  activeDomain?: 'cx' | 'pcg';
}

const ADMIN_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'kb', label: 'Knowledge Base' },
  { id: 'prompt', label: 'Prompts' },
  { id: 'thresholds', label: 'Quality Thresholds' },
  { id: 'rubric', label: 'Scoring Rubric' },
  { id: 'history', label: 'Change History' },
  { id: 'users', label: 'Users & Permissions' },
  { id: 'tokens', label: 'Token Usage' },
  { id: 'integrations', label: 'Integrations' },
];
const SECURITY_SECTION = { id: 'security', label: 'Security' };

// Outline icons for the settings nav, same stroke style as the main sidebar (sized to 16px by .quality-shell-sidebar-link svg).
const SECTION_ICON_PATHS: Record<string, React.ReactNode> = {
  general:      <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  kb:           <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  prompt:       <><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>,
  users:        <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
  'pcg-users':  <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9" /><path d="M16 3.1a4 4 0 0 1 0 7.8" /></>,
  tokens:       <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  integrations: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  thresholds:   <><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></>,
  rubric:       <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M9 14l2 2 4-4" /></>,
  history:      <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  security:     <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
};
const SectionIcon = ({ id }: { id: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {SECTION_ICON_PATHS[id]}
  </svg>
);

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
];

const KEEP_FORMAT = 'Keep the JSON output format described in the prompt: scoring fails if the reply cannot be read. If scoring starts failing after an edit, use Reset to default.';

// Call, email and PCG prompts. A tab only appears if the server sent its prompt, i.e. the admin manages that workspace.
const EXTRA_PROMPT_TABS: { id: string; label: string; title: string; description: string; note: string; fields: { field: string; label?: string }[] }[] = [
  {
    id: 'call_gates', label: 'Call: Compliance Gates', title: 'Call Compliance Gates',
    description: 'First pass when scoring a call: decides whether the call breaches a compliance gate (investment or tax advice, fabricated facts, identity verification).',
    note: KEEP_FORMAT, fields: [{ field: 'callGatesPrompt' }],
  },
  {
    id: 'call_iqs', label: 'Call: IQS Scoring', title: 'Call IQS Scoring',
    description: 'Second pass when scoring a call: scores it on the quality parameters and gives the reasoning shown to QA.',
    note: `${KEEP_FORMAT} The weights behind the final IQS are set in code, so percentages written in this text do not change the score arithmetic.`,
    fields: [{ field: 'callIqsPrompt' }],
  },
  {
    id: 'email_eval', label: 'Email: Evaluation', title: 'Email Evaluation',
    description: "What the AI evaluator is told when it scores an agent's email reply: its role and tasks, and the compliance rules.",
    note: 'The seven parameters are edited under Scoring Rubric. The email itself and the JSON output format are fixed in code, so an edit here cannot break scoring.',
    fields: [{ field: 'emailPromptIntro', label: 'Role and tasks' }, { field: 'emailPromptCompliance', label: 'Compliance rules' }],
  },
  {
    id: 'pcg_quality', label: 'PCG: Quality', title: 'PCG Call Quality',
    description: 'System prompt for scoring Private Client Group relationship-manager calls: the quality and compliance audit.',
    note: KEEP_FORMAT, fields: [{ field: 'pcgQualityPrompt' }],
  },
  {
    id: 'pcg_classification', label: 'PCG: Classification', title: 'PCG Call Classification',
    description: 'System prompt that classifies the purpose of a PCG call from its opening seconds (pitching, support, wrong number and so on).',
    note: KEEP_FORMAT, fields: [{ field: 'pcgClassificationPrompt' }],
  },
];

export default function SettingsClient({
  config,
  isAdmin = false,
  isSuperAdmin = false,
  hasPcgAccess = false,
  platformDomain = 'cx',
  activeDomain = 'cx',
}: SettingsClientProps) {
  const isPcgAdminOnly = isAdmin && platformDomain === 'pcg' && !isSuperAdmin;

  let SECTIONS: { id: string; label: string }[] = [];
  if (isPcgAdminOnly) {
    SECTIONS = [
      { id: 'pcg-users', label: 'Users & Permissions' },
      { id: 'prompt', label: 'Prompts' },
      { id: 'history', label: 'Change History' },
      SECURITY_SECTION,
    ];
  } else if (isSuperAdmin) {
    SECTIONS = [
      { id: 'general', label: 'General' },
      { id: 'kb', label: 'Knowledge Base' },
      { id: 'prompt', label: 'Prompts' },
      { id: 'thresholds', label: 'Quality Thresholds' },
      { id: 'rubric', label: 'Scoring Rubric' },
      { id: 'history', label: 'Change History' },
      { id: 'users', label: 'CX Users & Permissions' },
      { id: 'pcg-users', label: 'PCG Users & Permissions' },
      { id: 'tokens', label: 'Token Usage' },
      { id: 'integrations', label: 'Integrations' },
      SECURITY_SECTION,
    ];
  } else if (isAdmin) {
    SECTIONS = [...ADMIN_SECTIONS, SECURITY_SECTION];
  } else {
    SECTIONS = [SECURITY_SECTION];
  }

  // Workspaces stay separate: PCG settings never show in the CX workspace, and the CX-only Thresholds / Rubric never show in PCG.
  const inPcg = activeDomain === 'pcg';
  if (!isPcgAdminOnly) SECTIONS = SECTIONS.filter(sec => (inPcg ? !['thresholds', 'rubric'].includes(sec.id) : sec.id !== 'pcg-users'));

  const initialSection = isPcgAdminOnly
    ? 'pcg-users'
    : isSuperAdmin && activeDomain === 'pcg'
    ? 'pcg-users'
    : isAdmin
    ? 'general'
    : 'security';

  const [activeSection, setActiveSection] = useState(initialSection);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const s = p.get('section');
      if (s && SECTIONS.some((sec) => sec.id === s)) {
        setActiveSection(s);
      } else if (p.get('tab') === 'pcg' && hasPcgAccess && activeDomain === 'pcg') {
        setActiveSection('pcg-users');
      }
    }
  }, [hasPcgAccess, activeDomain]);

  // ── General state ──────────────────────────────────────────────────────────
  const [llmProvider, setLlmProvider] = useState<'gemini' | 'claude'>((config.llmProvider as any) || 'gemini');
  const [geminiModel, setGeminiModel] = useState(config.geminiModel || 'gemini-3.5-flash');
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
  const [callAnalysisEnabled, setCallAnalysisEnabled] = useState(!!config.callAnalysisEnabled);
  const [cxDashboardEnabled, setCxDashboardEnabled] = useState(!!config.cxDashboardEnabled);

  // ── KB state ───────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<string[]>(config.knowledgeBaseUrls || []);
  const [docNames, setDocNames] = useState<Record<string, string>>(config.knowledgeBaseDocNames || {});
  const [newUrl, setNewUrl] = useState('');
  const [newDocName, setNewDocName] = useState('');
  const [addingDoc, setAddingDoc] = useState(false);
  const [docError, setDocError] = useState('');
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingDocName, setEditingDocName] = useState('');
  const [refreshingKB, setRefreshingKB] = useState(false);
  const [kbRefreshed, setKbRefreshed] = useState(false);
  const [autoDocNames, setAutoDocNames] = useState<Record<string, string>>({});


  // ── Prompt state — initialised with override, falling back to default ─────
  const [systemPrompt, setSystemPrompt] = useState(config.systemPrompt || config.defaultChatPrompt || '');
  const [systemPromptIsCustom, setSystemPromptIsCustom] = useState(!!config.systemPrompt);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);

  const [iqsScoringPrompt, setIqsScoringPrompt] = useState(config.iqsScoringPrompt || config.defaultIqsScoringPrompt || '');
  const [iqsPromptIsCustom, setIqsPromptIsCustom] = useState(!!config.iqsScoringPrompt);
  const [savingIqsPrompt, setSavingIqsPrompt] = useState(false);
  const [iqsPromptSaved, setIqsPromptSaved] = useState(false);

  const [activePromptTab, setActivePromptTab] = useState(activeDomain === 'pcg' ? 'pcg_quality' : 'chat');
  const extraPromptTabs = EXTRA_PROMPT_TABS.filter(t => t.fields.every(f => config.prompts?.[f.field]));
  const promptTabs = [...(activeDomain === 'pcg' ? [] : PROMPT_TABS), ...extraPromptTabs];

  // ── Users state (Users / Teams / QA Dispositions UI lives in UsersManager) ──
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [agentAssignments, setAgentAssignments] = useState<Record<string, { tl_name: string | null; qa_name: string | null }>>({});

  // ── Integrations state ─────────────────────────────────────────────────────
  const [hasSlackToken, setHasSlackToken] = useState(!!config.hasSlackToken);
  const [slackToken, setSlackToken] = useState('');
  const [savingSlack, setSavingSlack] = useState(false);
  const [slackSaved, setSlackSaved] = useState(false);

  const [hasPyannoteKey, setHasPyannoteKey] = useState(!!config.hasPyannoteKey);
  const [pyannoteKey, setPyannoteKey] = useState('');
  const [savingPyannote, setSavingPyannote] = useState(false);
  const [pyannoteSaved, setPyannoteSaved] = useState(false);

  const [qualitySheetUrl, setQualitySheetUrl] = useState(config.qualityAlertSheetUrl || '');
  const [savingSheet, setSavingSheet] = useState(false);
  const [sheetSaved, setSheetSaved] = useState(false);

  // ── Password change state ──────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Load users ─────────────────────────────────────────────────────────────
  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const data = await fetch('/api/users?domain=cx').then(r => r.json());
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

  const loadDocNamesFromDrive = async () => {
    try {
      const res = await fetch('/api/files');
      if (res.ok) {
        const data = await res.json();
        const mapping: Record<string, string> = {};
        for (const file of data.files || []) {
          const driveId = extractDriveId(file.id);
          mapping[driveId] = file.name;
        }
        setAutoDocNames(mapping);
      }
    } catch (err) {
      console.error('[settings] Failed to load doc names from drive:', err);
    }
  };

  useEffect(() => { loadUsers(); }, []);
  useEffect(() => { if (activeSection === 'kb') loadDocNamesFromDrive(); }, [activeSection]);


  // ── API helpers ────────────────────────────────────────────────────────────
  const patchConfig = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // A refused save (for example when the change history could not be written) must not look like a success.
      const body = await res.json().catch(() => ({}));
      showToast(body.error || 'Could not save');
      throw new Error(body.error || 'Could not save');
    }
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

  const toggleCallAnalysis = async () => {
    const next = !callAnalysisEnabled;
    setCallAnalysisEnabled(next);
    await patchConfig({ callAnalysisEnabled: next });
  };

  const toggleCxDashboard = async () => {
    const next = !cxDashboardEnabled;
    setCxDashboardEnabled(next);
    await patchConfig({ cxDashboardEnabled: next });
  };

  const addDoc = async () => {
    if (!newUrl.trim()) return;
    setAddingDoc(true);
    setDocError('');
    try {
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), name: newDocName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setDocError(data.error || 'Failed to add'); return; }
      setDocs(data.knowledgeBaseUrls);
      setDocNames(data.knowledgeBaseDocNames || {});
      setNewUrl('');
      setNewDocName('');
      showToast('Document added');
      loadDocNamesFromDrive();
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
      if (res.ok) {
        setDocs(data.knowledgeBaseUrls);
        setDocNames(data.knowledgeBaseDocNames || {});
        showToast('Document removed');
        loadDocNamesFromDrive();
      }
    } catch {}
  };


  const saveDocName = async (url: string) => {
    try {
      const res = await fetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name: editingDocName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDocNames(data.knowledgeBaseDocNames || {});
        setEditingDocId(null);
        showToast('Document name saved');
      }
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
      loadDocNamesFromDrive();
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

  const savePyannoteKey = async () => {
    if (!pyannoteKey.trim()) return;
    setSavingPyannote(true);
    setPyannoteSaved(false);
    try {
      await patchConfig({ pyannoteApiKey: pyannoteKey.trim() });
      setHasPyannoteKey(true);
      setPyannoteKey('');
      setPyannoteSaved(true);
      showToast('Pyannote API key saved');
      setTimeout(() => setPyannoteSaved(false), 2000);
    } catch {
      showToast('Failed to save Pyannote key');
    } finally { setSavingPyannote(false); }
  };

  const changePassword = async () => {
    setPasswordMsg(null);
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ ok: false, text: 'New passwords do not match' });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg({ ok: true, text: 'Password updated successfully' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPasswordMsg({ ok: false, text: data.error || 'Failed to update password' });
      }
    } finally { setChangingPassword(false); }
  };

  function extractDriveId(url: string): string {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : url;
  }

  function docDisplayName(url: string): string {
    const driveId = extractDriveId(url);
    if (docNames[driveId]) return docNames[driveId];
    if (autoDocNames[driveId]) return autoDocNames[driveId];
    try {
      if (driveId !== url) return driveId.slice(0, 20) + '…';
      return url.slice(0, 40) + '…';
    } catch { return url; }
  }


  return (
    // Same shell classes as RoleShell, so the settings nav looks and behaves like the main sidebar.
    <div className="quality-shell-container font-sans antialiased">
     <div className="quality-shell-body">
      <aside className="quality-shell-sidebar">
        <div className="quality-shell-sidebar-head settings-nav-head">
          <h1>Settings</h1>
          {(activeDomain === 'pcg' || platformDomain === 'pcg') && (
            <Link href="/admin/pcg-calls" className="settings-nav-back" title="Back to PCG Calls">PCG Calls →</Link>
          )}
        </div>
        <nav aria-label="Settings sections">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              aria-current={activeSection === s.id ? 'page' : undefined}
              className={`quality-shell-sidebar-link quality-shell-sidebar-btn${activeSection === s.id ? ' active' : ''}`}
            >
              <span><SectionIcon id={s.id} /></span>
              <span className="quality-shell-sidebar-label">{s.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className={`flex-1 w-full mx-auto px-10 py-7 space-y-10 ${activeSection === 'users' || activeSection === 'pcg-users' ? 'max-w-6xl' : 'max-w-3xl'}`}>

        {/* ── GENERAL ── */}
        {activeSection === 'general' && (
          <div className="space-y-8">
            <h2 className="text-2xl font-semibold text-gray-900">General</h2>

            {/* LLM Provider */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <h3 className="text-sm font-bold text-gray-900">LLM Provider</h3>
              <div className="flex rounded-xl overflow-hidden border border-gray-200 w-fit">
                {(['gemini', 'claude'] as const).map(p => (
                  <button key={p} onClick={() => switchProvider(p)}
                    className={`px-6 py-2 text-sm font-semibold transition ${llmProvider === p ? 'bg-[#1f7a4d] text-white' : 'bg-white text-gray-500 hover:text-gray-800'}`}>
                    {p === 'gemini' ? 'Gemini' : 'Claude'}
                  </button>
                ))}
              </div>

              {llmProvider === 'gemini' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Routing Model</label>
                    <select value={geminiModel} onChange={e => switchGeminiModel(e.target.value)}
                      className="border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30 min-w-[240px]">
                      <optgroup label="Gemini 3">
                        <option value="gemini-3-flash-preview">3 Flash (default)</option>
                      </optgroup>
                      <optgroup label="Gemini 3.5">
                        <option value="gemini-3.5-pro">2.5 Pro</option>
                        <option value="gemini-3.5-flash">2.5 Flash</option>
                        <option value="gemini-3.5-flash-lite">2.5 Flash Lite</option>
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
                          className={`w-10 py-2 text-sm font-semibold transition ${activeGeminiKey === k ? 'bg-[#1f7a4d] text-white' : geminiKeysSet[k] ? 'bg-white text-gray-700 hover:bg-gray-50' : 'bg-white text-gray-300 hover:bg-gray-50'}`}
                          title={geminiKeysSet[k] ? `Key ${k} (set)` : `Key ${k} (not set)`}>
                          {k}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{geminiKeysSet[activeGeminiKey] ? `✓ Key ${activeGeminiKey} configured` : `Key ${activeGeminiKey} not set`}</p>
                    {editingKeySlot !== activeGeminiKey ? (
                      <button onClick={() => setEditingKeySlot(activeGeminiKey)}
                        className="mt-2 text-xs text-[#1f7a4d] font-semibold hover:underline">
                        {geminiKeysSet[activeGeminiKey] ? `Replace Key ${activeGeminiKey}` : `+ Set Key ${activeGeminiKey}`}
                      </button>
                    ) : (
                      <div className="mt-2 flex gap-2 max-w-sm">
                        <input type="password" value={newKeyInput} onChange={e => setNewKeyInput(e.target.value)} placeholder="AIza..."
                          className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                        <button onClick={() => saveNewKey(activeGeminiKey)} disabled={savingNewKey || !newKeyInput.trim()}
                          className="px-4 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
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
                        className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                      <button onClick={saveAnthropicKey} disabled={savingAnthropicKey || !anthropicKey.trim()}
                        className="px-4 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
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
                <p className="text-xs text-gray-400 mt-0.5">Dedicated keys for IQS scoring. Keeps spend separate from chat usage</p>
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
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
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
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                  )}
                </div>
              </div>
              {(iqsGeminiKey.trim() || iqsAnthropicKey.trim()) && (
                <button onClick={saveIqsKeys} disabled={savingIqsKeys}
                  className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
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
                  className={`relative w-12 h-6 rounded-full transition-colors ${historyEnabled ? 'bg-[#1f7a4d]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${historyEnabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            {/* Call Analysis (feature flag) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Call Analysis</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Show the Call Analysis page &amp; nav link</p>
                </div>
                <button
                  onClick={toggleCallAnalysis}
                  className={`relative w-12 h-6 rounded-full transition-colors ${callAnalysisEnabled ? 'bg-[#1f7a4d]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${callAnalysisEnabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>

            {/* CX Dashboard (feature flag) */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">CX Dashboard</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Show the CX Dashboard page &amp; nav link</p>
                </div>
                <button
                  onClick={toggleCxDashboard}
                  className={`relative w-12 h-6 rounded-full transition-colors ${cxDashboardEnabled ? 'bg-[#1f7a4d]' : 'bg-gray-200'}`}
                >
                  <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${cxDashboardEnabled ? 'left-7' : 'left-1'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── KNOWLEDGE BASE ── */}
        {activeSection === 'kb' && (
          <div className="space-y-8">
            <h2 className="text-2xl font-semibold text-gray-900">Knowledge Base</h2>

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
                {docs.map(url => {
                  const driveId = extractDriveId(url);
                  const isEditing = editingDocId === driveId;
                  return (
                    <div key={url} className="flex items-start gap-3 px-4 py-3 bg-gray-50 rounded-xl group">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400 shrink-0 mt-0.5">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editingDocName}
                              onChange={e => setEditingDocName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveDocName(url); if (e.key === 'Escape') setEditingDocId(null); }}
                              placeholder="Document name…"
                              autoFocus
                              className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30"
                            />
                            <button onClick={() => saveDocName(url)} className="text-xs px-2 py-1 bg-[#1f7a4d] text-white rounded-lg font-semibold hover:bg-[#1a6a42] transition">Save</button>
                            <button onClick={() => setEditingDocId(null)} className="text-xs px-2 py-1 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-100 transition">Cancel</button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800 truncate" title={url}>{docDisplayName(url)}</span>
                            <button
                              onClick={() => { setEditingDocId(driveId); setEditingDocName(docNames[driveId] || ''); }}
                              className="text-[10px] text-gray-400 hover:text-[#1f7a4d] opacity-0 group-hover:opacity-100 transition shrink-0"
                              title="Rename"
                            >
                              Rename
                            </button>
                          </div>
                        )}
                        {!isEditing && (
                          <p className="text-[11px] text-gray-400 truncate mt-0.5" title={url}>{url.slice(0, 55)}{url.length > 55 ? '…' : ''}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition">
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#1f7a4d] hover:underline">Open</a>
                        <button onClick={() => removeDoc(url)} className="text-gray-400 hover:text-red-500 transition" title="Remove">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 4h12M5 4V2h6v2M6 7v6M10 7v6M3 4l1 10h8l1-10" /></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-gray-100 pt-4 space-y-3">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">Add Google Doc</label>
                <div className="flex gap-2">
                  <input type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)}
                    placeholder="https://docs.google.com/document/d/..."
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                </div>
                <div className="flex gap-2">
                  <input type="text" value={newDocName} onChange={e => setNewDocName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDoc()}
                    placeholder="Display name (e.g. KYC Process Guide)"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                  <button onClick={addDoc} disabled={addingDoc || !newUrl.trim()}
                    className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
                    {addingDoc ? 'Adding…' : '+ Add'}
                  </button>
                </div>
                {docError && <p className="text-xs text-red-500 mt-1.5">{docError}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ── PROMPTS ── */}
        {isAdmin && (
          <div className={activeSection === 'prompt' ? 'space-y-6' : 'hidden'}>
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Prompts</h2>
              <p className="text-sm text-gray-500 mt-1">Customize any prompt used in the system. Leave blank to use the built-in default.</p>
            </div>

            {/* Tab bar */}
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
              {promptTabs.map(tab => (
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
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30 resize-y font-mono leading-relaxed"
                />
                <div className="flex items-center gap-3">
                  <button onClick={saveSystemPrompt} disabled={savingPrompt}
                    className="px-6 py-2.5 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
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
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30 resize-y font-mono leading-relaxed"
                />
                <div className="flex items-center gap-3">
                  <button onClick={saveIqsScoringPrompt} disabled={savingIqsPrompt}
                    className="px-6 py-2.5 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
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

            {/* Call / email / PCG prompts: always mounted, shown when their tab is active, so unsaved and saved edits are kept */}
            {extraPromptTabs.map(t => (
              <div key={t.id} className={activePromptTab === t.id ? '' : 'hidden'}>
                <PromptEditor
                  title={t.title} description={t.description} note={t.note} onSaved={showToast}
                  fields={t.fields.map(f => ({ field: f.field, label: f.label, value: config.prompts![f.field].value, defaultValue: config.prompts![f.field].defaultValue }))}
                />
              </div>
            ))}

          </div>
        )}

        {/* ── QUALITY THRESHOLDS ── */}
        {isAdmin && !inPcg && (
          <div className={activeSection === 'thresholds' ? '' : 'hidden'}>
            <QualityThresholdsSection initial={config.qualityThresholds ?? DEFAULT_QUALITY_THRESHOLDS} onSaved={showToast} />
          </div>
        )}

        {/* ── SCORING RUBRIC ── */}
        {isAdmin && !inPcg && config.emailParameters && (
          <div className={activeSection === 'rubric' ? '' : 'hidden'}>
            <ScoringRubricSection initial={config.emailParameters} onSaved={showToast} />
          </div>
        )}

        {/* ── CHANGE HISTORY (per workspace; the API enforces the same rule) ── */}
        {isAdmin && (
          <div className={activeSection === 'history' ? '' : 'hidden'}>
            <ChangeHistorySection workspace={inPcg ? 'pcg' : 'cx'} active={activeSection === 'history'} />
          </div>
        )}

        {/* ── USERS (CX) ── */}
        {activeSection === 'users' && (
          <UsersManager
            users={users}
            setUsers={setUsers}
            agentAssignments={agentAssignments}
            setAgentAssignments={setAgentAssignments}
            loadingUsers={loadingUsers}
            reloadUsers={loadUsers}
            showToast={showToast}
          />
        )}

        {/* ── PCG USERS & PERMISSIONS ── */}
        {activeSection === 'pcg-users' && hasPcgAccess && (
          <PcgUsersManager
            showToast={showToast}
            isSuperAdmin={isSuperAdmin}
          />
        )}

        {/* ── TOKEN USAGE ── */}
        {activeSection === 'tokens' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900">Token Usage &amp; Cost Intelligence</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Track input/output tokens, identify top-consuming models, and monitor LLM expenses.
                </p>
              </div>
              <a
                href="/tokens"
                className="px-4 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] transition inline-flex items-center gap-2 shadow-xs"
              >
                <span>Open Full Dashboard</span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h3 className="text-sm font-bold text-gray-900">Dedicated Admin Token Dashboard</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                The Token Usage tab tracks exact input and output token consumption for each model across all Wint IR Portal systems (Quality Scoring, Knowledge Chat, Call Quality Diarization, and Analytics).
              </p>
              <div className="pt-2">
                <a
                  href="/tokens"
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f7a4d] hover:underline"
                >
                  View Model Breakdown, Cost Calculations &amp; Charts →
                </a>
              </div>
            </div>
          </div>
        )}

        {/* ── INTEGRATIONS ── */}
        {activeSection === 'integrations' && (
          <div className="space-y-8">
            <h2 className="text-2xl font-semibold text-gray-900">Integrations</h2>

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
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                  <button onClick={saveSlackToken} disabled={savingSlack || !slackToken.trim()}
                    className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
                    {savingSlack ? 'Saving…' : slackSaved ? '✓' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {/* ── Pyannote Diarization ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Pyannote Diarization</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Used for high-precision speaker diarization (Phase 1) in call transcript analysis.
                </p>
              </div>
              {hasPyannoteKey ? (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-emerald-600 font-semibold">✓ Pyannote API key configured</span>
                  <button onClick={() => setHasPyannoteKey(false)} className="text-xs text-gray-400 hover:text-gray-600 underline">Replace</button>
                </div>
              ) : (
                <div className="flex gap-2 max-w-sm">
                  <input type="password" value={pyannoteKey} onChange={e => setPyannoteKey(e.target.value)} placeholder="API key"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30" />
                  <button onClick={savePyannoteKey} disabled={savingPyannote || !pyannoteKey.trim()}
                    className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition">
                    {savingPyannote ? 'Saving…' : pyannoteSaved ? '✓' : 'Save'}
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
                  Uses a Google Apps Script web app. No service account needed.
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
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1f7a4d]/30 font-mono"
                  />
                </div>
                <button
                  onClick={saveQualitySheet}
                  disabled={savingSheet || !qualitySheetUrl.trim()}
                  className="px-5 py-2 bg-[#1f7a4d] text-white rounded-xl text-sm font-semibold hover:bg-[#1a6a42] disabled:opacity-50 transition"
                >
                  {savingSheet ? 'Saving…' : sheetSaved ? '✓ Saved' : 'Save'}
                </button>
                {qualitySheetUrl && !sheetSaved && (
                  <p className="text-xs text-emerald-600 font-medium">
                    ✓ Active. Rows will be appended on every parameter failure alert.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SECURITY ── */}
        {activeSection === 'security' && (
          <SecuritySection onSuccess={() => showToast('Password updated successfully')} />
        )}

      </main>
     </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
