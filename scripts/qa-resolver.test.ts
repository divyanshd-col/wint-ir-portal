import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQANameForChat } from '../lib/qa-resolver';

test('resolveQANameForChat - empty/invalid chatId returns Manorathi fallback', async () => {
  const result = await resolveQANameForChat('');
  assert.equal(result, 'Manorathi');
});

test('Tier 1: Reviewed QA - resolves via config.users email match', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: 'yashvi@wintwealth.com', agent_id: 10, disposition: 'KYC' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({
    users: [{ email: 'yashvi@wintwealth.com', agentName: 'Yashvi Sharma' }],
  });

  const result = await resolveQANameForChat('101', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Yashvi Sharma');
});

test('Tier 1: Reviewed QA - resolves via cx_users DB lookup when not in config', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: 'nandani.s@wintwealth.com', agent_id: 10, disposition: 'KYC' }];
    }
    if (sql.includes('cx_users')) {
      return [{ name: 'Nandani S' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({ users: [] });

  const result = await resolveQANameForChat('102', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Nandani S');
});

test('Tier 1: Reviewed QA - formatting fallback for email not in DB or config', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: 'john.doe@wintwealth.com', agent_id: 10, disposition: 'KYC' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({ users: [] });

  const result = await resolveQANameForChat('103', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'John Doe');
});

test('Tier 1: Reviewed QA - returns plain name directly when not an email', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: 'Dipti', agent_id: 10, disposition: 'KYC' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({ users: [] });

  const result = await resolveQANameForChat('104', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Dipti');
});

test('Tier 2: Disposition Map - resolves via qaDispositionMap before checking assigned agent QA', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: null, agent_id: 23, disposition: 'KYC' }];
    }
    if (sql.includes('FROM agents')) {
      return [{ qa_name: 'Arjun' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({
    users: [{ email: 'sindhu@wintwealth.com', agentName: 'Sindhu' }],
    qaDispositionMap: [{ email: 'sindhu@wintwealth.com', dispositions: ['KYC', 'SIP'] }],
  });

  const result = await resolveQANameForChat('106', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Sindhu');
});

test('Tier 3: Assigned Agent QA - resolves from agents table when unreviewed & no disposition match', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: null, agent_id: 23, disposition: 'UnmappedDisposition' }];
    }
    if (sql.includes('FROM agents')) {
      return [{ qa_name: 'Arjun' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({ users: [] });

  const result = await resolveQANameForChat('105', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Arjun');
});

test('Tier 4: Fallback - returns Manorathi when no match found', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: null, agent_id: null, disposition: 'Unknown' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({ users: [], qaDispositionMap: [] });

  const result = await resolveQANameForChat('107', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Manorathi');
});

test('Call dispute with callId - resolves from call_recordings disposition over parent chat disposition', async () => {
  const mockQuery: any = async (sql: string, params?: any[]) => {
    if (sql.includes('FROM call_recordings') && params?.[0] === 'call_129923') {
      return [{ reviewed_by: null, agent_id: 18, disposition: 'Junk Chats' }];
    }
    if (sql.includes('FROM conversations') && params?.[0] === 'chat_129790') {
      return [{ reviewed_by: null, agent_id: 18, disposition: 'Bond Purchase' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({
    users: [
      { email: 'sindhu@wintwealth.com', agentName: 'Sindhu' },
      { email: 'manorathi@wintwealth.com', agentName: 'Manorathi' },
    ],
    qaDispositionMap: [
      { email: 'sindhu@wintwealth.com', dispositions: ['Bond Purchase'] },
      { email: 'manorathi@wintwealth.com', dispositions: ['Junk Chats'] },
    ],
  });

  const result = await resolveQANameForChat('chat_129790', { query: mockQuery, readConfig: mockReadConfig }, 'call_129923');
  assert.equal(result, 'Manorathi');
});

test('Call dispute with "Junk" disposition alias resolves to Manorathi', async () => {
  const mockQuery: any = async (sql: string, params?: any[]) => {
    if (sql.includes('FROM call_recordings') && params?.[0] === 'call_129924') {
      return [{ reviewed_by: null, agent_id: 18, disposition: 'Junk' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({
    users: [{ email: 'manorathi@wintwealth.com', agentName: 'Manorathi' }],
    qaDispositionMap: [{ email: 'manorathi@wintwealth.com', dispositions: ['Junk Chats'] }],
  });

  const result = await resolveQANameForChat('', { query: mockQuery, readConfig: mockReadConfig }, 'call_129924');
  assert.equal(result, 'Manorathi');
});
