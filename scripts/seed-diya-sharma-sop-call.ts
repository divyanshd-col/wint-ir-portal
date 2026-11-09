import { query } from '../lib/cx/db';

async function seedDiyaSopCall() {
  console.log('--- Seeding SOP Trigger Test Call for Diya Sharma ---');

  // 1. Ensure sop_triggers column exists on pcg_call_evaluations
  try {
    await query(`
      ALTER TABLE pcg_call_evaluations
        ADD COLUMN IF NOT EXISTS sop_triggers JSONB DEFAULT '[]'::jsonb;
    `);
    console.log('✓ Ensured sop_triggers column exists in pcg_call_evaluations');
  } catch (err: any) {
    console.warn('Column ensure warning:', err?.message || err);
  }

  const callId = 'demo-diya-sop-001';
  const rmName = 'Diya Sharma';
  const tlName = 'Team Swetha';
  const customerPhone = '+919876543210';
  const durationSeconds = 225; // 3m 45s

  const transcriptTurns = [
    {
      turnIndex: 1,
      speaker: 'RM',
      time: '00:04',
      text: 'Good afternoon, thank you for calling Wint Wealth Private Client Group. My name is Diya Sharma. Am I speaking with Mr. Rajesh?'
    },
    {
      turnIndex: 2,
      speaker: 'Customer',
      time: '00:15',
      text: 'Yes, Diya. I am calling regarding my senior secured bond interest payout that was due yesterday.'
    },
    {
      turnIndex: 3,
      speaker: 'RM',
      time: '00:26',
      text: 'Sure, Mr. Rajesh. I can certainly check the settlement status for you right away. May I take 30 seconds to pull up your portfolio details?'
    },
    {
      turnIndex: 4,
      speaker: 'Customer',
      time: '00:36',
      text: 'Yes, please check fast. It was supposed to hit my HDFC account yesterday itself.'
    },
    {
      turnIndex: 5,
      speaker: 'RM',
      time: '00:52',
      text: 'Thank you for holding, Sir. I see the coupon payment for the 11.5% Muthoot Capital bond was processed by the clearing corporation yesterday evening. Because of banking clearing cycles, RTGS credits reflect within 24 to 48 banking hours.'
    },
    {
      turnIndex: 6,
      speaker: 'Customer',
      time: '01:18',
      text: 'Why 48 hours? You people always give excuses about clearing cycles! I expected the money yesterday morning.'
    },
    {
      turnIndex: 7,
      speaker: 'RM',
      time: '01:34',
      text: 'I completely understand your expectation, Sir. As per standard banking norms, clearing takes T+1 day. We anticipate the amount will reflect in your account by the end of today.'
    },
    {
      turnIndex: 8,
      speaker: 'Customer',
      time: '02:15',
      text: 'Listen to me very carefully. If this interest payout is not credited to my bank account by 5 PM today, I am going to file a formal complaint with SEBI against Wint Wealth and drag your company to consumer court.'
    },
    {
      turnIndex: 9,
      speaker: 'RM',
      time: '02:35',
      text: 'Sir, I completely understand how critical this payout is for you. I have marked this with our priority operations desk, and I will personally follow up with our banking ops lead right after this call to ensure you receive the UTR number by 4 PM.'
    },
    {
      turnIndex: 10,
      speaker: 'Customer',
      time: '03:02',
      text: 'Fine, send me the UTR number on WhatsApp before 4 PM. If it doesn\'t come, I will take legal steps.'
    },
    {
      turnIndex: 11,
      speaker: 'RM',
      time: '03:22',
      text: 'Yes, Mr. Rajesh, I have noted this down and will share the UTR as promised. Thank you for your patience, Sir, and have a good day.'
    }
  ];

  const sopTriggers = [
    {
      category: 'Customer Behaviour & Hostility',
      severity: 'CRITICAL',
      direction: 'Customer said this to RM',
      signal: 'Threatening legal action or regulator complaint',
      timestamp: '02:15',
      turn_index: 8,
      quote: 'If this interest payout is not credited to my bank account by 5 PM today, I am going to file a formal complaint with SEBI against Wint Wealth and drag your company to consumer court.'
    }
  ];

  const parameters = {
    CallOpening: {
      name: 'Call Opening',
      maxScore: 5,
      earnedScore: 5,
      status: 'Yes',
      explanation: 'Turn 1 [RM]: RM warmly greeted client with respectful salutation, identified self (Diya Sharma) and brand (Wint Wealth PCG), and verified client identity before proceeding.',
      quote: 'Good afternoon, thank you for calling Wint Wealth Private Client Group. My name is Diya Sharma. Am I speaking with Mr. Rajesh?'
    },
    CallClosing: {
      name: 'Call Closing',
      maxScore: 5,
      earnedScore: 5,
      status: 'Yes',
      explanation: 'Turn 11 [RM]: RM summarized next steps (sharing UTR by 4 PM on WhatsApp), thanked client politely with Sir salutation, and concluded warmly.',
      quote: 'Yes, Mr. Rajesh, I have noted this down and will share the UTR as promised. Thank you for your patience, Sir, and have a good day.'
    },
    TechnicallyLegal: {
      name: 'Technically / Legally Correct',
      maxScore: 15,
      earnedScore: 15,
      status: 'Yes',
      explanation: 'Turn 5 [RM]: Accurately explained clearing corporation banking cycle and RTGS credit timelines without making unauthorized financial guarantees.',
      quote: 'coupon payment for the 11.5% Muthoot Capital bond was processed by the clearing corporation yesterday evening. Because of banking clearing cycles, RTGS credits reflect within 24 to 48 banking hours.'
    },
    AllQuestions: {
      name: 'All Questions Addressed',
      maxScore: 10,
      earnedScore: 10,
      status: 'Yes',
      explanation: 'Addressed client payout status inquiry thoroughly and committed to specific UTR follow-up.',
      quote: 'All client questions addressed with clear banking cycle explanation.'
    },
    Expectation: {
      name: 'Expectation Setting',
      maxScore: 10,
      earnedScore: 10,
      status: 'Yes',
      explanation: 'Turn 9 [RM]: Committed to providing UTR by 4 PM and coordinating directly with backend ops.',
      quote: 'I will personally follow up with our banking ops lead right after this call to ensure you receive the UTR number by 4 PM.'
    },
    Process: {
      name: 'Process / Pre-check',
      maxScore: 5,
      earnedScore: 5,
      status: 'Yes',
      explanation: 'Turn 3 [RM]: RM asked for permission before checking portfolio details, minimizing dead air.',
      quote: 'May I take 30 seconds to pull up your portfolio details?'
    },
    VocabularyGrammar: {
      name: 'Vocabulary / Sentence Structure / Grammar',
      maxScore: 10,
      earnedScore: 10,
      status: 'Yes',
      explanation: 'Professional vocabulary, fluent English, and respectful tone maintained throughout.',
      quote: 'Professional vocabulary maintained throughout.'
    },
    FillersDeadAir: {
      name: 'Fillers, Speech Clarity / Avoid Dead Air',
      maxScore: 10,
      earnedScore: 10,
      status: 'Yes',
      explanation: 'Fluent delivery with zero unannounced dead air. Hold time was announced.',
      quote: 'Fluent delivery with zero unannounced dead air.'
    },
    EnergyTone: {
      name: 'Warmth, Energy & Tone Modulation',
      maxScore: 10,
      earnedScore: 9,
      status: 'Yes',
      explanation: 'Maintained remarkable composure, calm de-escalation, and professional courtesy despite client hostility.',
      quote: 'Composed, polite, and calm demeanor during tense exchange.'
    },
    ActiveListening: {
      name: 'Active Listening & Empathy',
      maxScore: 10,
      earnedScore: 9,
      status: 'Yes',
      explanation: 'Turn 9 [RM]: Acknowledged client frustration and validated concern without getting defensive.',
      quote: 'Sir, I completely understand how critical this payout is for you.'
    },
    Simplifying: {
      name: 'Simplifying Answers',
      maxScore: 10,
      earnedScore: 10,
      status: 'Yes',
      explanation: 'Clear explanation of clearing corporation settlement mechanisms in accessible terms.',
      quote: 'Clear explanation of clearing corporation settlement mechanisms.'
    }
  };

  // 2. Insert into pcg_call_recordings
  await query(`
    INSERT INTO pcg_call_recordings (
      call_id, caller_id, called_by, agent_name, customer_id, phone_number,
      user_phone, process_id, call_type, tag, duration_seconds, recording_url,
      start_time, created_at_time, raw_payload, call_nature, call_category, category_source
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12,
      NOW() - interval '2 hours', NOW() - interval '2 hours',
      $13, 'client', 'support', 'ai_triage'
    )
    ON CONFLICT (call_id) DO UPDATE SET
      called_by = EXCLUDED.called_by,
      agent_name = EXCLUDED.agent_name,
      phone_number = EXCLUDED.phone_number,
      duration_seconds = EXCLUDED.duration_seconds,
      call_nature = EXCLUDED.call_nature,
      call_category = EXCLUDED.call_category,
      updated_at = NOW();
  `, [
    callId,
    'runo-demo-diya',
    rmName,
    rmName,
    'cust-demo-rajesh',
    customerPhone,
    '+919988776655',
    'PCG_INBOUND',
    'incoming',
    'answered',
    durationSeconds,
    null,
    JSON.stringify({ duration: durationSeconds, direction: 'inbound', demo: true })
  ]);
  console.log(`✓ Inserted call recording ${callId} for ${rmName}`);

  // 3. Insert into pcg_call_evaluations
  await query(`
    INSERT INTO pcg_call_evaluations (
      call_id, rm_name, tl_name, customer_phone, call_category, duration_seconds,
      iqs_score, process_score, communication_score, customer_service_score, applicable_weight,
      verdict, is_evaluable, exclusion_reason, parameters, compliance_tripwire, compliance_reason,
      ai_coaching_tip, transcript_turns, sop_triggers, scored_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, 'support', $5,
      86, 88.0, 90.0, 80.0, 100,
      'PASS', true, null, $6, false, null,
      'Excellent de-escalation of a hostile customer making regulatory complaints. Always follow up with the promised UTR within the agreed timeline.',
      $7, $8, NOW() - interval '2 hours', NOW()
    )
    ON CONFLICT (call_id) DO UPDATE SET
      rm_name = EXCLUDED.rm_name,
      tl_name = EXCLUDED.tl_name,
      customer_phone = EXCLUDED.customer_phone,
      call_category = EXCLUDED.call_category,
      duration_seconds = EXCLUDED.duration_seconds,
      iqs_score = EXCLUDED.iqs_score,
      verdict = EXCLUDED.verdict,
      parameters = EXCLUDED.parameters,
      transcript_turns = EXCLUDED.transcript_turns,
      sop_triggers = EXCLUDED.sop_triggers,
      scored_at = NOW(),
      updated_at = NOW();
  `, [
    callId,
    rmName,
    tlName,
    customerPhone,
    durationSeconds,
    JSON.stringify(parameters),
    JSON.stringify(transcriptTurns),
    JSON.stringify(sopTriggers)
  ]);
  console.log(`✓ Inserted evaluation with SOP triggers for ${callId} (${rmName} - ${tlName})`);
  console.log('--- SEED COMPLETED SUCCESSFULLY ---');
}

seedDiyaSopCall().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
}).finally(() => {
  process.exit(0);
});

