// Robylon records assignment / lifecycle events in the message stream. Some arrive with sender "activity", others with the
// agent's own name ("Claimed by Nirmiti"), which made them look like something the agent said. Treat them as events.
const EVENT_RE = /^(?:claimed by|assigned (?:by|to)|waiting to assign|re-?assigned|unassigned|transferred (?:to|by|from)|(?:chat|conversation|ticket) (?:was )?(?:closed|re-?opened|resolved|merged|snoozed)|snoozed|escalated to|marked (?:as )?\w+|tagged|merged into)\b.{0,100}$/i;

export const isActivityEvent = (sender: string | null | undefined, content: string | null | undefined): boolean => {
  const s = (sender || '').toLowerCase().trim();
  if (s === 'activity' || s === 'system') return true;
  const c = (content || '').trim();
  return c.length <= 120 && !c.includes('\n') && EVENT_RE.test(c);
};
