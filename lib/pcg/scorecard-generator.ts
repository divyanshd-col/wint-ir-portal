import { query } from '@/lib/cx/db';
import { canonicalizePcgRmName, isSamePcgAgent } from '@/lib/pcg/canonical-names';
import { TL_TEAMS } from '@/app/api/admin/pcg-calls/route';

export interface PcgScorecardInput {
  rmName: string;
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;   // YYYY-MM-DD (Sunday)
  tlName?: string;
}

export interface GeneratedPcgScorecard {
  id: string;
  rmName: string;
  tlName: string;
  weekStart: string;
  weekEnd: string;
  status: 'draft' | 'published' | 'failed';
  viewedAt: string | null;
  generatedAt: string;
  comments: Array<{
    id: string;
    targetKey: string;
    text: string;
    highlighted: boolean;
    createdAt: string;
  }>;
  numbers: {
    callsHandled: number;
    averageScore: number;
    below85Count: number;
    pickupRateText: string;
    connectRateText: string;
    complianceBreachesCount: number;
  };
  whatWentWell: string;
  themes: Array<{
    pattern: string;
    associatedParameters: string[];
    whyItMatters: string;
    actionable: string;
    isBreach: boolean;
    rankScore: number;
    backingCallIds: string[];
  }>;
  breaches: Array<{
    callId: string;
    score: number;
    flaggedContent: string;
    note: string;
  }>;
  evidence: Array<{
    callId: string;
    score: number;
    topic: string;
    summary: string;
  }>;
}

const PCG_PARAM_NAMES: Record<string, string> = {
  CallOpening: 'Call Opening',
  CallClosing: 'Call Closing',
  TechnicalLegal: 'Technically / Legally Correct',
  TechnicallyLegal: 'Technically / Legally Correct',
  AllQuestions: 'All Questions Addressed',
  Expectation: 'Expectation Setting',
  Process: 'Process / Pre-check',
  Grammar: 'Vocabulary / Sentence Structure / Grammar',
  VocabularyGrammar: 'Vocabulary / Sentence Structure / Grammar',
  Fillers: 'Speech Clarity & Dead Air',
  FillersDeadAir: 'Speech Clarity & Dead Air',
  EnergyTone: 'Energy Level & Tone Modulation',
  ActiveListening: 'Active Listening & Empathy',
  Simplifying: 'Simplifying Answers',
};

