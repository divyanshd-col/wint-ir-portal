'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import useSWR from 'swr';
import type { IQSScoreEntry, ParamScore } from '@/lib/quality';
import { DEFAULT_FILTERS, LogFilters, AgentStat, SummaryMetrics, WeeklyParamRow, QualityTab } from './types';
import { buildParams } from './helpers';

interface QualityContextType {
  // Navigation / Role
  tab: QualityTab;
  switchTab: (t: QualityTab) => void;
  userRole?: string;
  userEmail?: string;
  selfAgentName?: string;
  setSelfAgentName: React.Dispatch<React.SetStateAction<string | undefined>>;

  // Data Loading
  entries: IQSScoreEntry[];
  setEntries: React.Dispatch<React.SetStateAction<IQSScoreEntry[]>>;
  agentStats: AgentStat[];
  setAgentStats: React.Dispatch<React.SetStateAction<AgentStat[]>>;
  paramFails: Record<string, number>;
  setParamFails: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  weeklyParamData: WeeklyParamRow[];
  setWeeklyParamData: React.Dispatch<React.SetStateAction<WeeklyParamRow[]>>;
  availableAgents: string[];
  setAvailableAgents: React.Dispatch<React.SetStateAction<string[]>>;
  availableDispositions: string[];
  setAvailableDispositions: React.Dispatch<React.SetStateAction<string[]>>;
  availableSubDispositions: string[];
  setAvailableSubDispositions: React.Dispatch<React.SetStateAction<string[]>>;
  totalStored: number;
  setTotalStored: React.Dispatch<React.SetStateAction<number>>;
  summary: SummaryMetrics | null;
  setSummary: React.Dispatch<React.SetStateAction<SummaryMetrics | null>>;
  logsLoaded: boolean;
  setLogsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  logsLoading: boolean;
  setLogsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  logsError: string | null;
  setLogsError: React.Dispatch<React.SetStateAction<string | null>>;

  // Filters (Score Log)
  pendingFilters: LogFilters;
  setPendingFilters: React.Dispatch<React.SetStateAction<LogFilters>>;
  appliedFilters: LogFilters;
  setAppliedFilters: React.Dispatch<React.SetStateAction<LogFilters>>;
  logPage: number;
  setLogPage: React.Dispatch<React.SetStateAction<number>>;
  hasMore: boolean;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  totalFiltered: number;
  setTotalFiltered: React.Dispatch<React.SetStateAction<number>>;

  // Reports
  reportFilters: LogFilters;
  setReportFilters: React.Dispatch<React.SetStateAction<LogFilters>>;
  reportTotalFiltered: number | null;
  setReportTotalFiltered: React.Dispatch<React.SetStateAction<number | null>>;
  reportCountLoading: boolean;
  setReportCountLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // Performance Tab Range
  perfPeriod: 'today' | 'yesterday' | '1w' | 'custom';
  setPerfPeriod: React.Dispatch<React.SetStateAction<'today' | 'yesterday' | '1w' | 'custom'>>;
  perfDateFrom: string;
  setPerfDateFrom: React.Dispatch<React.SetStateAction<string>>;
  perfDateTo: string;
  setPerfDateTo: React.Dispatch<React.SetStateAction<string>>;
  showPerfPicker: boolean;
  setShowPerfPicker: React.Dispatch<React.SetStateAction<boolean>>;
  perfTotal: number;
  setPerfTotal: React.Dispatch<React.SetStateAction<number>>;

  // Sorting
  sortAgentCol: string;
  setSortAgentCol: React.Dispatch<React.SetStateAction<string>>;
  sortAgentDir: 'asc' | 'desc';
  setSortAgentDir: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;
  sortCol: 'iqs' | 'fails' | 'date' | 'csat' | 'frt' | null;
  setSortCol: React.Dispatch<React.SetStateAction<'iqs' | 'fails' | 'date' | 'csat' | 'frt' | null>>;
  sortDir: 'asc' | 'desc';
  setSortDir: React.Dispatch<React.SetStateAction<'asc' | 'desc'>>;

