'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface KBDraftRow {
  week_number: string;
  category: string;
  question: string;
  chat_ids: string[];
  agent_answer: string;
  suggested_kb_content: string;
  target_kb: string;
  tag: 'Educational' | 'Non-Educational';
  chat_type: 'Bot Handled' | 'Transferred to Agent';
  created_at: string;
}

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export default function KBGapsPage() {
  const [activeTab, setActiveTab] = useState<'Educational' | 'Non-Educational'>('Educational');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [chatTypeFilter, setChatTypeFilter] = useState<string>('all');
  const [rows, setRows] = useState<KBDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/kb-gaps?tag=${activeTab}&category=${categoryFilter}&chat_type=${chatTypeFilter}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
      }
    } catch (err) {
      console.error('Failed to load KB gaps:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, categoryFilter, chatTypeFilter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleRunAnalysis = async () => {
    setRunningAnalysis(true);
    setToastMessage('🤖 Running Gemini 3.5 end-to-end transcript analysis over past 14 days...');
    try {
      const res = await fetch('/api/admin/run-kb-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: 14, limitChats: 50 }),
      });
      const json = await res.json();
      if (json.success) {
        setToastMessage(`✅ Analysis started! Rows will populate in real-time.`);
        fetchRows();
      } else {
        setToastMessage(`❌ Analysis error: ${json.error || 'Failed to process'}`);
      }
    } catch (err: any) {
      setToastMessage(`❌ Error triggering analysis: ${err.message}`);
    } finally {
      setRunningAnalysis(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const educationalCount = rows.filter((r) => r.tag === 'Educational').length;
  const botHandledCount = rows.filter((r) => r.chat_type === 'Bot Handled').length;
  const transferredCount = rows.filter((r) => r.chat_type === 'Transferred to Agent').length;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--qa-gray-50)', color: 'var(--qa-text)', padding: '24px 32px' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              KB Gap Intelligence & Answer Drafting Bot
            </h1>
            <span style={{ background: 'var(--qa-fill-light)', color: 'var(--qa-text)', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12 }}>
              Gemini 3.5 End-to-End Analysis
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--qa-text-2)' }}>
            Automated pipeline reading full transcripts to detect KB gaps, extract agent answers, draft KB articles, and categorize chat handling types.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          
          {/* Chat Type Filter */}
          <select
            value={chatTypeFilter}
            onChange={(e) => setChatTypeFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--qa-border)',
              background: 'var(--qa-card)',
              fontSize: 13,
              color: 'var(--qa-gray-700)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            <option value="all">All Chat Types</option>
            <option value="Bot Handled">🤖 Bot Handled</option>
            <option value="Transferred to Agent">👨‍💼 Transferred to Agent</option>
          </select>

          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--qa-border)',
              background: 'var(--qa-card)',
              fontSize: 13,
              color: 'var(--qa-gray-700)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            <option value="all">All Categories</option>
            <option value="Taxation">Taxation</option>
            <option value="Liquidity">Liquidity</option>
            <option value="SIP">SIP</option>
            <option value="Asset">Asset</option>
            <option value="KYC">KYC</option>
            <option value="Interest Repayment">Interest Repayment</option>
          </select>

          {/* Instant Test Analysis Trigger */}
          <button
            onClick={handleRunAnalysis}
            disabled={runningAnalysis}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              borderRadius: 8,
              border: 'none',
              background: runningAnalysis ? 'var(--qa-text-3)' : 'var(--accent)',
              color: runningAnalysis ? 'var(--qa-card)' : 'var(--accent-on)',
              fontSize: 13,
              fontWeight: 600,
              cursor: runningAnalysis ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
              transition: 'all 0.15s ease',
            }}
          >
            {runningAnalysis ? (
              <>⏳ Processing Transcripts...</>
            ) : (
              <>⚡ Run Instant Test Analysis</>
            )}
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{ background: 'var(--ink)', color: 'var(--ink-fg)', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, marginBottom: 20 }}>
          {toastMessage}
        </div>
      )}

      {/* Summary Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qa-text-2)', textTransform: 'uppercase' }}>TOTAL DRAFTED SUGGESTIONS</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--qa-text)', marginTop: 4 }}>{rows.length}</div>
          <div style={{ fontSize: 12, color: 'var(--pass)', marginTop: 2 }}>Stored in table `kb_draft_suggestions`</div>
        </div>

        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qa-text-2)', textTransform: 'uppercase' }}>🤖 BOT HANDLED CHATS</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--qa-text)', marginTop: 4 }}>{botHandledCount}</div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginTop: 2 }}>Answered by Bot without agent transfer</div>
        </div>

        <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--qa-text-2)', textTransform: 'uppercase' }}>👨‍💼 TRANSFERRED TO AGENTS</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--qa-text-2)', marginTop: 4 }}>{transferredCount}</div>
          <div style={{ fontSize: 12, color: 'var(--qa-text-2)', marginTop: 2 }}>Escalated to human IR support agents</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--qa-border)', marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab('Educational')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'Educational' ? '2px solid var(--pass)' : '2px solid transparent',
            color: activeTab === 'Educational' ? 'var(--pass)' : 'var(--qa-text-2)',
          }}
        >
          🟢 Educational Drafts ({educationalCount})
        </button>

        <button
          onClick={() => setActiveTab('Non-Educational')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'Non-Educational' ? '2px solid #D97706' : '2px solid transparent',
            color: activeTab === 'Non-Educational' ? '#D97706' : 'var(--qa-text-2)',
          }}
        >
          🟠 Non-Educational ({rows.length - educationalCount})
        </button>
      </div>

      {/* Main Data Table */}
      <div style={{ background: 'var(--qa-card)', border: '1px solid var(--qa-border)', borderRadius: 12, padding: 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--qa-text-2)', fontSize: 14 }}>Loading database entries...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--qa-text-2)', fontSize: 14 }}>
            No draft suggestions found. Click <strong>⚡ Run Instant Test Analysis</strong> above to generate test entries!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--qa-gray-50)', borderBottom: '1px solid var(--qa-border)', textTransform: 'uppercase', fontSize: 11, color: 'var(--qa-text-2)', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Week & Category</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '13%' }}>Chat Type</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '20%' }}>Investor Question</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Chat IDs</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '22%' }}>Agent Answer (Transcript)</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '22%' }}>Suggested KB Content / Answer</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Target KB</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const itemKey = `${r.created_at || idx}_${r.question.slice(0, 10)}`;
                  const isBot = r.chat_type === 'Bot Handled';
                  return (
                    <tr key={itemKey} style={{ borderBottom: '1px solid var(--qa-fill-light)' }}>
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--qa-text)' }}>{r.category}</div>
                        <div style={{ fontSize: 11, color: 'var(--qa-text-2)', fontFamily: MONO, marginTop: 2 }}>{r.week_number}</div>
                      </td>

                      <td style={{ padding: '12px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            background: isBot ? 'var(--qa-fill-light)' : 'var(--sunk)',
                            color: isBot ? 'var(--qa-text)' : 'var(--qa-text-2)',
                            border: `1px solid ${isBot ? 'var(--line-strong)' : 'var(--line-strong)'}`,
                          }}
                        >
                          {isBot ? '🤖 Bot Handled' : '👨‍💼 Transferred'}
                        </span>
                      </td>

                      <td style={{ padding: '12px', fontWeight: 600, color: 'var(--qa-text)' }}>
                        {r.question}
                      </td>

                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.chat_ids?.map((cid) => (
                            <span key={cid} style={{ background: 'var(--qa-fill-light)', color: 'var(--qa-gray-700)', fontSize: 11, padding: '2px 6px', borderRadius: 4, fontFamily: MONO }}>
                              {cid}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td style={{ padding: '12px', color: 'var(--qa-text-2)', fontSize: 12, lineHeight: '1.4' }}>
                        {r.agent_answer}
                      </td>

                      <td style={{ padding: '12px', background: 'var(--pass-soft)', color: 'var(--pass)', fontSize: 12, lineHeight: '1.4', borderRadius: 6 }}>
                        {r.suggested_kb_content}
                      </td>

                      <td style={{ padding: '12px', fontSize: 11, color: 'var(--qa-text-2)', fontWeight: 500 }}>
                        <span style={{ background: 'var(--qa-fill-light)', padding: '3px 8px', borderRadius: 6 }}>
                          {r.target_kb}
                        </span>
                      </td>

                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button
                          onClick={() => copyToClipboard(r.suggested_kb_content, itemKey)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid var(--line-strong)',
                            background: copiedKey === itemKey ? 'var(--accent)' : 'var(--qa-card)',
                            color: copiedKey === itemKey ? 'var(--accent-on)' : 'var(--qa-gray-700)',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {copiedKey === itemKey ? 'Copied! ✅' : '📋 Copy'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
