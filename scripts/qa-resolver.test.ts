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

test('Tier 3: Unassigned disposition - falls back to Manorathi when no QA is assigned to disposition', async () => {
  const mockQuery: any = async (sql: string) => {
    if (sql.includes('COALESCE')) {
      return [{ reviewed_by: null, agent_id: 23, disposition: 'UnmappedDisposition' }];
    }
    return [];
  };

  const mockReadConfig: any = async () => ({
    users: [{ email: 'sindhu@wintwealth.com', agentName: 'Sindhu' }],
    qaDispositionMap: [{ email: 'sindhu@wintwealth.com', dispositions: ['KYC', 'SIP'] }],
  });

  const result = await resolveQANameForChat('105', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Manorathi');
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

test('Error Resilience - returns Manorathi fallback on database exception', async () => {
  const mockQuery: any = async () => {
    throw new Error('Database connection timeout');
  };

  const mockReadConfig: any = async () => ({ users: [] });

  const result = await resolveQANameForChat('108', { query: mockQuery, readConfig: mockReadConfig });
  assert.equal(result, 'Manorathi');
});

test('getAuthorizedDispositions - assigned QA sees only assigned dispositions', async () => {
  const { getAuthorizedDispositions } = await import('../lib/qa-disposition');
  const mockConfig: any = {
    qaDispositionMap: [
      { email: 'dipti@wintwealth.com', dispositions: ['Taxation', 'FD'] },
      { email: 'manorathi@wintwealth.com', dispositions: ['Liquidity', 'SGB'] },
    ],
    users: [],
  };

  const dbDispositions = ['Taxation', 'FD', 'Liquidity', 'SGB', 'AIF', 'NewDispo'];
  const diptiDisps = await getAuthorizedDispositions('dipti@wintwealth.com', 'quality', mockConfig, dbDispositions);
  assert.deepEqual(diptiDisps, ['Taxation', 'FD']);
});

test('getAuthorizedDispositions - Manorathi sees assigned + unassigned dispositions, never other assigned', async () => {
  const { getAuthorizedDispositions } = await import('../lib/qa-disposition');
  const mockConfig: any = {
    qaDispositionMap: [
      { email: 'dipti@wintwealth.com', dispositions: ['Taxation', 'FD'] },
      { email: 'manorathi@wintwealth.com', dispositions: ['Liquidity', 'SGB'] },
    ],
    users: [],
  };

  const dbDispositions = ['Taxation', 'FD', 'Liquidity', 'SGB', 'AIF', 'NewDispo'];
  const manorathiDisps = await getAuthorizedDispositions('manorathi@wintwealth.com', 'quality', mockConfig, dbDispositions);
  
  // Should have Liquidity, SGB, AIF, NewDispo — and NOT Taxation or FD
  assert.equal(manorathiDisps.includes('Taxation'), false);
  assert.equal(manorathiDisps.includes('FD'), false);
  assert.equal(manorathiDisps.includes('Liquidity'), true);
  assert.equal(manorathiDisps.includes('SGB'), true);
  assert.equal(manorathiDisps.includes('AIF'), true);
  assert.equal(manorathiDisps.includes('NewDispo'), true);
});