  // UI state
  showFilterPanel: boolean;
  setShowFilterPanel: React.Dispatch<React.SetStateAction<boolean>>;
  showOnlyNeedsReview: boolean;
  setShowOnlyNeedsReview: React.Dispatch<React.SetStateAction<boolean>>;
  sidebarExpanded: boolean;
  setSidebarExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  showReportPicker: boolean;
  setShowReportPicker: React.Dispatch<React.SetStateAction<boolean>>;
  agentPage: number;
  setAgentPage: React.Dispatch<React.SetStateAction<number>>;
  showAllAgents: boolean;
  setShowAllAgents: React.Dispatch<React.SetStateAction<boolean>>;
  showAllWeeks: boolean;
  setShowAllWeeks: React.Dispatch<React.SetStateAction<boolean>>;

  // Badge count
  challengeCount: number;

  // Selected item modal / edit override modal
  detailEntry: IQSScoreEntry | null;
  setDetailEntry: React.Dispatch<React.SetStateAction<IQSScoreEntry | null>>;
  editEntry: IQSScoreEntry | null;
  setEditEntry: React.Dispatch<React.SetStateAction<IQSScoreEntry | null>>;
  editForm: {
    agentName: string;
    csat: string;
    disposition: string;
    subDisposition: string;
    summary: string;
    scores: Record<string, string>;
    reasoning: Record<string, string>;
    note: string;
  } | null;
  setEditForm: React.Dispatch<React.SetStateAction<{
    agentName: string;
    csat: string;
    disposition: string;
    subDisposition: string;
    summary: string;
    scores: Record<string, string>;
    reasoning: Record<string, string>;
    note: string;
  } | null>>;
  savingEdit: boolean;
  setSavingEdit: React.Dispatch<React.SetStateAction<boolean>>;
  agentReportStat: AgentStat | null;
  setAgentReportStat: React.Dispatch<React.SetStateAction<AgentStat | null>>;

  // Toast
  toast: string | null;
  setToast: React.Dispatch<React.SetStateAction<string | null>>;

  // Batch actions
  batchRunning: boolean;
  setBatchRunning: React.Dispatch<React.SetStateAction<boolean>>;
  batchProgress: { scored: number; errors: number; remaining: number } | null;
  setBatchProgress: React.Dispatch<React.SetStateAction<{ scored: number; errors: number; remaining: number } | null>>;
  sheetBackfilling: boolean;
  setSheetBackfilling: React.Dispatch<React.SetStateAction<boolean>>;
  sheetBackfillResult: { sent: number; total: number } | null;
  setSheetBackfillResult: React.Dispatch<React.SetStateAction<{ sent: number; total: number } | null>>;
  exporting: boolean;
  setExporting: React.Dispatch<React.SetStateAction<boolean>>;

  // Async Methods
  loadPerfData: (period: 'today' | 'yesterday' | '1w' | 'custom', customFrom?: string, customTo?: string) => Promise<void>;
  loadScores: (page: number, filters: LogFilters, skipStats?: boolean) => Promise<void>;
  runPendingScores: () => Promise<void>;
  backfillSheet: () => Promise<void>;
  openEditModal: (entry: IQSScoreEntry) => void;
  saveEdit: () => Promise<void>;
}

