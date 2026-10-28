'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatInterface from './ChatInterface';
import type { SavedConversation } from '@/lib/types';

interface HomeClientProps {
  username: string;
  isAdmin: boolean;
  role?: string;
  historyEnabled: boolean;
  flags?: { callAnalysis?: boolean; cxDashboard?: boolean };
}

export default function HomeClient({ username, isAdmin, role, historyEnabled, flags }: HomeClientProps) {
  // chatKey causes ChatInterface to fully remount (clean slate) on new chat or restore
  const [chatKey, setChatKey] = useState(0);
  const [pendingRestore, setPendingRestore] = useState<SavedConversation | null>(null);

  const handleRestore = (conv: SavedConversation) => {
    setPendingRestore(conv);
    setChatKey(k => k + 1);
  };

  const handleNewChat = () => {
    setPendingRestore(null);
    setChatKey(k => k + 1);
  };

  return (
    <>
      <Sidebar
        username={username}
        isAdmin={isAdmin}
        role={role}
        historyEnabled={historyEnabled}
        flags={flags}
        onRestoreConversation={handleRestore}
        onNewChat={handleNewChat}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            key={chatKey}
            username={username}
            historyEnabled={historyEnabled}
            initialConversation={pendingRestore}
          />
        </div>
      </main>
    </>
  );
}
