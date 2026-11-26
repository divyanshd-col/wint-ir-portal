'use client';

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import MyQualityChatsPage from '@/components/ir/MyQualityChatsPage';
import MyQualityCallsPage from '@/components/ir/MyQualityCallsPage';
import MyQualityEmailsPage from '@/components/ir/MyQualityEmailsPage';
import AgentReportsClient from '@/components/ir/AgentReportsClient';
import AgentAnalyticsDashboard from '@/components/quality/AgentAnalyticsDashboard';

// ── Icons ─────────────────────────────────────────────────────────────────────

const StarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const TrophyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
    <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);

const DisputeIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);


interface Props {
  agentName?: string;
  agentEmail?: string;
  initialSection?: 'quality' | 'performance' | 'disputes';
}

export default function SimplifiedAgentDashboard({
  agentName = 'Dhanush',
  agentEmail = 'dhanush@wintwealth.com',
  initialSection = 'quality',
}: Props) {
  const searchParams = useSearchParams();
  const querySection = searchParams.get('section') as ('quality' | 'performance' | 'disputes') | null;
  const queryChannel = searchParams.get('channel') as ('chats' | 'calls' | 'emails') | null;
  const querySub = searchParams.get('sub') as string | null;

  // Active section: 'quality' | 'performance' | 'disputes'
  const [section, setSection] = useState<'quality' | 'performance' | 'disputes'>(
    querySection && ['quality', 'performance', 'disputes'].includes(querySection)
      ? querySection
      : initialSection
  );

  // Sub-toggles per section
  const [qualityChannel, setQualityChannel] = useState<'chats' | 'calls' | 'emails'>(
    queryChannel && ['chats', 'calls', 'emails'].includes(queryChannel) ? queryChannel : 'chats'
  );

  const [perfSubTab, setPerfSubTab] = useState<'scorecard' | 'analytics'>(
    querySub === 'analytics' ? 'analytics' : 'scorecard'
  );

  const [disputeChannel, setDisputeChannel] = useState<'chats' | 'calls' | 'emails'>(
    queryChannel && ['chats', 'calls', 'emails'].includes(queryChannel) ? queryChannel : 'chats'
  );

  // Sidebar collapse state
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wint_sidebar');
      if (saved) setCollapsed(saved === 'collapsed');
    } catch {
      // ignore
    }
  }, []);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('wint_sidebar', next ? 'collapsed' : 'expanded');
      } catch {
        // ignore
      }
      return next;
    });
  };

  return (
    <div className="quality-shell-container">
      <div className="quality-shell-body">
        {/* Side Panel */}
        <aside className={`quality-shell-sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="quality-shell-sidebar-head">
            {!collapsed && (
              <div className="quality-shell-sidebar-title">
                IR Agent
              </div>
            )}
            <button
              type="button"
              className="quality-shell-sidebar-toggle"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="11 17 6 12 11 7" />
                <polyline points="18 17 13 12 18 7" />
              </svg>
            </button>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setSection('performance')}
              className={`quality-shell-sidebar-link w-[calc(100%-24px)] text-left cursor-pointer ${section === 'performance' ? 'active' : ''
                }`}
            >
              <span>
                <TrophyIcon />
              </span>
              <span className="quality-shell-sidebar-label">My Performance</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('quality')}
              className={`quality-shell-sidebar-link w-[calc(100%-24px)] text-left cursor-pointer ${section === 'quality' ? 'active' : ''
                }`}
            >
              <span>
                <StarIcon />
              </span>
              <span className="quality-shell-sidebar-label">Quality</span>
            </button>

            <button
              type="button"
              onClick={() => setSection('disputes')}
              className={`quality-shell-sidebar-link w-[calc(100%-24px)] text-left cursor-pointer ${section === 'disputes' ? 'active' : ''
                }`}
            >
              <span>
                <DisputeIcon />
              </span>
              <span className="quality-shell-sidebar-label">Disputes</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="quality-shell-main" style={{ padding: 0 }}>
          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 1: QUALITY (Chats, Calls, Emails)
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'quality' && (
            <div className="flex flex-col min-h-full">
              {/* Channel Toggle Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Channel:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setQualityChannel('chats')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${qualityChannel === 'chats'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Chats
                    </button>
                    <button
                      type="button"
                      onClick={() => setQualityChannel('calls')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${qualityChannel === 'calls'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Calls
                    </button>
                    <button
                      type="button"
                      onClick={() => setQualityChannel('emails')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${qualityChannel === 'emails'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Emails
                    </button>
                  </div>
                </div>

                <div className="text-xs text-gray-400 font-medium">
                  Quality Evaluation &bull; {agentName}
                </div>
              </div>

              {/* Render Selected Channel Evaluation Panel */}
              <div className="p-6">
                {qualityChannel === 'chats' && (
                  <MyQualityChatsPage agentName={agentName} initialTab="evaluated" mode="evaluated-only" />
                )}
                {qualityChannel === 'calls' && (
                  <MyQualityCallsPage agentName={agentName} initialTab="evaluated" mode="evaluated-only" />
                )}
                {qualityChannel === 'emails' && (
                  <MyQualityEmailsPage agentName={agentName} initialTab="evaluated" mode="evaluated-only" />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 2: MY PERFORMANCE (Scorecard, Analytics)
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'performance' && (
            <div className="flex flex-col min-h-full">
              {/* Sub-toggle Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">View:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setPerfSubTab('scorecard')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${perfSubTab === 'scorecard'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Scorecard
                    </button>
                    <button
                      type="button"
                      onClick={() => setPerfSubTab('analytics')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${perfSubTab === 'analytics'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Analytics
                    </button>
                  </div>
                </div>

                <div className="text-xs text-gray-400 font-medium">
                  Performance &bull; {agentName}
                </div>
              </div>

              {/* Render Scorecard or Analytics */}
              <div className="p-6">
                {perfSubTab === 'scorecard' && (
                  <AgentReportsClient agentName={agentName} role="agent" />
                )}
                {perfSubTab === 'analytics' && (
                  <AgentAnalyticsDashboard userEmail={agentEmail} selfAgentName={agentName} />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 3: DISPUTES (Chats, Calls, Emails)
             ══════════════════════════════════════════════════════════════════════ */}
          {section === 'disputes' && (
            <div className="flex flex-col min-h-full">
              {/* Channel Toggle Header */}
              <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-xs border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Disputes Channel:</span>
                  <div className="inline-flex p-1 bg-gray-100/90 rounded-xl text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setDisputeChannel('chats')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${disputeChannel === 'chats'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Chats
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputeChannel('calls')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${disputeChannel === 'calls'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Calls
                    </button>
                    <button
                      type="button"
                      onClick={() => setDisputeChannel('emails')}
                      className={`px-4 py-1.5 rounded-lg transition cursor-pointer ${disputeChannel === 'emails'
                          ? 'bg-white text-gray-900 shadow-xs font-bold'
                          : 'text-gray-500 hover:text-gray-900'
                        }`}
                    >
                      Emails
                    </button>
                  </div>
                </div>

                <div className="text-xs text-gray-400 font-medium">
                  Dispute Status & Tracking &bull; {agentName}
                </div>
              </div>

              {/* Render Channel's Disputes View */}
              <div className="p-6">
                {disputeChannel === 'chats' && (
                  <MyQualityChatsPage agentName={agentName} initialTab="disputes" mode="disputes-only" />
                )}
                {disputeChannel === 'calls' && (
                  <MyQualityCallsPage agentName={agentName} initialTab="disputes" mode="disputes-only" />
                )}
                {disputeChannel === 'emails' && (
                  <MyQualityEmailsPage agentName={agentName} initialTab="disputes" mode="disputes-only" />
                )}
              </div>
            </div>
          )}


        </main>
      </div>
    </div>
  );
}
