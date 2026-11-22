export interface CanonicalPcgParamDef {
  id: string;
  panelKey: string;
  num: number;
  name: string;
  weight: number;
  group: 'Process Skills' | 'Communication Skills' | 'Customer Service Skills';
  aliases: string[];
}

export const PCG_CANONICAL_CALL_PARAMS: readonly CanonicalPcgParamDef[] = [
  {
    id: 'CallOpening',
    panelKey: 'CallOpening',
    num: 1,
    name: '1. Call Opening',
    weight: 5,
    group: 'Process Skills',
    aliases: ['CallOpening', 'call_opening', 'opening', 'P1'],
  },
  {
    id: 'CallClosing',
    panelKey: 'CallClosing',
    num: 2,
    name: '2. Call Closing',
    weight: 5,
    group: 'Process Skills',
    aliases: ['CallClosing', 'call_closing', 'closing', 'P2'],
  },
  {
    id: 'TechnicallyLegal',
    panelKey: 'TechnicalLegal',
    num: 3,
    name: '3. Technically / Legally Correct',
    weight: 15,
    group: 'Process Skills',
    aliases: ['TechnicallyLegal', 'TechnicalLegal', 'technically_legally_correct', 'Technical', 'P3'],
  },
  {
    id: 'AllQuestions',
    panelKey: 'AllQuestions',
    num: 4,
    name: '4. All Questions Addressed',
    weight: 10,
    group: 'Process Skills',
    aliases: ['AllQuestions', 'all_questions_addressed', 'questions', 'P4'],
  },
  {
    id: 'Expectation',
    panelKey: 'Expectation',
    num: 5,
    name: '5. Expectation Setting',
    weight: 10,
    group: 'Process Skills',
    aliases: ['Expectation', 'ExpectationSetting', 'expectation_setting', 'P5'],
  },
  {
    id: 'Process',
    panelKey: 'Process',
    num: 6,
    name: '6. Process / Pre-check',
    weight: 5,
    group: 'Process Skills',
    aliases: ['Process', 'process_precheck', 'PreCheck', 'P6'],
  },
  {
    id: 'VocabularyGrammar',
    panelKey: 'Grammar',
    num: 7,
    name: '7. Vocabulary / Sentence Structure / Grammar / Pronunciations',
    weight: 10,
    group: 'Communication Skills',
    aliases: ['VocabularyGrammar', 'Grammar', 'vocabulary_grammar', 'grammar_pronunciation', 'P7'],
  },
  {
    id: 'FillersDeadAir',
    panelKey: 'Fillers',
    num: 8,
    name: '8. Fillers, Fumbling & Stammering / Speech Clarity / Avoid Dead Air',
    weight: 10,
    group: 'Communication Skills',
    aliases: ['FillersDeadAir', 'Fillers', 'fillers_dead_air', 'DeadAir', 'P8'],
  },
  {
    id: 'EnergyTone',
    panelKey: 'EnergyTone',
    num: 9,
    name: '9. Warmth, Energy & Tone Modulation',
    weight: 10,
    group: 'Communication Skills',
    aliases: ['EnergyTone', 'energy_tone', 'WarmthEnergy', 'Energy', 'P9'],
  },
  {
    id: 'ActiveListening',
    panelKey: 'ActiveListening',
    num: 10,
    name: '10. Active Listening, Interruptions & Empathy',
    weight: 10,
    group: 'Customer Service Skills',
    aliases: ['ActiveListening', 'active_listening_empathy', 'ActiveListeningInterruptions', 'Empathy', 'P10'],
  },
  {
    id: 'Simplifying',
    panelKey: 'Simplifying',
    num: 11,
    name: '11. Simplifying Answers',
    weight: 10,
    group: 'Customer Service Skills',
    aliases: ['Simplifying', 'simplifying_answers', 'Jargon', 'P11'],
  },
];

