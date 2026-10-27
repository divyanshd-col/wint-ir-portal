'use client';
import AgentFilterSelect from './AgentFilterSelect';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatEvalTable from './ChatEvalTable';
import DisputesTable from './DisputesTable';
import ReviewedChatsTable from './ReviewedChatsTable';
import UnscoredChatsTable from './UnscoredChatsTable';

type Tab = 'pending' | 'disputes' | 'reviewed' | 'unscored';

interface Props {
  role?: string;
}

export default function ChatEvaluationPage({ role }: Props) {
  const searchParams = useSearchParams();
  const targetChatId = searchParams.get('chatId') || searchParams.get('chat_id') || '';
  const initialTabParam = searchParams.get('tab') as Tab | null;

  const isAdmin = role === 'admin';
  const [dispositions,   setDispositions]   = useState<string[]>([]);
  const [pendingCount,   setPendingCount]   = useState<number | null>(null);
  const [disputeCount,   setDisputeCount]   = useState<number | null>(null);
  const [unscoredCount,  setUnscoredCount]  = useState<number | null>(null);
  const [loadingDisp,    setLoadingDisp]    = useState(true);
  const [tab,            setTab]            = useState<Tab>(
    initialTabParam && ['pending', 'disputes', 'reviewed', 'unscored'].includes(initialTabParam)
      ? initialTabParam
      : 'pending'
  );
  const [agentFilter,    setAgentFilter]    = useState<'bot_only' | 'all' | 'human_only' | 'has_calls'>('human_only');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cx/qa/disposition-config');
        if (!res.ok) return;
        const data = await res.json();
        const assigned: string[] = data.dispositions ?? [];
        setDispositions(assigned.length ? assigned : (data.availableDispositions ?? []));
      } finally {
        setLoadingDisp(false);
      }
    })();
  }, []);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: 40, padding: '0 14px', border: 'none', borderRadius: 0, marginBottom: -1,
    background: 'transparent',
    color: active ? 'var(--qa-text)' : 'var(--qa-text-2)',
    borderBottom: `2px solid ${active ? 'var(--qa-text)' : 'transparent'}`, whiteSpace: 'nowrap', flexShrink: 0,
    fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 500,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  });

  function CountBadge({ count, active }: { count: number; active: boolean }) {
    return (
      <span style={{
        fontSize: 11, padding: '1px 6px', borderRadius: 10, fontWeight: 600, lineHeight: '18px',
        background: active ? 'var(--ink)' : 'var(--qa-fill-light)',
        color: active ? 'var(--ink-fg)' : 'var(--qa-text-2)',
      }}>
        {count}
      </span>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, color: 'var(--qa-text)' }}>
          Chat Evaluation
        </h1>
      </div>

      {/* Tab bar & Toggle Row */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 16
      }}>
        <div style={{
          display: 'flex', gap: 4,
          borderBottom: '1px solid var(--qa-border)', flex: 1, minWidth: 0, overflowX: 'auto',
        }}>
          <button style={tabStyle(tab === 'pending')} onClick={() => setTab('pending')}>
            Pending Review
            {pendingCount !== null && <CountBadge count={pendingCount} active={tab === 'pending'} />}
          </button>
          <button style={tabStyle(tab === 'disputes')} onClick={() => setTab('disputes')}>
            Disputes
            {disputeCount !== null && disputeCount > 0 && <CountBadge count={disputeCount} active={tab === 'disputes'} />}
          </button>
          <button style={tabStyle(tab === 'reviewed')} onClick={() => setTab('reviewed')}>Reviewed Chats</button>
          {isAdmin && (
            <button style={tabStyle(tab === 'unscored')} onClick={() => setTab('unscored')}>
              Unscored Chats
              {unscoredCount !== null && unscoredCount > 0 && <CountBadge count={unscoredCount} active={tab === 'unscored'} />}
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ display: tab === 'pending' ? 'block' : 'none' }}>
        <ChatEvalTable
          dispositions={loadingDisp ? [] : dispositions}
          onCountChange={setPendingCount}
          agentFilter={agentFilter}
          leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }, { value: 'bot_only', label: 'Bot Only' }, { value: 'has_calls', label: 'Has Calls' }]} />}
          initialChatId={targetChatId}
          onChatNotFound={() => setTab('reviewed')}
        />
      </div>

      <div style={{ display: tab === 'disputes' ? 'block' : 'none' }}>
        <DisputesTable
          type="chats"
          onCountChange={setDisputeCount}
          agentFilter={agentFilter}
          leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }, { value: 'bot_only', label: 'Bot Only' }, { value: 'has_calls', label: 'Has Calls' }]} />}
        />
      </div>

      <div style={{ display: tab === 'reviewed' ? 'block' : 'none' }}>
        <ReviewedChatsTable
          dispositions={loadingDisp ? [] : dispositions}
          agentFilter={agentFilter}
          leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }, { value: 'bot_only', label: 'Bot Only' }, { value: 'has_calls', label: 'Has Calls' }]} />}
          initialChatId={targetChatId}
        />
      </div>

      {isAdmin && (
        <div style={{ display: tab === 'unscored' ? 'block' : 'none' }}>
          <UnscoredChatsTable
            agentFilter={agentFilter}
            leadingFilter={<AgentFilterSelect value={agentFilter} onChange={v => setAgentFilter(v as typeof agentFilter)} options={[{ value: 'all', label: 'All' }, { value: 'human_only', label: 'Human Only' }, { value: 'bot_only', label: 'Bot Only' }, { value: 'has_calls', label: 'Has Calls' }]} />}
            onCountChange={setUnscoredCount}
          />
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--qa-text-3)', fontStyle: 'italic', marginTop: 16 }}>
        Data from live DB · scoped to your assigned dispositions
      </p>
    </div>
  );
}
