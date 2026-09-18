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
  created_at: string;
}

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export default function KBGapsPage() {
  const [activeTab, setActiveTab] = useState<'Educational' | 'Non-Educational'>('Educational');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [rows, setRows] = useState<KBDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAnalysis, setRunningAnalysis] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/kb-gaps?tag=${activeTab}&category=${categoryFilter}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
      }
    } catch (err) {
      console.error('Failed to load KB gaps:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, categoryFilter]);

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
  const nonEducationalCount = rows.filter((r) => r.tag === 'Non-Educational').length;

  return (
    <div style={{ minHeight: '100vh', background: '#F9FAFB', color: '#111827', padding: '24px 32px' }}>
      
      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              KB Gap Intelligence & Answer Drafting Bot
            </h1>
            <span style={{ background: '#EFF6FF', color: '#1D4ED8', fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 12 }}>
              Gemini 3.5 End-to-End Analysis
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: '#6B7280' }}>
            Automated pipeline reading full transcripts to detect KB gaps, extract agent answers, draft KB articles, and tag entries.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          
          {/* Category Filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #E5E7EB',
              background: '#FFFFFF',
              fontSize: 13,
              color: '#374151',
              cursor: 'pointer',
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
              background: runningAnalysis ? '#9CA3AF' : '#10B981',
              color: '#FFFFFF',
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
        <div style={{ background: '#111827', color: '#FFFFFF', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, marginBottom: 20 }}>
          {toastMessage}
        </div>
      )}

      {/* Summary Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>TOTAL DRAFTED SUGGESTIONS</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', marginTop: 4 }}>{rows.length}</div>
          <div style={{ fontSize: 12, color: '#059669', marginTop: 2 }}>Stored in table `kb_draft_suggestions`</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>🟢 EDUCATIONAL DRAFTS</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#059669', marginTop: 4 }}>{educationalCount}</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>Static rules & facts → Ready for KB</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>🟠 NON-EDUCATIONAL BACKLOG</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#D97706', marginTop: 4 }}>{nonEducationalCount}</div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>Account/data dependent → API integration</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid #E5E7EB', marginBottom: 20 }}>
        <button
          onClick={() => setActiveTab('Educational')}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'transparent',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'Educational' ? '2px solid #059669' : '2px solid transparent',
            color: activeTab === 'Educational' ? '#059669' : '#6B7280',
          }}
        >
          🟢 Educational Drafts (Ready for KB)
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
            color: activeTab === 'Non-Educational' ? '#D97706' : '#6B7280',
          }}
        >
          🟠 Non-Educational (API & System Integration Backlog)
        </button>
      </div>

      {/* Main Data Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 14 }}>Loading database entries...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6B7280', fontSize: 14 }}>
            No draft suggestions found. Click <strong>⚡ Run Instant Test Analysis</strong> above to generate test entries!
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', textTransform: 'uppercase', fontSize: 11, color: '#6B7280', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Week & Category</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '22%' }}>Investor Question</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Chat IDs</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '24%' }}>Agent Answer (Transcript)</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', width: '24%' }}>Suggested KB Content / Answer</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Target KB</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const itemKey = `${r.created_at || idx}_${r.question.slice(0, 10)}`;
                  return (
                    <tr key={itemKey} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '12px' }}>
                        <div style={{ fontWeight: 600, color: '#111827' }}>{r.category}</div>
                        <div style={{ fontSize: 11, color: '#6B7280', fontFamily: MONO, marginTop: 2 }}>{r.week_number}</div>
                      </td>

                      <td style={{ padding: '12px', fontWeight: 600, color: '#111827' }}>
                        {r.question}
                      </td>

                      <td style={{ padding: '12px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {r.chat_ids?.map((cid) => (
                            <span key={cid} style={{ background: '#F3F4F6', color: '#374151', fontSize: 11, padding: '2px 6px', borderRadius: 4, fontFamily: MONO }}>
                              {cid}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td style={{ padding: '12px', color: '#4B5563', fontSize: 12, lineHeight: '1.4' }}>
                        {r.agent_answer}
                      </td>

                      <td style={{ padding: '12px', background: '#F0FDF4', color: '#166534', fontSize: 12, lineHeight: '1.4', borderRadius: 6 }}>
                        {r.suggested_kb_content}
                      </td>

                      <td style={{ padding: '12px', fontSize: 11, color: '#6B7280', fontWeight: 500 }}>
                        <span style={{ background: '#F3F4F6', padding: '3px 8px', borderRadius: 6 }}>
                          {r.target_kb}
                        </span>
                      </td>

                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button
                          onClick={() => copyToClipboard(r.suggested_kb_content, itemKey)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: '1px solid #D1D5DB',
                            background: copiedKey === itemKey ? '#10B981' : '#FFFFFF',
                            color: copiedKey === itemKey ? '#FFFFFF' : '#374151',
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
