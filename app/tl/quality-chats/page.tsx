export default function QualityChatsPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 12, color: 'var(--qa-text-3)' }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--qa-text-2)', margin: 0 }}>Quality Chats</p>
      <p style={{ fontSize: 13, margin: 0 }}>Coming soon</p>
    </div>
  );
}