export interface NormalizedPcgCallParameter {
  id: string;
  num: number;
  name: string;
  maxScore: number;
  earnedScore: number;
  status: 'Yes' | 'Half' | 'No' | 'NA';
  quote: string;
  explanation: string;
  reasoning: string;
}

export function normalizePcgParamStatus(rawStatus: any): 'Yes' | 'Half' | 'No' | 'NA' {
  if (rawStatus === true || rawStatus === 2 || rawStatus === '2') return 'Yes';
  if (rawStatus === false || rawStatus === 0 || rawStatus === '0') return 'No';
  if (rawStatus === 1 || rawStatus === '1' || rawStatus === 0.5 || rawStatus === '0.5') return 'Half';
  const s = String(rawStatus ?? '').trim().toLowerCase();
  if (s === 'yes' || s === 'pass') return 'Yes';
  if (s === 'half' || s === 'part' || s === 'partial') return 'Half';
  if (s === 'no' || s === 'fail') return 'No';
  return 'NA';
}

export function resolveCanonicalPcgParamDef(candidate: {
  key?: string;
  id?: string;
  num?: number;
  name?: string;
}): CanonicalPcgParamDef | undefined {
  const idLower = String(candidate.id || '').trim().toLowerCase();
  const keyStr = String(candidate.key || '').trim();
  const keyLower = keyStr.toLowerCase();
  const isNumericKey = /^\d+$/.test(keyStr);

  // 1. Exact match on inner id (highest priority — prevents numeric object keys like "0" from hijacking)
  if (idLower) {
    const byId = PCG_CANONICAL_CALL_PARAMS.find(
      (def) => def.id.toLowerCase() === idLower || def.panelKey.toLowerCase() === idLower || def.aliases.some((a) => a.toLowerCase() === idLower)
    );
    if (byId) return byId;
  }

  // 2. Match on non-numeric object key
  if (keyLower && !isNumericKey) {
    const byKey = PCG_CANONICAL_CALL_PARAMS.find(
      (def) => def.id.toLowerCase() === keyLower || def.panelKey.toLowerCase() === keyLower || def.aliases.some((a) => a.toLowerCase() === keyLower)
    );
    if (byKey) return byKey;
  }

  // 3. Match on numeric `num` field (1..11)
  if (typeof candidate.num === 'number' && candidate.num >= 1 && candidate.num <= 11) {
    return PCG_CANONICAL_CALL_PARAMS.find((def) => def.num === candidate.num);
  }

  // 4. Match on numbered prefix in `name` (e.g. "1. Call Opening", "8. Fillers...")
  const nameStr = String(candidate.name || '').trim();
  if (nameStr) {
    const numMatch = nameStr.match(/^(\d{1,2})\.\s*/);
    if (numMatch) {
      const parsedNum = parseInt(numMatch[1], 10);
      const byPrefix = PCG_CANONICAL_CALL_PARAMS.find((def) => def.num === parsedNum);
      if (byPrefix) return byPrefix;
    }
    const nameLower = nameStr.toLowerCase();
    if (nameLower.includes('opening')) return PCG_CANONICAL_CALL_PARAMS[0];
    if (nameLower.includes('closing')) return PCG_CANONICAL_CALL_PARAMS[1];
    if (nameLower.includes('technically') || nameLower.includes('legally')) return PCG_CANONICAL_CALL_PARAMS[2];
    if (nameLower.includes('all questions')) return PCG_CANONICAL_CALL_PARAMS[3];
    if (nameLower.includes('expectation')) return PCG_CANONICAL_CALL_PARAMS[4];
    if (nameLower.includes('process') || nameLower.includes('pre-check')) return PCG_CANONICAL_CALL_PARAMS[5];
    if (nameLower.includes('vocabulary') || nameLower.includes('grammar')) return PCG_CANONICAL_CALL_PARAMS[6];
    if (nameLower.includes('filler') || nameLower.includes('dead air') || nameLower.includes('fumbling')) return PCG_CANONICAL_CALL_PARAMS[7];
    if (nameLower.includes('warmth') || nameLower.includes('energy') || nameLower.includes('tone')) return PCG_CANONICAL_CALL_PARAMS[8];
    if (nameLower.includes('active listening') || nameLower.includes('empathy') || nameLower.includes('interruption')) return PCG_CANONICAL_CALL_PARAMS[9];
    if (nameLower.includes('simplifying')) return PCG_CANONICAL_CALL_PARAMS[10];
  }

  // 5. Fallback: 0-based numeric index key ("0".."10")
  if (isNumericKey) {
    const idx = parseInt(keyStr, 10);
    if (idx >= 0 && idx < PCG_CANONICAL_CALL_PARAMS.length) {
      return PCG_CANONICAL_CALL_PARAMS[idx];
    }
  }

  return undefined;
}

