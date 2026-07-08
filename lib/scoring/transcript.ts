export interface RobyMessage {
  sender?: string;
  content?: string;
  role?: string;
  text?: string;
  timestamp?: string;
  sender_name?: string;
  agent_name?: string;
  sender_type?: string;
  agent_type?: string;
  buttons?: any;
}

export function messagesToTranscript(messages: RobyMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const sender  = m.sender || m.role || '';
    const content = (m.content || m.text || '').trim();
    if (!content) continue;

    const isInternalNote =
      (sender === 'Robylon AI' || (m as any).sender_name === 'Robylon AI' || (m as any).agent_name === 'Robylon AI') &&
      (m.role === 'agent' || m.role === 'Agent' || (m as any).sender_type === 'agent' || (m as any).sender_type === 'Agent' || (m as any).agent_type === 'agent' || (m as any).agent_type === 'Agent');

    if (isInternalNote) {
      lines.push(`Internal Note: ${content}`);
      continue;
    }

    const low = content.toLowerCase();
    if (low.includes('auto-assigned') || low.includes('assigned by') ||
        low.includes('waiting to assign') || low.includes('please rate your experience') ||
        (m as any).buttons) continue;
    const role = sender === 'User' || sender === 'user' || sender === 'customer' ? 'Customer'
               : sender === 'Bot'  || sender === 'bot'                           ? 'Bot'
               : 'Agent';
    lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

export function transcriptFromJsonb(messages: any[]): string {
  if (!Array.isArray(messages)) return '';
  const lines: string[] = [];
  for (const m of messages) {
    const isInternalNote =
      m.is_private === true ||
      m.is_internal === true ||
      ((m.sender_name === 'Robylon AI' || m.agent_name === 'Robylon AI' || m.sender === 'Robylon AI') &&
       (m.sender_type === 'agent' || m.sender_type === 'Agent' || m.agent_type === 'agent' || m.agent_type === 'Agent' || m.role === 'agent' || m.role === 'Agent'));

    if (isInternalNote) {
      const content = (m.content || '').trim();
      if (content) lines.push(`Internal Note: ${content}`);
      continue;
    }

    if (m.sender_name === 'Robylon AI' && m.sender_type === 'agent') continue;
    if (m.sender_type === 'activity') continue;
    const role = m.sender_type === 'customer' ? 'Customer'
               : m.sender_type === 'bot'      ? 'Bot'
               : 'Agent';
    const content = (m.content || '').trim();
    if (content) lines.push(`${role}: ${content}`);
  }
  return lines.join('\n');
}

export function parseRobyTimestamp(ts: string, year: number, fallbackVal: string = ''): string {
  try {
    const match = (ts || '').match(/^(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(AM|PM)$/);
    if (!match) return fallbackVal;
    const [, mon, day, hr, min, ampm] = match;
    let hour = parseInt(hr, 10);
    if (ampm === 'PM' && hour !== 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;
    const months: Record<string, number> = {
      Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
      Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11,
    };
    const monthIdx = months[mon];
    if (monthIdx === undefined) return fallbackVal;
    const d = new Date(Date.UTC(year, monthIdx, parseInt(day, 10), hour, parseInt(min, 10)));
    d.setMinutes(d.getMinutes() - 330); // IST → UTC
    return d.toISOString();
  } catch { return fallbackVal; }
}

export function extractAgentName(messages: any[]): string {
  const nonAgents = new Set(['user', 'bot', 'myra', 'system', '']);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const sender  = (m.sender || m.role || '').trim();
    if (nonAgents.has(sender.toLowerCase())) continue;
    const content = (m.content || m.text || '').toLowerCase();
    if (content.includes('auto-assigned') || content.includes('assigned by')) continue;
    return sender;
  }
  return '';
}

export function extractQueryFromTranscript(transcript: string): string {
  return transcript.split('\n')
    .filter(l => l.startsWith('Customer:'))
    .slice(0, 3)
    .map(l => l.replace('Customer:', '').trim())
    .join(' ');
}
