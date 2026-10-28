import { robylonTicketUrl } from '@/lib/email/ui';

/** Ticket ID as a "Show chat ↗"-style button that opens the ticket in Robylon. */
export default function TicketLinkButton({ id, label }: { id: string | number; label?: string }) {
  return (
    <a
      href={robylonTicketUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Open ticket ${id} in Robylon`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Helvetica Neue", Arial, sans-serif',
        fontSize: 13,
        fontWeight: 500,
        borderRadius: 6,
        border: '1px solid var(--qa-border)',
        background: 'var(--qa-card)',
        color: '#2563eb',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label ?? id} ↗
    </a>
  );
}
