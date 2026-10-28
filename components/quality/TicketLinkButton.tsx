import { robylonTicketUrl } from '@/lib/email/ui';

/** Chat / ticket ID as a chip that opens it in Robylon (new tab). The one ID link used by every evaluation view. */
export default function TicketLinkButton({ id, label }: { id: string | number; label?: string | number }) {
  return (
    <a
      className="id-link"
      href={robylonTicketUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Open ${id} in Robylon`}
    >
      {label ?? id}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