export function earnedScoreForStatus(status: 'Yes' | 'Half' | 'No' | 'NA', weight: number): number {
  if (status === 'Yes') return weight;
  if (status === 'Half') return Math.round((weight / 2) * 10) / 10;
  return 0;
}

/**
 * Normalizes any stored `pcg_call_evaluations.parameters` payload (JSON string, Array,
 * named-key Object, or numeric-key Object `{"0": {...}, "1": {...}}`) into a clean,
 * canonical array with reliable `id`, `num`, `maxScore`, `status`, and `earnedScore`.
 */
export function normalizePcgCallParameters(rawParams: any): NormalizedPcgCallParameter[] {
  let parsed = rawParams;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const entries: Array<{ key?: string; val: any }> = Array.isArray(parsed)
    ? parsed.map((val, idx) => ({ key: String(idx), val }))
    : Object.entries(parsed).map(([key, val]) => ({ key, val }));

  const results: NormalizedPcgCallParameter[] = [];
  const seenIds = new Set<string>();

  for (const { key, val } of entries) {
    if (!val || typeof val !== 'object') continue;
    const def = resolveCanonicalPcgParamDef({
      key,
      id: val.id,
      num: typeof val.num === 'number' ? val.num : undefined,
      name: val.name,
    });

    const id = def?.id || (val.id && !/^\d+$/.test(String(val.id)) ? String(val.id) : String(key || ''));
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const maxScore = def?.weight ?? Number(val.maxScore ?? val.weight ?? 10);
    const status = normalizePcgParamStatus(val.status ?? val.rating ?? val.score);
    const earnedScore = earnedScoreForStatus(status, maxScore);
    const expl = String(val.explanation || val.reasoning || val.quote || '').trim();

    results.push({
      id,
      num: def?.num ?? (typeof val.num === 'number' ? val.num : results.length + 1),
      name: val.name || def?.name || id,
      maxScore,
      earnedScore,
      status,
      quote: expl,
      explanation: expl,
      reasoning: expl,
    });
  }

  return results.sort((a, b) => a.num - b.num);
}

/**
 * Applies TL override scores/reasoning from CallEvalPanel (which uses panel keys like
 * `TechnicalLegal`, `Grammar`, `Fillers`) onto existing DB parameters and returns
 * a complete canonical 11-item array ready to persist to `pcg_call_evaluations.parameters`.
 */
