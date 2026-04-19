export interface AnalyticsFilters {
  dateFrom: string;
  dateTo: string;
  dispositions: string[];
  subDispositions: string[];
  teams: number[];
  csatLabels: string[];
  conversationTypes: string[];
  agentIds: number[];
}

export type InsightBlock =
  | { type: 'filter_header'; summary: string }
  | { type: 'stat_row'; stats: { label: string; value: string; sub?: string; color?: 'green' | 'red' | 'orange' }[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number)[][] }
  | { type: 'bar_chart'; title: string; data: { name: string; value: number; sub?: string }[]; unit?: string }
  | { type: 'line_chart'; title: string; data: { date: string; value: number }[]; unit?: string }
  | { type: 'insight'; text: string; severity?: 'info' | 'warning' | 'danger' }
  | { type: 'theme_card'; name: string; description: string; count: number; pct: number; topParams: string[]; examplesAvailable: boolean }
  | { type: 'analysis_card'; finding: string; evidence: string[]; coverage?: string; caveats?: string };

export type QueryShape =
  | 'aggregate'
  | 'breakdown'
  | 'trend'
  | 'comparison'
  | 'distribution'
  | 'ranked_list'
  | 'type2_insight';

export interface ClassifierEntities {
  dateFrom?: string | null;
  dateTo?: string | null;
  dispositions?: string[] | null;
  subDispositions?: string[] | null;
  teams?: number[] | null;
  csatLabels?: string[] | null;
  conversationTypes?: string[] | null;
  agentIds?: number[] | null;
  agentNames?: string[] | null;
  topN?: number | null;
  metricName?: string | null;
  windowA?: { dateFrom: string; dateTo: string } | null;
  windowB?: { dateFrom: string; dateTo: string } | null;
  bucket?: 'day' | 'week' | null;
}

export interface ClassifierResult {
  type: 1 | 2;
  shape: QueryShape;
  templateId: string | null;
  entities: ClassifierEntities;
}

export interface HistoryEntry {
  id: string;
  message: string;
  response: string;
  blocks: InsightBlock[];
  type: 1 | 2;
  filters: AnalyticsFilters;
  timestamp: string;
}

export type StreamChunk =
  | { event: 'text'; delta: string }
  | { event: 'blocks'; blocks: InsightBlock[] }
  | { event: 'error'; message: string }
  | { event: 'done' };

export interface TemplateExtras {
  metricName?: string;
  topN?: number;
  teamId?: number;
  windowA?: { dateFrom: string; dateTo: string };
  windowB?: { dateFrom: string; dateTo: string };
  bucket?: 'day' | 'week';
}
