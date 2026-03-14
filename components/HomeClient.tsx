'use client';

import { useState } from 'react';
import Sidebar from './Sidebar';
import ChatInterface from './ChatInterface';
import type { SavedConversation } from '@/lib/types';

interface HomeClientProps {
  username: string;
  isAdmin: boolean;
  historyEnabled: boolean;
}

export default function HomeClient({ username, isAdmin, historyEnabled }: HomeClientProps) {
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
        historyEnabled={historyEnabled}
        onRestoreConversation={handleRestore}
        onNewChat={handleNewChat}
      />
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-[#1a1a1a] font-semibold text-base">IR Knowledge Base</h1>
            <p className="text-gray-400 text-xs mt-0.5">Powered by AI · Wint Wealth</p>
          </div>
          <div className="flex items-center gap-2 bg-[#2d9e4f]/10 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 bg-[#2d9e4f] rounded-full animate-pulse" />
            <span className="text-[#2d9e4f] text-xs font-medium">Knowledge base connected</span>
          </div>
        </header>
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