const QualityContext = createContext<QualityContextType | undefined>(undefined);

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function QualityProvider({
  children,
  userRole,
  userEmail,
  selfAgentName: initialSelfAgentName,
  initialTab,
  initialAgent,
}: {
  children: React.ReactNode;
  userRole?: string;
  userEmail?: string;
  selfAgentName?: string;
  initialTab?: QualityTab;
  initialAgent?: string;
}) {
  const [tab, setTab] = useState<QualityTab>(initialTab || 'performance');
  const [selfAgentName, setSelfAgentName] = useState(initialSelfAgentName);

  // SWR for user config data fetching
  const { data: meData } = useSWR('/api/users/me', fetcher, { revalidateOnFocus: false });

  useEffect(() => {
    if (meData?.agentName !== undefined && meData?.role === 'agent') {
      setSelfAgentName(meData.agentName || undefined);
    }
  }, [meData]);

  // SWR for flag counts & pending review counts (used for badge count)
  const { data: flagData, mutate: mutateFlags } = useSWR('/api/quality/flag', fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });
  const { data: pendingData, mutate: mutatePending } = useSWR('/api/quality/pending-review', fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
  });

  const challengeCount = useMemo(() => {
    const challenged = flagData && Array.isArray(flagData.flags)
      ? flagData.flags.filter((f: any) => f.status === 'pending').length
      : 0;
    const uncertain = pendingData?.uncertainCount ?? 0;
    return challenged + uncertain;
  }, [flagData, pendingData]);

  // Data states
  const [entries, setEntries] = useState<IQSScoreEntry[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStat[]>([]);
  const [paramFails, setParamFails] = useState<Record<string, number>>({});
  const [weeklyParamData, setWeeklyParamData] = useState<WeeklyParamRow[]>([]);
  const [availableAgents, setAvailableAgents] = useState<string[]>([]);
  const [availableDispositions, setAvailableDispositions] = useState<string[]>([]);
  const [availableSubDispositions, setAvailableSubDispositions] = useState<string[]>([]);
  const [totalStored, setTotalStored] = useState(0);
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  // Filter state
  const [pendingFilters, setPendingFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [logPage, setLogPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [totalFiltered, setTotalFiltered] = useState(0);

  // Reports
  const [reportFilters, setReportFilters] = useState<LogFilters>(DEFAULT_FILTERS);
  const [reportTotalFiltered, setReportTotalFiltered] = useState<number | null>(null);
  const [reportCountLoading, setReportCountLoading] = useState(false);

  // Performance Tab Range
  const [perfPeriod, setPerfPeriod] = useState<'today' | 'yesterday' | '1w' | 'custom'>('1w');
  const [perfDateFrom, setPerfDateFrom] = useState('');
  const [perfDateTo, setPerfDateTo] = useState('');
  const [showPerfPicker, setShowPerfPicker] = useState(false);
  const [perfTotal, setPerfTotal] = useState(0);

  // Sorting
  const [sortAgentCol, setSortAgentCol] = useState<string>('avgIqs');
  const [sortAgentDir, setSortAgentDir] = useState<'asc' | 'desc'>('desc');
  const [sortCol, setSortCol] = useState<'iqs' | 'fails' | 'date' | 'csat' | 'frt' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // UI state
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showOnlyNeedsReview, setShowOnlyNeedsReview] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [showReportPicker, setShowReportPicker] = useState(false);
  const [agentPage, setAgentPage] = useState(0);
  const [showAllAgents, setShowAllAgents] = useState(false);
  const [showAllWeeks, setShowAllWeeks] = useState(false);

  // Modals
  const [detailEntry, setDetailEntry] = useState<IQSScoreEntry | null>(null);
  const [editEntry, setEditEntry] = useState<IQSScoreEntry | null>(null);
  const [editForm, setEditForm] = useState<{
    agentName: string;
    csat: string;
    disposition: string;
    subDisposition: string;
    summary: string;
    scores: Record<string, string>;
    reasoning: Record<string, string>;
    note: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [agentReportStat, setAgentReportStat] = useState<AgentStat | null>(null);

  // Toast
  const [toast, setToast] = useState<string | null>(null);

  // Batch actions
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ scored: number; errors: number; remaining: number } | null>(null);
  const [sheetBackfilling, setSheetBackfilling] = useState(false);
  const [sheetBackfillResult, setSheetBackfillResult] = useState<{ sent: number; total: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  const perfAbortRef = useRef<AbortController | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Performance data — independent of Score Log filters ────────────────────
  const loadPerfData = useCallback(async (period: 'today' | 'yesterday' | '1w' | 'custom', customFrom = '', customTo = '') => {
    perfAbortRef.current?.abort();
    const controller = new AbortController();
    perfAbortRef.current = controller;

    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    let dateFrom = '', dateTo = '';
    if (period === 'today')     { dateFrom = today;      dateTo = today; }
    else if (period === 'yesterday') { dateFrom = yesterday;  dateTo = yesterday; }
    else if (period === '1w')   { dateFrom = new Date(Date.now() - 6*86400_000).toISOString().slice(0, 10); dateTo = today; }
    else if (period === 'custom') { dateFrom = customFrom; dateTo = customTo; }

    const params = new URLSearchParams({ page: '0' });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo', dateTo);

    try {
      const resp = await fetch(`/api/quality/scores?${params}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const data = await resp.json();
      if (controller.signal.aborted || !resp.ok) return;
      setAgentStats(data.agentStats || []);
      setParamFails(data.paramFails || {});
      setWeeklyParamData(data.weeklyParamData || []);
      if (data.summary) setSummary(data.summary);
      setPerfTotal(data.total ?? 0);
      setTotalStored(data.totalStored ?? 0);
      setAvailableAgents(data.availableAgents || []);
      setAvailableDispositions(data.availableDispositions || []);
      setAvailableSubDispositions(data.availableSubDispositions || []);
    } catch {}
  }, []);

  // ── Load scores (Score Log only — never updates Performance stats) ──────────
  const loadScores = useCallback(async (page: number, filters: LogFilters, skipStats = true) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLogsLoading(true);
    setLogsError(null);
    try {
      const params = buildParams(page, filters);
      if (skipStats) params.set('skipStats', '1');
      const resp = await fetch(`/api/quality/scores?${params}`, { signal: controller.signal });
      let data: any;
      try { data = await resp.json(); } catch {
        if (controller.signal.aborted) return;
        setLogsError(`Server error ${resp.status}: non-JSON response`);
        setLogsLoading(false);
        return;
      }
      if (controller.signal.aborted) return;
      if (!resp.ok) {
        setLogsError(`API error ${resp.status}: ${data?.error || data?.detail || resp.statusText}`);
        setLogsLoading(false);
        return;
      }
      setEntries(data.entries || []);
      if (data.summary) setSummary(data.summary);
      if (!skipStats) {
        setAgentStats(data.agentStats || []);
        setParamFails(data.paramFails || {});
        setWeeklyParamData(data.weeklyParamData || []);
      }
      setAvailableAgents(data.availableAgents || []);
      setAvailableDispositions(data.availableDispositions || []);
      setAvailableSubDispositions(data.availableSubDispositions || []);
      setTotalStored(data.totalStored ?? 0);
      setTotalFiltered(data.total ?? 0);
      setHasMore(data.hasMore ?? false);
      setLogsLoaded(true);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      setLogsError(`Failed to load: ${e?.message || String(e)}`);
    }
    setLogsLoading(false);
  }, []);

  const switchTab = (t: QualityTab) => {
    setTab(t);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', t);
      url.searchParams.delete('section');
      window.history.replaceState({}, '', url.toString());
    }
    if (t === 'log' && !logsLoaded) loadScores(0, appliedFilters);
  };

  const runPendingScores = async () => {
    setBatchRunning(true);
    setBatchProgress({ scored: 0, errors: 0, remaining: 0 });
    let scored = 0, errors = 0;
    try {
      while (true) {
        const res = await fetch('/api/admin/run-pending-scores', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { errors++; }
        else if (data.iqs != null) { scored++; }
        else if (data.error) { errors++; }
        setBatchProgress({ scored, errors, remaining: data.remaining ?? 0 });
        if (data.done || (!res.ok && data.remaining === 0)) break;
        await new Promise(r => setTimeout(r, 300));
      }
      setToast(`Scored ${scored} pending chats${errors > 0 ? ` · ${errors} errors` : ''}`);
      if (scored > 0) loadPerfData(perfPeriod, perfDateFrom, perfDateTo);
      mutatePending(); // Mutate badges SWR cache
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    } finally {
      setBatchRunning(false);
    }
  };

  const backfillSheet = async () => {
    setSheetBackfilling(true);
    setSheetBackfillResult(null);
    try {
      const res = await fetch('/api/admin/backfill-sheet', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fill sheet');
      setSheetBackfillResult({ sent: data.sent ?? 0, total: data.total ?? 0 });
      setToast(`Sheet filled: sent ${data.sent} of ${data.total} today's failures`);
    } catch (err: any) {
      setToast(`Sheet Backfill Error: ${err.message}`);
    } finally {
      setSheetBackfilling(false);
    }
  };

  const openEditModal = (entry: IQSScoreEntry) => {
    setEditEntry(entry);
    setEditForm({
      agentName: entry.agentName || '',
      csat: entry.csat || '',
      disposition: entry.disposition || '',
      subDisposition: entry.subDisposition || '',
      summary: entry.summary || '',
      scores: { ...entry.scores },
      reasoning: { ...entry.reasoning },
      note: '',
    });
  };

  const saveEdit = async () => {
    if (!editEntry || !editForm) return;
    setSavingEdit(true);
    try {
      const res = await fetch('/api/quality/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editEntry.id, chatId: editEntry.chatId,
          agentName: editForm.agentName, scores: editForm.scores,
          reasoning: editForm.reasoning, disposition: editForm.disposition,
          subDisposition: editForm.subDisposition, csat: editForm.csat,
          summary: editForm.summary, note: editForm.note,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server error ${res.status}`);
      }
      const data = await res.json();
      const updated: IQSScoreEntry = {
        ...editEntry,
        agentName:      editForm.agentName,
        csat:           editForm.csat,
        disposition:    editForm.disposition,
        subDisposition: editForm.subDisposition,
        scores:         editForm.scores as Record<string, ParamScore>,
        reasoning:      editForm.reasoning,
        iqs:            data.entry?.iqs ?? editEntry.iqs,
        updatedBy:      userEmail,
        updatedAt:      new Date().toISOString(),
        ...(editForm.note ? { reviewNote: editForm.note } : {}),
      };
      setEntries(prev => prev.map(e => e.id === editEntry.id ? updated : e));
      setDetailEntry(prev => prev?.id === editEntry.id ? updated : prev);

      setToast('Override saved successfully');
      setTimeout(() => setToast(null), 3000);
      setEditEntry(null); setEditForm(null);
    } catch (err: any) {
      setToast(err?.message || 'Failed to save override');
      setTimeout(() => setToast(null), 5000);
    }
    setSavingEdit(false);
  };

  useEffect(() => {
    loadPerfData('1w');
    const startFilters = initialAgent
      ? { ...DEFAULT_FILTERS, agent: initialAgent }
      : DEFAULT_FILTERS;
    if (initialAgent) setPendingFilters(startFilters);
    loadScores(0, startFilters);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setAgentPage(0); }, [agentStats]);

  const value = {
    tab,
    switchTab,
    userRole,
    userEmail,
    selfAgentName,
    setSelfAgentName,
    entries,
    setEntries,
    agentStats,
    setAgentStats,
    paramFails,
    setParamFails,
    weeklyParamData,
    setWeeklyParamData,
    availableAgents,
    setAvailableAgents,
    availableDispositions,
    setAvailableDispositions,
    availableSubDispositions,
    setAvailableSubDispositions,
    totalStored,
    setTotalStored,
    summary,
    setSummary,
    logsLoaded,
    setLogsLoaded,
    logsLoading,
    setLogsLoading,
    logsError,
    setLogsError,
    pendingFilters,
    setPendingFilters,
    appliedFilters,
    setAppliedFilters,
    logPage,
    setLogPage,
    hasMore,
    setHasMore,
    totalFiltered,
    setTotalFiltered,
    reportFilters,
    setReportFilters,
    reportTotalFiltered,
    setReportTotalFiltered,
    reportCountLoading,
    setReportCountLoading,
    perfPeriod,
    setPerfPeriod,
    perfDateFrom,
    setPerfDateFrom,
    perfDateTo,
    setPerfDateTo,
    showPerfPicker,
    setShowPerfPicker,
    perfTotal,
    setPerfTotal,
    sortAgentCol,
    setSortAgentCol,
    sortAgentDir,
    setSortAgentDir,
    sortCol,
    setSortCol,
    sortDir,
    setSortDir,
    showFilterPanel,
    setShowFilterPanel,
    showOnlyNeedsReview,
    setShowOnlyNeedsReview,
    sidebarExpanded,
    setSidebarExpanded,
    showReportPicker,
    setShowReportPicker,
    agentPage,
    setAgentPage,
    showAllAgents,
    setShowAllAgents,
    showAllWeeks,
    setShowAllWeeks,
    challengeCount,
    detailEntry,
    setDetailEntry,
    editEntry,
    setEditEntry,
    editForm,
    setEditForm,
    savingEdit,
    setSavingEdit,
    agentReportStat,
    setAgentReportStat,
    toast,
    setToast,
    batchRunning,
    setBatchRunning,
    batchProgress,
    setBatchProgress,
    sheetBackfilling,
    setSheetBackfilling,
    sheetBackfillResult,
    setSheetBackfillResult,
    exporting,
    setExporting,
    loadPerfData,
    loadScores,
    runPendingScores,
    backfillSheet,
    openEditModal,
    saveEdit,
  };

  return (
    <QualityContext.Provider value={value}>
      {children}
    </QualityContext.Provider>
  );
}

export function useQuality() {
  const context = useContext(QualityContext);
  if (context === undefined) {
    throw new Error('useQuality must be used within a QualityProvider');
  }
  return context;
}
