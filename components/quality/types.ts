import type { IQSScoreEntry, ParamScore } from '@/lib/quality';

export type QualityTab = 'performance' | 'log' | 'upload' | 'reports' | 'pending' | 'calls' | 'call-test' | 'unified' | 'call-queue';

export interface LogFilters {
  agent: string;
  minScore: number;
  maxScore: number;
  disposition: string;
  subDisposition: string;
  csat: string;
  type: string;
  dateRange: 'today' | 'yesterday' | '1w' | 'custom';
  dateFrom: string;
  dateTo: string;
  chatId: string;
}

export const DEFAULT_FILTERS: LogFilters = {
  agent: '', minScore: 0, maxScore: 100,
  disposition: '', subDisposition: '', csat: '', type: '',
  dateRange: '1w', dateFrom: '', dateTo: '',
  chatId: '',
};

export interface WeeklyParamRow {
  key: string;
  label: string;
  total: number;
  params: Record<string, number>;
}

export interface AgentStat {
  agent: string;
  chats: number;
  avgIqs: number;
  minIqs: number;
  maxIqs: number;
  high: number;
  atRisk: number;
  avgFrt?: number | null;
  avgResolution?: number | null;
  avgClosure?: number | null;
  avgBotToTeam?: number | null;
  csatPct?: number | null;
  csatGood?: number;
  csatCbb?: number;
  csatBad?: number;
}

export interface QualityClientProps {
  userRole?: string;
  userEmail?: string;
  selfAgentName?: string;
  initialAgent?: string;
  initialTab?: QualityTab;
  initialSection?: 'pending' | 'reviewed';
  initialChatId?: string;
}

export interface ParsedRow {
  chatId: string;
  agent: string;
  date: string;
  csat: string;
  transcript: string;
  tags?: string;
  contactPhone?: string;
}

export interface MetaRow {
  agent?: string;
  tags?: string;
  csat?: string;
  date?: string;
}

export type MetaMap = Record<string, MetaRow>;

export interface SummaryMetrics {
  totalConvos: number;
  botConvos: number;
  agentConvos: number;
  overallCsat: number | null;
  botCsat: number | null;
  agentCsat: number | null;
  good: number;
  cbbBad: number;
  cbbBadPct: number;
  avgFrt: number | null;
  avgBotToTeam: number | null;
  slaPercent: number | null;
  slaThresholdSecs: number;
  avgResolution: number | null;
  avgClosure: number | null;
  avgIqs: number | null;
  iqsSampleSize: number;
  samplingPct: number;
}

export interface IQSFlagData {
  id: string;
  scoreId: string;
  chatId: string;
  agentName: string;
  agentEmail: string;
  agentNote: string;
  challengedParams?: { param: string; note: string }[];
  flaggedAt: string;
  status: 'pending' | 'reviewed';
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export interface IQSFlagComment {
  id: string;
  flagId: string;
  authorEmail: string;
  authorName: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface PendingReviewItem {
  chatId: string;
  agentName: string;
  iqs: number;
  scoredAt: string;
  date: string;
  disposition?: string;
  subDisposition?: string;
  flag?: IQSFlagData | null;
  qaStatus?: { reviewedBy: string; reviewedAt: string; reviewNote: string } | null;
  uncertainParameters?: Array<{ parameter: string; question: string }>;
  scores?: Record<string, string>;
  reasoning?: Record<string, string>;
}

export const PENDING_DEFAULT_FILTERS: LogFilters = {
  agent: '', minScore: 0, maxScore: 100,
  disposition: '', subDisposition: '', csat: '', type: '',
  dateRange: '1w', dateFrom: '', dateTo: '',
  chatId: '',
};

export interface CallQueueItem {
  callId: string;
  chatId: string | null;
  agentName: string;
  date: string;
  calledAt: string;
  durationSeconds: number | null;
  language: string;
  interruptionCount: number;
  deadAirCount: number;
  iqs: number | null;
  scores: Record<string, string>;
  reasoning: Record<string, string>;
  failedParams: string[];
  scoredAt: string;
  qaStatus: { reviewedBy: string; reviewedAt: string; reviewNote: string } | null;
}

export const CALL_QUEUE_PARAM_NAMES: Record<string, string> = {
  CallOpening: 'Call Opening', CallClosing: 'Call Closing',
  TechnicalLegal: 'Technical / Legal', AllQuestions: 'All Questions',
  Expectation: 'Expectation Setting', Process: 'Process',
  Grammar: 'Grammar', Fillers: 'Fillers / Clarity', EnergyTone: 'Energy & Tone',
  ActiveListening: 'Active Listening', Simplifying: 'Simplifying',
};