export function applyPanelOverridesToPcgParameters(
  existingRawParams: any,
  overrideScores: Record<string, string>,
  overrideReasoning?: Record<string, string>
): NormalizedPcgCallParameter[] {
  const existingList = normalizePcgCallParameters(existingRawParams);
  const existingById = new Map<string, NormalizedPcgCallParameter>();
  for (const p of existingList) {
    existingById.set(p.id, p);
  }

  const lookupMap = (map: Record<string, string> | undefined, def: CanonicalPcgParamDef): string | undefined => {
    if (!map) return undefined;
    const keysToTry = [def.panelKey, def.id, ...def.aliases];
    for (const k of keysToTry) {
      if (map[k] !== undefined) return map[k];
    }
    return undefined;
  };

  return PCG_CANONICAL_CALL_PARAMS.map((def) => {
    const existing = existingById.get(def.id);
    const overrideStatusRaw = lookupMap(overrideScores, def);
    const status = overrideStatusRaw !== undefined
      ? normalizePcgParamStatus(overrideStatusRaw)
      : (existing?.status ?? 'NA');

    const overrideReasonRaw = lookupMap(overrideReasoning, def);
    const expl = (overrideReasonRaw !== undefined && overrideReasonRaw.trim() !== '')
      ? overrideReasonRaw.trim()
      : (existing?.explanation || existing?.reasoning || existing?.quote || '');

    const earnedScore = earnedScoreForStatus(status, def.weight);

    return {
      id: def.id,
      num: def.num,
      name: existing?.name || def.name,
      maxScore: def.weight,
      earnedScore,
      status,
      quote: expl,
      explanation: expl,
      reasoning: expl,
    };
  });
}

/**
 * Deterministically computes IQS & skill-group scores from normalized PCG call parameters.
 */
export function recalculatePcgCallScores(params: NormalizedPcgCallParameter[]): {
  iqsScore: number;
  applicableWeight: number;
  processScore: number;
  communicationScore: number;
  customerServiceScore: number;
} {
  let totalEarned = 0;
  let totalApplicable = 0;
  let processEarned = 0;
  let processApplicable = 0;
  let commEarned = 0;
  let commApplicable = 0;
  let csEarned = 0;
  let csApplicable = 0;

  for (const p of params) {
    if (p.status === 'NA') continue;
    const def = resolveCanonicalPcgParamDef({ id: p.id, num: p.num, name: p.name });
    const weight = def?.weight ?? p.maxScore ?? 0;
    const earned = earnedScoreForStatus(p.status, weight);

    totalApplicable += weight;
    totalEarned += earned;

    if (def?.group === 'Process Skills') {
      processApplicable += weight;
      processEarned += earned;
    } else if (def?.group === 'Communication Skills') {
      commApplicable += weight;
      commEarned += earned;
    } else if (def?.group === 'Customer Service Skills') {
      csApplicable += weight;
      csEarned += earned;
    }
  }

  return {
    iqsScore: totalApplicable > 0 ? Math.round((totalEarned / totalApplicable) * 100) : 0,
    applicableWeight: totalApplicable,
    processScore: processApplicable > 0 ? parseFloat(((processEarned / processApplicable) * 100).toFixed(1)) : 100,
    communicationScore: commApplicable > 0 ? parseFloat(((commEarned / commApplicable) * 100).toFixed(1)) : 100,
    customerServiceScore: csApplicable > 0 ? parseFloat(((csEarned / csApplicable) * 100).toFixed(1)) : 100,
  };
}

/**
 * Formats normalized parameters into the `{ scores, evidence }` shape expected by `CallEvalPanel`.
 * Never silently defaults missing parameters to `'Yes'` when parameter data exists.
 */
export function formatPcgCallIqsScoresForPanel(rawParameters: any): {
  scores: Record<string, string>;
  evidence: Record<string, string>;
} {
  const normalized = normalizePcgCallParameters(rawParameters);
  const scores: Record<string, string> = {};
  const evidence: Record<string, string> = {};

  for (const def of PCG_CANONICAL_CALL_PARAMS) {
    scores[def.panelKey] = 'NA';
    scores[def.id] = 'NA';
  }

  for (const p of normalized) {
    const def = resolveCanonicalPcgParamDef({ id: p.id, num: p.num, name: p.name });
    const status = p.status;
    const quote = p.explanation || p.reasoning || p.quote || '';

    scores[p.id] = status;
    if (quote) evidence[p.id] = quote;

    if (def) {
      scores[def.id] = status;
      scores[def.panelKey] = status;
      scores[`P${def.num}`] = status;
      if (quote) {
        evidence[def.id] = quote;
        evidence[def.panelKey] = quote;
        evidence[`P${def.num}`] = quote;
      }
    }
  }

  return { scores, evidence };
}
