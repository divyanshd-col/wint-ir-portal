/**
 * scripts/seed-sample-email-evaluations.ts
 *
 * Seeds 10 realistic sample entries into email_conversations and email_reply_evaluations
 * covering all scenarios specified in the document:
 * 1. High score compliant reply (<= 3 history)
 * 2. High score with structured 4-part summary (> 3 history)
 * 3. Low score reply (< 85%)
 * 4. Serious compliance failure (triggers compliance alert tag)
 * 5. QA override score change (60% -> 75% per Page 6 of doc)
 * 6. Multiple agents handling same ticket (Agent A gets 95%, Agent B gets 65%)
 * 7. Multiple agents - Reply 2 on same ticket
 * 8. Merged ticket scenario (Ticket B merged into Ticket A per Page 3 of doc)
 * 9. Active agent dispute raised
 * 10. Newly received reply with status 'Pending' waiting for 3 PM / Overnight batch
 */

import './_load-env';
import { query } from '@/lib/cx/db';

async function seedData() {
  console.log('Seeding 10 realistic email evaluation records…');

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();

  // ── 1. Create or ensure email_conversations ─────────────────────────────────
  const conversations = [
    {
      id: 'ticket_em_1001',
      chat_id: 'chat_em_1001',
      subject_line: 'SIP cancellation & refund of ₹10,000',
      customer_email: 'rahul.sharma@example.com',
      customer_phone: '+919876543210',
      agent_name: 'Bhavika',
      status: 'OPEN',
      created_at: daysAgo(2),
      thread_summary: {
        core_query: 'Customer requested SIP cancellation & refund of ₹10,000',
        actions_taken: 'Agent requested PAN card on Oct 1; Customer submitted PAN on Oct 3',
        pending_action: 'Bank statement verification (Pending on Operations Team)',
        commitments_set: 'Promised resolution timeline of 48 hours (due Oct 8)',
      },
    },
    {
      id: 'ticket_em_1002',
      chat_id: 'chat_em_1002',
      subject_line: 'Query regarding DIS Booklet delivery tracking',
      customer_email: 'bikram.bhowmick@example.com',
      customer_phone: '+919811223344',
      agent_name: 'Aman Sharma',
      status: 'RESOLVED',
      created_at: daysAgo(3),
    },
    {
      id: 'ticket_em_1003',
      chat_id: 'chat_em_1003',
      subject_line: 'TDS Certificate / Form 16A download inquiry',
      customer_email: 'ananya.iyer@example.com',
      customer_phone: '+919833445566',
      agent_name: 'Priya Singh',
      status: 'OPEN',
      created_at: hoursAgo(10),
    },
    {
      id: 'ticket_em_1004',
      chat_id: 'chat_em_1004',
      subject_line: 'Secondary market bond sale timeline',
      customer_email: 'vikram.mehta@example.com',
      customer_phone: '+919822334455',
      agent_name: 'Kriti',
      status: 'OPEN',
      created_at: daysAgo(5),
    },
    {
      id: 'ticket_em_1005_A',
      chat_id: 'chat_em_1005_A',
      subject_line: 'Senior Secured Bond interest credit delay (Primary Ticket)',
      customer_email: 'suresh.patel@example.com',
      customer_phone: '+919988776655',
      agent_name: 'Vedant G',
      status: 'OPEN',
      created_at: daysAgo(4),
    },
    {
      id: 'ticket_em_1005_B',
      chat_id: 'chat_em_1005_B',
      subject_line: 'Duplicate Inquiry: When will bond payout credit? (Merged Ticket)',
      customer_email: 'suresh.patel@example.com',
      customer_phone: '+919988776655',
      agent_name: 'Vedant G',
      status: 'MERGED',
      merged_into_ticket_id: 'ticket_em_1005_A',
      created_at: daysAgo(3),
      thread_summary: {
        core_query: 'Customer raised duplicate query regarding October interest delay',
        actions_taken: 'Merged into main ticket ticket_em_1005_A',
        pending_action: 'Banking confirmation from clearing corporation',
        commitments_set: 'Payout resolution within 24 hours',
      },
    },
    {
      id: 'ticket_em_1006',
      chat_id: 'chat_em_1006',
      subject_line: 'SIP mandate bank switch from HDFC to Axis Bank',
      customer_email: 'karan.malhotra@example.com',
      customer_phone: '+919877001122',
      agent_name: 'Bhavika',
      status: 'OPEN',
      created_at: hoursAgo(5),
    },
    {
      id: 'ticket_em_1007',
      chat_id: 'chat_em_1007',
      subject_line: 'Nominee addition status in demat account',
      customer_email: 'sunita.verma@example.com',
      customer_phone: '+919866112233',
      agent_name: 'Aman Sharma',
      status: 'OPEN',
      created_at: hoursAgo(7),
    },
    {
      id: 'ticket_em_1008',
      chat_id: 'chat_em_1008',
      subject_line: 'Senior Secured Bond quarterly yield computation',
      customer_email: 'rohit.singh@example.com',
      customer_phone: '+919855223344',
      agent_name: 'Vedant G',
      status: 'OPEN',
      created_at: hoursAgo(9),
    },
    {
      id: 'ticket_em_1009',
      chat_id: 'chat_em_1009',
      subject_line: 'Bank account verification cheque rejected',
      customer_email: 'meera.nair@example.com',
      customer_phone: '+919844332211',
      agent_name: 'Kriti',
      status: 'OPEN',
      created_at: hoursAgo(4),
    },
    {
      id: 'ticket_em_1010',
      chat_id: 'chat_em_1010',
      subject_line: 'Capital gains statement request for FY 23-24',
      customer_email: 'deepak.gupta@example.com',
      customer_phone: '+919833221100',
      agent_name: 'Priya Singh',
      status: 'OPEN',
      created_at: hoursAgo(3),
    },
    {
      id: 'ticket_em_1011',
      chat_id: 'chat_em_1011',
      subject_line: 'SGB premature redemption window procedure',
      customer_email: 'arjun.kapoor@example.com',
      customer_phone: '+919822119988',
      agent_name: 'Apoorv',
      status: 'OPEN',
      created_at: hoursAgo(6),
    },
    {
      id: 'ticket_em_1012',
      chat_id: 'chat_em_1012',
      subject_line: 'Form 15G acknowledgement & TDS exemption query',
      customer_email: 'radhika.menon@example.com',
      customer_phone: '+919811776655',
      agent_name: 'Apoorv',
      status: 'OPEN',
      created_at: hoursAgo(8),
    },
    {
      id: 'ticket_em_1013',
      chat_id: 'chat_em_1013',
      subject_line: 'Demat transfer-cum-closure authorization request',
      customer_email: 'manish.joshi@example.com',
      customer_phone: '+919899334411',
      agent_name: 'Apoorv',
      status: 'OPEN',
      created_at: hoursAgo(2),
    },
    {
      id: 'ticket_em_1014',
      chat_id: 'chat_em_1014',
      subject_line: 'Secondary market bond sell order execution timeline',
      customer_email: 'neha.bhatia@example.com',
      customer_phone: '+919877443322',
      agent_name: 'Apoorv',
      status: 'OPEN',
      created_at: hoursAgo(1),
    },
  ];

  for (const c of conversations) {
    await query(
      `INSERT INTO email_conversations
       (id, chat_id, subject_line, customer_email, customer_phone, agent_name, status, created_at, merged_into_ticket_id, thread_summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         merged_into_ticket_id = EXCLUDED.merged_into_ticket_id,
         thread_summary = EXCLUDED.thread_summary,
         updated_at = NOW()`,
      [
        c.id,
        c.chat_id,
        c.subject_line,
        c.customer_email,
        c.customer_phone,
        c.agent_name,
        c.status,
        c.created_at,
        (c as any).merged_into_ticket_id || null,
        c.thread_summary ? JSON.stringify(c.thread_summary) : null,
      ]
    );
  }
  console.log('✓ Seeded/updated email_conversations containers.');

  // ── 2. Seed 10 distinct evaluation entries ──────────────────────────────────
  const entries = [
    // Entry 1: High Score Compliant Reply (<= 3 history)
    {
      ticket_id: 'ticket_em_1003',
      message_id: 'msg_sample_01',
      agent_id: 'agent_priya',
      agent_name: 'Priya Singh',
      sent_at: hoursAgo(8),
      customer_message: 'Hi team, where can I download Form 16A TDS certificate for Q2 FY25? I need it for filing tax returns.',
      agent_reply_text: 'Dear Ananya,\n\nYou can easily download your Form 16A (TDS certificate) by logging into the Wint Wealth portal:\n1. Go to your Profile icon (top right).\n2. Click on Reports & Statements.\n3. Under "Tax Documents", select FY 2024-25 and download the Q2 PDF certificate.\n\nShould you need any further assistance, please feel free to write back.\n\nWarm regards,\nPriya Singh\nWint Wealth Support',
      evaluation_status: 'Completed',
      quality_score: 96.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'yes', clarity: 'yes', tone: 'yes', process_adherence: 'yes', expectation_setting: 'yes' },
      qa_override_score: null,
      qa_notes: 'Exemplary reply: Clear step-by-step navigation and professional courteous tone.',
      dispute_status: 'None',
      evaluated_at: hoursAgo(6),
    },

    // Entry 2: High Score with structured 4-part summary (> 3 history)
    {
      ticket_id: 'ticket_em_1001',
      message_id: 'msg_sample_02',
      agent_id: 'agent_bhavika',
      agent_name: 'Bhavika',
      sent_at: hoursAgo(18),
      customer_message: 'I submitted my PAN 2 days back as requested. Please confirm refund status of ₹10,000.',
      agent_reply_text: 'Dear Rahul,\n\nThank you for providing your PAN details. We have verified your account with our Operations team.\n\nYour SIP cancellation request has been executed, and the refund of ₹10,000 has been initiated to your registered ICICI bank account (ending in 4821). The amount will reflect in your account within 24 to 48 business hours (by Oct 8, 5 PM).\n\nHere is your transaction reference number: WW-REF-99281.\n\nBest regards,\nBhavika\nWint Wealth IR Team',
      evaluation_status: 'Completed',
      quality_score: 94.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'yes', clarity: 'yes', tone: 'yes', process_adherence: 'yes', expectation_setting: 'partial' },
      qa_override_score: null,
      qa_notes: 'Directly referenced prior PAN verification, provided explicit timeline and UTR reference.',
      dispute_status: 'None',
      evaluated_at: hoursAgo(12),
    },

    // Entry 3: Low Score reply (< 85%) due to vague timeline
    {
      ticket_id: 'ticket_em_1002',
      message_id: 'msg_sample_03',
      agent_id: 'agent_aman',
      agent_name: 'Aman Sharma',
      sent_at: daysAgo(2),
      customer_message: 'Please send courier tracking number for my DIS booklet. It was promised 3 days ago.',
      agent_reply_text: 'Hi Bikram,\nYour DIS booklet is dispatched. Courier details will be sent soon.\nThanks,\nAman',
      evaluation_status: 'Completed',
      quality_score: 68.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'partial', completeness: 'partial', clarity: 'partial', tone: 'yes', process_adherence: 'partial', expectation_setting: 'no' },
      qa_override_score: null,
      qa_notes: 'Too brief. Failed to include airway bill number or expected delivery date.',
      dispute_status: 'None',
      evaluated_at: daysAgo(1),
    },

    // Entry 4: Serious Compliance Failure (Guaranteed Return claim)
    {
      ticket_id: 'ticket_em_1004',
      message_id: 'msg_sample_04',
      agent_id: 'agent_kriti',
      agent_name: 'Kriti',
      sent_at: daysAgo(3),
      customer_message: 'Is my capital 100% risk free in this corporate bond? Can I get my money back anytime without loss?',
      agent_reply_text: 'Hello Vikram,\nYes, this is 100% guaranteed risk-free return and your money is completely safe. You will definitely not lose any principal and we guarantee liquidity on the secondary market anytime.\nRegards,\nKriti',
      evaluation_status: 'Completed',
      quality_score: 42.0,
      compliance_passed: false,
      compliance_issues: [
        'SEBI Violation: Promised 100% risk-free return on non-government debentures',
        'Misleading claim regarding guaranteed secondary market liquidity without price risk disclosure',
      ],
      parameter_scores: { accuracy: 'no', completeness: 'no', clarity: 'yes', tone: 'yes', process_adherence: 'no', expectation_setting: 'no' },
      qa_override_score: null,
      qa_notes: 'Critical compliance violation: Agent stated bond investment is 100% guaranteed without mandatory risk disclosures. Slack alert dispatched to TL & Compliance.',
      dispute_status: 'None',
      evaluated_at: daysAgo(2),
    },

    // Entry 5: QA Override Example (originally 60% -> QA adjusted to 75% per Page 6 of doc)
    {
      ticket_id: 'ticket_em_1002',
      message_id: 'msg_sample_05',
      agent_id: 'agent_aman',
      agent_name: 'Aman Sharma',
      sent_at: daysAgo(1),
      customer_message: 'I still did not receive tracking link on SMS.',
      agent_reply_text: 'Hello Bikram,\nApologies for the inconvenience. Here is your tracking number: BlueDart AWB 77192841. Delivery is estimated by tomorrow afternoon.\nRegards,\nAman Sharma',
      evaluation_status: 'Completed',
      quality_score: 60.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'partial', clarity: 'partial', tone: 'partial', process_adherence: 'partial', expectation_setting: 'yes' },
      qa_override_score: 75.0,
      qa_notes: 'QA Override: AI model scored low on tone, but agent provided exact AWB and apologized appropriately. Adjusted score from 60% to 75%.',
      dispute_status: 'None',
      evaluated_at: hoursAgo(20),
    },

    // Entry 6: Multi-agent ticket: Reply 1 by Agent A (Gets 95% - Page 1 & 6)
    {
      ticket_id: 'ticket_em_1005_A',
      message_id: 'msg_sample_06_agent_a',
      agent_id: 'agent_vedant',
      agent_name: 'Vedant G',
      sent_at: daysAgo(3),
      customer_message: 'Why has my October interest not credited to my HDFC account yet? Payout date was yesterday.',
      agent_reply_text: 'Dear Suresh,\n\nThank you for reaching out to Wint Wealth.\n\nThe monthly interest payout for your Navi Finserv Senior Secured Bond was processed by the Issuer on Oct 5. Due to the second Saturday banking holiday, NEFT clearing will reflect in your HDFC account by Monday 12:00 PM.\n\nWe are actively monitoring the batch status and will notify you as soon as the credit confirmation is received.\n\nWarm regards,\nVedant G\nSenior Investor Relations',
      evaluation_status: 'Completed',
      quality_score: 95.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'yes', clarity: 'yes', tone: 'yes', process_adherence: 'yes', expectation_setting: 'yes' },
      qa_override_score: null,
      qa_notes: 'Excellent proactive explanation of clearing holiday delay with clear timeline.',
      dispute_status: 'None',
      evaluated_at: daysAgo(2),
    },

    // Entry 7: Multi-agent ticket: Reply 2 by Agent B on same ticket (Gets 65% - Page 1 & 6)
    {
      ticket_id: 'ticket_em_1005_A',
      message_id: 'msg_sample_07_agent_b',
      agent_id: 'agent_bhavika',
      agent_name: 'Bhavika',
      sent_at: daysAgo(2),
      customer_message: 'Still not received, it is Monday 1 PM now.',
      agent_reply_text: 'Hi Suresh,\nBank is taking time to process batch. Please wait until end of day.\nRegards,\nBhavika',
      evaluation_status: 'Completed',
      quality_score: 65.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'partial', completeness: 'partial', clarity: 'partial', tone: 'partial', process_adherence: 'partial', expectation_setting: 'no' },
      qa_override_score: null,
      qa_notes: 'Handled on same ticket but evaluated individually for Bhavika. Reply missed reference to clearing corporation UTR or escalation path.',
      dispute_status: 'None',
      evaluated_at: daysAgo(1),
    },

    // Entry 8: Merged Ticket Evaluation (evaluated prior to merge, stays with agent - Page 3)
    {
      ticket_id: 'ticket_em_1005_B',
      message_id: 'msg_sample_08_merged',
      agent_id: 'agent_vedant',
      agent_name: 'Vedant G',
      sent_at: daysAgo(3),
      customer_message: 'Sending another email since no reply on ticket yet regarding payout.',
      agent_reply_text: 'Dear Suresh,\nWe have received your query. To ensure you receive seamless updates, we are linking this conversation to your primary inquiry ticket #ticket_em_1005_A. You will receive all updates on the main thread.\nWarm regards,\nVedant G',
      evaluation_status: 'Completed',
      quality_score: 90.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'yes', clarity: 'yes', tone: 'yes', process_adherence: 'yes', expectation_setting: 'yes' },
      qa_override_score: null,
      qa_notes: 'Correct merging protocol followed. Evaluation preserved under Vedant G despite ticket being merged.',
      dispute_status: 'None',
      evaluated_at: daysAgo(2),
    },

    // Entry 9: Active Agent Dispute Raised (Page 7 of doc)
    {
      ticket_id: 'ticket_em_1004',
      message_id: 'msg_sample_09_dispute',
      agent_id: 'agent_kriti',
      agent_name: 'Kriti',
      sent_at: daysAgo(1),
      customer_message: 'What is the credit rating of Spandana Sphoorty NCDs?',
      agent_reply_text: 'Dear Vikram,\n\nThe NCD issue is rated CRISIL A / Stable. This rating indicates adequate degree of safety regarding timely servicing of financial obligations.\n\nYou can review the complete rating rationales on the prospectus tab.\n\nRegards,\nKriti',
      evaluation_status: 'Completed',
      quality_score: 72.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'partial', clarity: 'partial', tone: 'partial', process_adherence: 'partial', expectation_setting: 'partial' },
      qa_override_score: null,
      qa_notes: 'Scored 72% for lack of expanded definition of rating watch.',
      dispute_status: 'Raised',
      dispute_notes: 'Agent Dispute: Rating and definition provided strictly as per official CRISIL rating sheet. Request QA Lead to re-evaluate score.',
      evaluated_at: hoursAgo(14),
    },

    // Entry 10: Pending Reply (Ready for 3 PM / Overnight Batch Processing - Page 1 & 8)
    {
      ticket_id: 'ticket_em_1003',
      message_id: 'msg_sample_10_pending',
      agent_id: 'agent_priya',
      agent_name: 'Priya Singh',
      sent_at: hoursAgo(2),
      customer_message: 'Can I get TDS certificate emailed directly to my CA?',
      agent_reply_text: 'Dear Ananya,\n\nCertainly! You can either download the Form 16A PDF from your dashboard and forward it, or provide your CA email address here and our team will securely send an encrypted copy after verification.\n\nWarm regards,\nPriya Singh\nWint Wealth IR',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 11: Pending Reply
    {
      ticket_id: 'ticket_em_1006',
      message_id: 'msg_sample_11_pending',
      agent_id: 'agent_bhavika',
      agent_name: 'Bhavika',
      sent_at: hoursAgo(5),
      customer_message: 'I want to change my bank mandate for monthly SIP from HDFC to Axis Bank account. How can I do this?',
      agent_reply_text: 'Dear Karan,\n\nTo update your bank mandate for SIP investments:\n1. Log into your Wint Wealth portal and go to "Bank & Mandates".\n2. Click "Add New Mandate" and choose Axis Bank.\n3. Complete the e-mandate authentication via NetBanking or Debit Card.\n\nOnce approved by NPCI (takes 24-48 business hours), you can switch your active SIPs to this mandate.\n\nRegards,\nBhavika',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 12: Pending Reply
    {
      ticket_id: 'ticket_em_1007',
      message_id: 'msg_sample_12_pending',
      agent_id: 'agent_aman',
      agent_name: 'Aman Sharma',
      sent_at: hoursAgo(7),
      customer_message: 'I submitted the physical nominee modification form last week. Can you confirm if CDSL has updated it?',
      agent_reply_text: 'Dear Sunita,\n\nWe have received your physical nominee addition form. Our operations team processed the submission with CDSL yesterday.\n\nYou should receive an email confirmation directly from CDSL within 2 business days. You can also view the updated nominee details under your Demat Profile on Wint Wealth.\n\nWarm regards,\nAman Sharma',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 13: Pending Reply
    {
      ticket_id: 'ticket_em_1008',
      message_id: 'msg_sample_13_pending',
      agent_id: 'agent_vedant',
      agent_name: 'Vedant G',
      sent_at: hoursAgo(9),
      customer_message: 'Can you explain how the XIRR is calculated for the quarterly payout bond?',
      agent_reply_text: 'Dear Rohit,\n\nThank you for reaching out.\n\nThe XIRR on quarterly payout bonds accounts for all cash inflows (quarterly coupon payouts) and the return of principal at maturity against your initial investment date.\n\nI have attached an illustrative cash flow schedule spreadsheet for your bond lot showing exact payment dates and the annualized return computation.\n\nBest regards,\nVedant G',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 14: Pending Reply
    {
      ticket_id: 'ticket_em_1009',
      message_id: 'msg_sample_14_pending',
      agent_id: 'agent_kriti',
      agent_name: 'Kriti',
      sent_at: hoursAgo(4),
      customer_message: 'Why was my cancelled cheque rejected for bank change? It has my name printed on it.',
      agent_reply_text: 'Dear Meera,\n\nApologies for the inconvenience. The cheque copy uploaded was slightly blurred near the IFSC code and MICR band, which caused an automated clearing mismatch during KYC validation.\n\nKindly re-upload a clear, well-lit photograph of the cancelled cheque or a recent 1-month bank statement displaying your name, account number, and IFSC code clearly.\n\nWarm regards,\nKriti',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 15: Pending Reply
    {
      ticket_id: 'ticket_em_1010',
      message_id: 'msg_sample_15_pending',
      agent_id: 'agent_priya',
      agent_name: 'Priya Singh',
      sent_at: hoursAgo(3),
      customer_message: 'Please provide capital gains statement for FY 23-24 for my tax audit.',
      agent_reply_text: 'Dear Deepak,\n\nYour Capital Gains Statement for FY 2023-24 has been generated and is now available in your portal under Reports > Tax Statements.\n\nI have also forwarded a password-protected PDF copy directly to your registered email address for your convenience.\n\nWarm regards,\nPriya Singh\nWint Wealth Support',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 16: Completed Reply by Apoorv (High score 95%)
    {
      ticket_id: 'ticket_em_1011',
      message_id: 'msg_sample_16_apoorv',
      agent_id: 'agent_apoorv',
      agent_name: 'Apoorv',
      sent_at: hoursAgo(6),
      customer_message: 'How can I apply for premature redemption of my Sovereign Gold Bond 2019 Series III? Is the RBI window open?',
      agent_reply_text: 'Dear Arjun,\n\nThank you for reaching out to Wint Wealth.\n\nThe premature redemption window for Sovereign Gold Bond 2019-20 Series III is active from RBI between the 5th and 7th year from the issuance date on specific interest payment dates.\n\nSince your SGB interest coupon date is on Nov 15, the RBI redemption window opens 30 days prior. We will initiate the request directly with your Depository Participant (CDSL). Kindly verify that your registered bank account details are active in demat.\n\nFeel free to reply if you need any additional assistance.\n\nWarm regards,\nApoorv\nWint Wealth Support',
      evaluation_status: 'Completed',
      quality_score: 95.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'yes', clarity: 'yes', tone: 'yes', process_adherence: 'yes', expectation_setting: 'yes' },
      qa_override_score: null,
      qa_notes: 'Accurate RBI guideline explanation and clear action items provided.',
      dispute_status: 'None',
      evaluated_at: hoursAgo(4),
    },

    // Entry 17: Completed Reply by Apoorv (Score 80%, partial on expectation setting and completeness)
    {
      ticket_id: 'ticket_em_1012',
      message_id: 'msg_sample_17_apoorv',
      agent_id: 'agent_apoorv',
      agent_name: 'Apoorv',
      sent_at: hoursAgo(8),
      customer_message: 'I already submitted Form 15G last month, but 10% TDS was still deducted on my Piramal Enterprises bond interest payout. Why?',
      agent_reply_text: 'Dear Radhika,\n\nWe have checked your record. The Form 15G you submitted was received on Sept 28, whereas the Issuer cutoff for TDS exemption was Sept 20.\n\nAs a result, TDS was deducted by the Issuer for this quarter. You can claim this TDS refund while filing your ITR as it will reflect in your Form 26AS.\n\nRegards,\nApoorv',
      evaluation_status: 'Completed',
      quality_score: 80.0,
      compliance_passed: true,
      compliance_issues: [],
      parameter_scores: { accuracy: 'yes', completeness: 'partial', clarity: 'yes', tone: 'yes', process_adherence: 'yes', expectation_setting: 'partial' },
      qa_override_score: null,
      qa_notes: 'Reason for deduction correctly explained. Could have proactively mentioned when Form 15G will apply for the subsequent quarter.',
      dispute_status: 'None',
      evaluated_at: hoursAgo(5),
    },

    // Entry 18: Pending Reply by Apoorv
    {
      ticket_id: 'ticket_em_1013',
      message_id: 'msg_sample_18_apoorv',
      agent_id: 'agent_apoorv',
      agent_name: 'Apoorv',
      sent_at: hoursAgo(2),
      customer_message: 'I want to transfer my bonds to Zerodha and close this demat account. What is the process and charges?',
      agent_reply_text: 'Dear Manish,\n\nTo transfer your bond holdings to another demat account:\n1. You will need to submit a DIS (Delivery Instruction Slip) or execute an off-market transfer via CDSL Easiest.\n2. Please provide the target client master report (CMR) from Zerodha with official seal.\n\nUnder SEBI guidelines, transfer-cum-closure carries zero transfer charges provided the account is closed simultaneously.\n\nOur operations representative will guide you through the document verification step.\n\nBest regards,\nApoorv\nWint Wealth Team',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },

    // Entry 19: Pending Reply by Apoorv
    {
      ticket_id: 'ticket_em_1014',
      message_id: 'msg_sample_19_apoorv',
      agent_id: 'agent_apoorv',
      agent_name: 'Apoorv',
      sent_at: hoursAgo(1),
      customer_message: 'I placed a sell order on secondary market 2 hours back but order status still shows in-progress. Has it executed?',
      agent_reply_text: 'Dear Neha,\n\nSecondary market bond transactions on the RFQ (Request for Quote) platform execute between 9:00 AM and 5:00 PM on market working days.\n\nYour limit order of 5 units at ₹1,002.50 is currently open on the order book awaiting counterparty settlement. Once matched by the clearing corporation, your trade confirmation will be sent via SMS and email.\n\nWarm regards,\nApoorv',
      evaluation_status: 'Pending',
      quality_score: null,
      compliance_passed: null,
      compliance_issues: [],
      parameter_scores: null,
      qa_override_score: null,
      qa_notes: null,
      dispute_status: 'None',
      evaluated_at: null,
    },
  ];

  for (const e of entries) {
    await query(
      `INSERT INTO email_reply_evaluations
       (ticket_id, message_id, agent_id, agent_name, sent_at, customer_message, agent_reply_text,
        evaluation_status, quality_score, compliance_passed, compliance_issues, parameter_scores,
        qa_override_score, qa_notes, dispute_status, dispute_notes, evaluated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (message_id) DO UPDATE SET
         quality_score = EXCLUDED.quality_score,
         compliance_passed = EXCLUDED.compliance_passed,
         compliance_issues = EXCLUDED.compliance_issues,
         parameter_scores = EXCLUDED.parameter_scores,
         qa_override_score = EXCLUDED.qa_override_score,
         qa_notes = EXCLUDED.qa_notes,
         dispute_status = EXCLUDED.dispute_status,
         dispute_notes = EXCLUDED.dispute_notes,
         evaluation_status = EXCLUDED.evaluation_status,
         evaluated_at = EXCLUDED.evaluated_at,
         updated_at = NOW()`,
      [
        e.ticket_id,
        e.message_id,
        e.agent_id,
        e.agent_name,
        e.sent_at,
        e.customer_message,
        e.agent_reply_text,
        e.evaluation_status,
        e.quality_score,
        e.compliance_passed,
        e.compliance_issues,
        e.parameter_scores ? JSON.stringify(e.parameter_scores) : null,
        e.qa_override_score,
        e.qa_notes,
        e.dispute_status,
        (e as any).dispute_notes || null,
        e.evaluated_at,
      ]
    );
  }

  console.log(`✓ Successfully seeded ${entries.length} realistic sample entries into database!`);
}

seedData().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
