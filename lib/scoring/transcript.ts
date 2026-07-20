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
  is_private?: boolean;
  is_internal?: boolean;
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

const BOT_NAMES = new Set(['myra', 'bot', 'wint bot', 'wintbot', 'robylon ai']);

export function normalizeRobylonMessages(messages: any[], year?: number): {
  transcriptText: string;
  timedMessages: Array<{ sender: string; content: string; timestamp?: string }>;
  transcriptForStorage: any[];
} {
  const lines: string[] = [];
  const timedMessages: Array<{ sender: string; content: string; timestamp?: string }> = [];
  const transcriptForStorage: any[] = [];

  if (!Array.isArray(messages)) {
    return { transcriptText: '', timedMessages: [], transcriptForStorage: [] };
  }

  for (const m of messages) {
    const sender = (m.sender || m.role || m.sender_name || '').trim();
    const content = (m.content || m.text || '').trim();
    if (!content) continue;

    // Determine timestamp
    let isoTs: string | undefined;
    if (m.timestamp) {
      if (year !== undefined) {
        isoTs = parseRobyTimestamp(m.timestamp, year) || m.timestamp;
      } else {
        isoTs = m.timestamp;
      }
    }

    const isInternalNote =
      m.is_private === true ||
      m.is_internal === true ||
      (sender || '').toLowerCase().includes('robylon') ||
      (m.sender_name || '').toLowerCase().includes('robylon') ||
      (m.agent_name || '').toLowerCase().includes('robylon');

    if (isInternalNote) {
      lines.push(`Internal Note: ${content}`);
      transcriptForStorage.push({
        sender_type: 'agent',
        sender_name: 'Robylon AI',
        content,
        timestamp: isoTs,
        is_internal: true,
      });
      continue;
    }

    const low = content.toLowerCase();
    const isSystemActivity =
      m.sender_type === 'activity' ||
      low.includes('auto-assigned') ||
      low.includes('assigned by') ||
      low.includes('waiting to assign');

    if (isSystemActivity) {
      transcriptForStorage.push({
        sender_type: 'activity',
        sender_name: 'system',
        content,
        timestamp: isoTs,
      });
      continue;
    }

    if (low.includes('please rate your experience') || m.buttons) {
      continue;
    }

    if (m.sender_name === 'Robylon AI' && m.sender_type === 'agent') {
      continue;
    }

    const senderLow = sender.toLowerCase();
    const isCustomer = senderLow === 'user' || senderLow === 'customer' || m.sender_type === 'customer';
    const isBot = BOT_NAMES.has(senderLow) || m.sender_type === 'bot';

    const role = isCustomer ? 'Customer' : isBot ? 'Bot' : 'Agent';
    const senderType = isCustomer ? 'customer' : isBot ? 'bot' : 'agent';

    lines.push(`${role}: ${content}`);
    timedMessages.push({ sender: sender || role, content, timestamp: isoTs });
    transcriptForStorage.push({
      sender_type: senderType,
      sender_name: sender || role,
      content,
      timestamp: isoTs,
    });
  }

  return {
    transcriptText: lines.join('\n'),
    timedMessages,
    transcriptForStorage,
  };
}

export function messagesToTranscript(messages: RobyMessage[]): string {
  return normalizeRobylonMessages(messages).transcriptText;
}

export function transcriptFromJsonb(messages: any[]): string {
  return normalizeRobylonMessages(messages).transcriptText;
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