export function extractPlainEnglishCallSummary(c: any, rmName: string): string {
  const firstName = (rmName || 'RM').split(' ')[0];

  // 1. If compliance breach reason exists, extract and polish the specific plain-English issue
  if (c.compliance_reason && typeof c.compliance_reason === 'string' && c.compliance_reason.trim()) {
    let reason = c.compliance_reason.trim();
    reason = reason.replace(/\[RM\]/gi, '');
    reason = reason.replace(/\bthe RM\b/gi, firstName);
    reason = reason.replace(/\bRM\b/g, firstName);
    reason = reason.replace(/fixed\/guaranteed/gi, 'fixed');
    reason = reason.replace(/fixed or guaranteed/gi, 'fixed');
    reason = reason.replace(/guaranteed or fixed/gi, 'fixed');
    reason = reason.replace(/guaranteed\/fixed/gi, 'fixed');
    reason = reason.replace(/violating regulatory guidelines against promising fixed returns on debt instruments/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/violating SEBI compliance rules against claiming fixed returns on debt\/bond investments/gi, 'which breaches compliance rules against promising fixed returns on bonds');
    reason = reason.replace(/violating SEBI regulations and internal compliance standards prohibiting fixed return claims/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/violating SEBI regulatory guidelines and compliance rules/gi, 'which violates regulatory compliance rules');
    reason = reason.replace(/violating SEBI guidelines prohibiting fixed return promises on debt instruments/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/breaching SEBI and internal compliance rules that strictly prohibit stating or implying fixed returns on market-linked debt\/bond products/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/violating SEBI compliance regulations against promising fixed returns on debt securities/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/violating SEBI rules prohibiting fixed return claims on debt investments/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/violating SEBI guidelines and internal compliance rules that prohibit stating fixed returns on bond\/debt investments/gi, 'which breaches compliance rules against promising fixed returns');
    reason = reason.replace(/\s+/g, ' ').trim();
    const firstSentence = reason.split(/\.\s+/)[0];
    return firstSentence.endsWith('.') ? firstSentence : `${firstSentence}.`;
  }

  // 2. Parse failing parameters
  let params = c.parameters || [];
  if (typeof params === 'string') {
    try { params = JSON.parse(params); } catch { params = []; }
  }

  if (Array.isArray(params) && params.length > 0) {
    const paramPriority = [
      'TechnicallyLegal', 'TechnicalLegal', 'AllQuestions', 'Expectation', 'Process',
      'FillersDeadAir', 'Fillers', 'VocabularyGrammar', 'Grammar', 'ActiveListening',
      'Simplifying', 'CallOpening', 'CallClosing', 'EnergyTone'
    ];

    const failing = params.filter((p: any) => {
      if (p.status === 'NA' || p.status === 'N/A' || p.isApplicable === false) return false;
      return p.status === 'No' || (p.earnedScore != null && p.earnedScore < (p.maxScore || 10));
    });

    failing.sort((a: any, b: any) => {
      const idxA = paramPriority.indexOf(a.id);
      const idxB = paramPriority.indexOf(b.id);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    if (failing.length > 0) {
      const topFail = failing[0];
      const rawText = topFail.explanation || topFail.reasoning || topFail.quote || '';

      if (topFail.id === 'TechnicallyLegal' || topFail.id === 'TechnicalLegal') {
        if (/fixed|guaranteed/i.test(rawText)) {
          return `${firstName} promised fixed returns on bond offerings instead of framing them as expected annual yield (XIRR).`;
        }
        return `${firstName} quoted inaccurate product terms without explaining the underlying issuer credit risks.`;
      }
      if (topFail.id === 'CallOpening') {
        if (/sir|ma'?am/i.test(rawText)) {
          return `${firstName} addressed the customer directly by first name without using 'Sir' or 'Ma'am' during opening.`;
        }
        return `${firstName} skipped self-introduction and did not verify if the customer was free to speak.`;
      }
      if (topFail.id === 'CallClosing') {
        return `${firstName} closed the discussion without summarizing agreed next steps or setting a follow-up timeline.`;
      }
      if (topFail.id === 'Process') {
        if (/phone number|application|repeat/i.test(rawText)) {
          return `${firstName} did not pre-check the caller's records beforehand, asking them to recite basic information.`;
        }
        return `${firstName} did not review the customer's portfolio history in CRM before placing the call.`;
      }
      if (topFail.id === 'AllQuestions') {
        return `${firstName} missed answering one of the investor's key questions before ending the discussion.`;
      }
      if (topFail.id === 'Expectation') {
        return `${firstName} did not set a specific timeline for when the follow-up documents would be sent on WhatsApp.`;
      }
      if (topFail.id === 'FillersDeadAir' || topFail.id === 'Fillers') {
        return `${firstName} had noticeable speech fumbling and frequent vocal fillers ('um', 'uh') during the pitch.`;
      }
      if (topFail.id === 'ActiveListening') {
        return `${firstName} interrupted or talked over the customer while they were explaining their requirements.`;
      }
      if (topFail.id === 'Simplifying') {
        return `${firstName} used complex financial jargon without explaining what it means in plain English.`;
      }
    }
  }

  return `${firstName} missed key call structure points and follow-up timelines during the discussion.`;
}

export async function generatePcgScorecard(input: PcgScorecardInput): Promise<GeneratedPcgScorecard> {
  const { rmName, weekStart, weekEnd } = input;
  const canonicalName = canonicalizePcgRmName(rmName);

  // Time window: inclusive of Monday 00:00:00 to Sunday 23:59:59 (IST / UTC safe)
  const startTimeIso = `${weekStart}T00:00:00.000Z`;
  const nextMonday = new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString().split('T')[0];
  const endTimeIso = `${nextMonday}T00:00:00.000Z`;

  // Fetch all call recordings and evaluations for this RM in the specified week
  const calls = await query<any>(
    `SELECT 
      r.id AS rec_id,
      r.call_id,
      r.start_time,
      r.duration_seconds,
      r.call_category,
      COALESCE(NULLIF(e.rm_name, 'Unknown'), r.called_by, r.agent_name) AS effective_rm,
      COALESCE(e.tl_name, 'PCG Team') AS tl_name,
      e.iqs_score,
      e.human_override_score,
      e.compliance_tripwire,
      e.compliance_reason,
      e.ai_coaching_tip,
      e.parameters,
      e.process_score,
      e.communication_score,
      e.customer_service_score
    FROM pcg_call_recordings r
    LEFT JOIN pcg_call_evaluations e ON (e.call_id = r.call_id OR e.call_id = r.id::text)
    WHERE r.start_time >= $1 AND r.start_time < $2
    ORDER BY r.start_time ASC`,
    [startTimeIso, endTimeIso]
  );

  // Filter for matching RM using canonical matching
  const rmCalls = calls.filter((c) => isSamePcgAgent(c.effective_rm, canonicalName));

  const totalCalls = rmCalls.length;
  const MINIMUM_CALLS_THRESHOLD = 5;
  if (totalCalls < MINIMUM_CALLS_THRESHOLD) {
    throw new Error(
      `Insufficient calls: ${canonicalName} handled ${totalCalls} call${totalCalls === 1 ? '' : 's'} (minimum ${MINIMUM_CALLS_THRESHOLD} required for weekly scorecard)`
    );
  }

  const answeredCalls = rmCalls.filter((c) => Number(c.duration_seconds || 0) > 0);
  const evaluatedCalls = rmCalls.filter((c) => c.iqs_score != null || c.human_override_score != null);

  const connectRate = totalCalls > 0 ? Math.round((answeredCalls.length / totalCalls) * 100) : 0;
  const pickupRateText = `${connectRate}% pickup rate (${answeredCalls.length} of ${totalCalls} calls connected)`;

  // IQS scores
  const scores = evaluatedCalls.map((c) => Number(c.human_override_score ?? c.iqs_score));
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const below85Count = scores.filter((s) => s < 85).length;

  // Compliance breaches
  const breachCalls = evaluatedCalls.filter((c) => {
    if (c.compliance_tripwire === true) return true;
    if (c.compliance_reason && c.compliance_reason.trim() !== '') return true;
    if (Array.isArray(c.parameters)) {
      const tl = c.parameters.find((p: any) => p.id === 'TechnicalLegal' || p.id === 'TechnicallyLegal');
      if (tl && tl.status === 'No') return true;
    }
    return false;
  });
  const complianceBreachesCount = breachCalls.length;

  // Parameter breakdown analysis
  const paramStats: Record<string, { earned: number; max: number }> = {};
  evaluatedCalls.forEach((c) => {
    if (Array.isArray(c.parameters)) {
      c.parameters.forEach((p: any) => {
        if (!p.id || p.status === 'NA' || p.status === 'N/A' || p.isApplicable === false) return;
        const normKey = p.id === 'TechnicalLegal' ? 'TechnicallyLegal' : p.id;
        if (!paramStats[normKey]) paramStats[normKey] = { earned: 0, max: 0 };
        paramStats[normKey].earned += Number(p.earnedScore || (p.status === 'Yes' ? (p.maxScore || 10) : 0));
        paramStats[normKey].max += Number(p.maxScore || 10);
      });
    }
  });

  const paramPercentages: Array<{ key: string; name: string; pct: number }> = [];
  for (const [key, val] of Object.entries(paramStats)) {
    if (val.max > 0) {
      const pct = Math.round((val.earned / val.max) * 100);
      paramPercentages.push({ key, name: PCG_PARAM_NAMES[key] || key, pct });
    }
  }

  paramPercentages.sort((a, b) => b.pct - a.pct);
  const strongest = paramPercentages.slice(0, 2);
  const weakest = [...paramPercentages].reverse().slice(0, 2);

  // Formulate "What Went Well"
  let whatWentWell = `Demonstrated strong overall call discipline and active engagement throughout the week, handling ${totalCalls} calls with an overall quality score of ${avgScore}%.`;
  if (strongest.length > 0 && strongest[0].pct >= 85) {
    whatWentWell = `Exceptional mastery in ${strongest.map((s) => `${s.name} (${s.pct}%)`).join(' and ')}. Maintained clear rapport and structured conversational flow across ${totalCalls} handled calls.`;
  }

  // Determine Team Lead
  let assignedTl = input.tlName || rmCalls[0]?.tl_name || 'PCG Team';
  if (!input.tlName) {
    for (const [tl, members] of Object.entries(TL_TEAMS)) {
      if (members.some((m) => isSamePcgAgent(m, canonicalName))) {
        assignedTl = `Team ${tl}`;
        break;
      }
    }
  }

  // Construct 1-on-1 Coaching Themes (explained in simple, clear English)
  const themes: GeneratedPcgScorecard['themes'] = [];

  const PARAM_SIMPLE_EXPLANATIONS: Record<string, { whyItMatters: string; actionable: string }> = {
    TechnicallyLegal: {
      whyItMatters:
        'Investors trust us with their life savings. Quoting wrong numbers or promising fixed returns breaks their trust and violates SEBI rules.',
      actionable:
        'Never say "fixed" or "guaranteed returns". Always explain it as an "expected annual yield" (coupon or XIRR), and mention that returns depend on the company issuing the bond.',
    },
    TechnicalLegal: {
      whyItMatters:
        'Investors trust us with their life savings. Quoting wrong numbers or promising fixed returns breaks their trust and violates SEBI rules.',
      actionable:
        'Never say "fixed" or "guaranteed returns". Always explain it as an "expected annual yield" (coupon or XIRR), and mention that returns depend on the company issuing the bond.',
    },
    CallOpening: {
      whyItMatters:
        'The first 15 seconds set the tone for the entire call. A polite and clear greeting helps the customer feel respected and comfortable talking.',
      actionable:
        'Greet the customer warmly ("Good morning/afternoon"), clearly say your name and that you are calling from Wint Wealth, and ask if they have 2 minutes to talk right now.',
    },
    CallClosing: {
      whyItMatters:
        'A clear ending ensures both you and the customer know exactly what happens next, leaving a strong, professional impression.',
      actionable:
        'Summarize agreed next steps, confirm how and when you will follow up (e.g. "I will share this on WhatsApp in 10 minutes"), thank them for their time, and end with a polite goodbye.',
    },
    AllQuestions: {
      whyItMatters:
        'Leaving customer questions unanswered creates doubt and makes them hesitate to invest.',
      actionable:
        'Answer every question directly. If you do not know the answer, do not guess—say: "Let me verify this with our product team and get back to you by [time]."',
    },
    Expectation: {
      whyItMatters:
        'When investors know what to expect and when, they feel confident and do not have to call back repeatedly for updates.',
      actionable:
        'Give clear timelines for every step—tell the investor exactly when to expect their WhatsApp summary, payment link, or allotment details.',
    },
    Process: {
      whyItMatters:
        'Asking customers for information they already shared makes us look unprepared and wastes their time.',
      actionable:
        'Take 30 seconds before dialing to check the customer’s profile, notes, and past investments in the CRM so you speak with full context.',
    },
    Grammar: {
      whyItMatters:
        'Clear, simple sentences help investors understand financial products without getting confused or overwhelmed.',
      actionable:
        'Speak in short, simple sentences. Pronounce fund and bond names clearly, and explain any financial terms in everyday language.',
    },
    VocabularyGrammar: {
      whyItMatters:
        'Clear, simple sentences help investors understand financial products without getting confused or overwhelmed.',
      actionable:
        'Speak in short, simple sentences. Pronounce fund and bond names properly, and explain any financial terms in everyday language.',
    },
    Fillers: {
      whyItMatters:
        'Frequent pauses, "umms", or long dead air make you sound unsure of yourself and reduce the investor’s confidence in your advice.',
      actionable:
        'Speak at a steady, calm pace. If you need a moment to search on your screen, let the customer know: "Please give me a moment while I pull up your account."',
    },
    FillersDeadAir: {
      whyItMatters:
        'Frequent pauses, "umms", or long dead air make you sound unsure of yourself and reduce the investor’s confidence in your advice.',
      actionable:
        'Speak at a steady, calm pace. If you need a moment to search on your screen, let the customer know: "Please give me a moment while I pull up your account."',
    },
    EnergyTone: {
      whyItMatters:
        'A warm, confident, and polite voice builds a real connection and reassures investors that their wealth is in safe hands.',
      actionable:
        'Stay energetic and attentive throughout the call. Avoid speaking in a flat, rushed voice—smiling while speaking naturally brings warmth to your voice.',
    },
    ActiveListening: {
      whyItMatters:
        'Investors want to feel heard and respected. Interrupting them or talking over them damages trust.',
      actionable:
        'Let the customer finish speaking completely before answering. Acknowledge what they said (e.g. "I understand your concern about liquidity...") before sharing your advice.',
    },
    Simplifying: {
      whyItMatters:
        'Complex bond terms like XIRR, seniority, and debentures can intimidate investors if they are not explained simply.',
      actionable:
        'Explain difficult financial terms using everyday examples. For instance, explain yield as "how much money you earn each year on the amount you invest."',
    },
  };

  // Theme 1: Compliance & Regulatory Accuracy (if any breaches)
  if (breachCalls.length > 0) {
    const breachCallIds = breachCalls.map((c) => c.call_id || String(c.rec_id)).slice(0, 4);
    themes.push({
      pattern: 'Fixed Return Claims & Regulatory Disclosures',
      associatedParameters: ['Technically / Legally Correct', 'Expectation Setting'],
      whyItMatters:
        'Promising fixed or guaranteed returns is against SEBI rules and misleads investors about the risks involved.',
      actionable:
        'Always explain returns as an "expected annual yield" (XIRR or coupon). Clearly explain that returns depend on the company issuing the bond, rather than saying "fixed returns" or "guaranteed".',
      isBreach: true,
      rankScore: 1,
      backingCallIds: breachCallIds,
    });
  }

  // Theme 2: Weakest Parameter Coaching
  if (weakest.length > 0 && weakest[0].pct < 85) {
    const targetParam = weakest[0];
    const failingCalls = evaluatedCalls
      .filter((c) => {
        if (!Array.isArray(c.parameters)) return false;
        const p = c.parameters.find((param: any) => param.id === targetParam.key || param.name === targetParam.name);
        return p && (p.status === 'No' || (p.earnedScore && p.earnedScore < (p.maxScore || 10)));
      })
      .map((c) => c.call_id || String(c.rec_id))
      .slice(0, 3);

    const simple = PARAM_SIMPLE_EXPLANATIONS[targetParam.key] ||
      PARAM_SIMPLE_EXPLANATIONS[targetParam.name] || {
      whyItMatters: `Clear and accurate communication in ${targetParam.name} builds investor confidence and helps them make informed decisions.`,
      actionable: `Focus on explaining ${targetParam.name} clearly in simple words and confirm the investor understands before moving to the next topic.`,
    };

    themes.push({
      pattern: `${targetParam.name} Improvement (${targetParam.pct}%)`,
      associatedParameters: [targetParam.name],
      whyItMatters: simple.whyItMatters,
      actionable: simple.actionable,
      isBreach: false,
      rankScore: 2,
      backingCallIds: failingCalls.length > 0 ? failingCalls : rmCalls.slice(0, 2).map((c) => c.call_id || String(c.rec_id)),
    });
  }

  // Default theme if none generated
  if (themes.length === 0) {
    themes.push({
      pattern: 'Understanding Investor Needs & Building Rapport',
      associatedParameters: ['Expectation Setting', 'Simplifying Answers'],
      whyItMatters:
        'Understanding what the customer is looking for helps you recommend the right investments for their financial goals.',
      actionable:
        'Ask open questions about their past investments—such as when their fixed deposits are maturing or how long they plan to invest.',
      isBreach: false,
      rankScore: 1,
      backingCallIds: rmCalls.slice(0, 2).map((c) => c.call_id || String(c.rec_id)),
    });
  }

  // Breaches list
  const breaches: GeneratedPcgScorecard['breaches'] = breachCalls.slice(0, 5).map((c) => ({
    callId: c.call_id || String(c.rec_id),
    score: Number(c.human_override_score ?? c.iqs_score ?? 0),
    flaggedContent: c.compliance_reason || 'Mentioned guaranteed/fixed return on market debt product without risk caveat.',
    note: c.iqs_score >= 85 ? `Scored ${c.iqs_score}% overall but flagged for mandatory compliance check.` : 'Requires TL review in weekly 1-on-1 coaching.',
  }));

  // Evidence calls (worst scoring calls first)
  const sortedAudited = [...evaluatedCalls].sort(
    (a, b) => Number(a.human_override_score ?? a.iqs_score) - Number(b.human_override_score ?? b.iqs_score)
  );

  const seenSummaries = new Set<string>();
  const evidence: GeneratedPcgScorecard['evidence'] = sortedAudited.slice(0, 6).map((c, idx) => {
    let summary = c.ai_coaching_tip || extractPlainEnglishCallSummary(c, canonicalName);

    // If an identical summary was already emitted for a previous call in this report, differentiate it
    if (seenSummaries.has(summary)) {
      let params = c.parameters || [];
      if (typeof params === 'string') {
        try { params = JSON.parse(params); } catch { params = []; }
      }
      const secondaryFail = Array.isArray(params)
        ? params.find((p: any) => p.status === 'No' || (p.earnedScore != null && p.earnedScore < (p.maxScore || 10)))
        : null;

      if (secondaryFail?.id === 'FillersDeadAir') {
        summary = `${summary.replace(/\.$/, '')}, along with frequent speech fumbling and word repetitions.`;
      } else if (secondaryFail?.id === 'CallClosing') {
        summary = `${summary.replace(/\.$/, '')}, and concluded without confirming agreed next steps.`;
      } else if (secondaryFail?.id === 'CallOpening') {
        summary = `${summary.replace(/\.$/, '')}, and omitted polite greeting etiquette.`;
      } else if (secondaryFail?.id === 'Process') {
        summary = `${summary.replace(/\.$/, '')}, without checking CRM profile notes beforehand.`;
      } else if (secondaryFail?.id === 'Expectation') {
        summary = `${summary.replace(/\.$/, '')}, without setting clear timelines for WhatsApp follow-up.`;
      } else {
        const turnMatch = (c.compliance_reason || '').match(/Turn \d+/i);
        if (turnMatch) {
          summary = `${summary.replace(/\.$/, '')} (noted in ${turnMatch[0]}).`;
        } else {
          summary = `${summary.replace(/\.$/, '')} (call observation #${idx + 1}).`;
        }
      }
    }
    seenSummaries.add(summary);

    return {
      callId: c.call_id || String(c.rec_id),
      score: Number(c.human_override_score ?? c.iqs_score ?? 0),
      topic: c.call_category || '13% Pitching',
      summary,
    };
  });

  const reportId = `${canonicalName.toLowerCase().replace(/\s+/g, '-')}:${weekStart}`;

  return {
    id: reportId,
    rmName: canonicalName,
    tlName: assignedTl,
    weekStart,
    weekEnd,
    status: 'published',
    viewedAt: null,
    generatedAt: new Date().toISOString(),
    comments: [],
    numbers: {
      callsHandled: totalCalls,
      averageScore: avgScore,
      below85Count,
      pickupRateText,
      connectRateText: pickupRateText,
      complianceBreachesCount,
    },
    whatWentWell,
    themes,
    breaches,
    evidence,
  };
}

