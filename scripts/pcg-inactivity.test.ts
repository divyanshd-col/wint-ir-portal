import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isConversationInactive,
  PCG_INACTIVITY_HOURS,
  PCG_INACTIVITY_MS,
} from '../lib/pcg/doubletick';

test('PCG Inactivity constants', () => {
  assert.equal(PCG_INACTIVITY_HOURS, 48);
  assert.equal(PCG_INACTIVITY_MS, 48 * 60 * 60 * 1000);
});

test('isConversationInactive - identifies active vs inactive correctly', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');

  // 1 hour ago -> Active
  const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString();
  assert.equal(isConversationInactive(oneHourAgo, now), false);

  // 24 hours ago -> Active
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(isConversationInactive(oneDayAgo, now), false);

  // 47 hours and 59 minutes ago -> Active
  const almostDue = new Date(now.getTime() - (48 * 60 - 1) * 60 * 1000).toISOString();
  assert.equal(isConversationInactive(almostDue, now), false);

  // Exactly 48 hours ago -> Inactive (closed)
  const exact48Hours = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  assert.equal(isConversationInactive(exact48Hours, now), true);

  // 72 hours ago -> Inactive (closed)
  const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
  assert.equal(isConversationInactive(threeDaysAgo, now), true);

  // Null or undefined
  assert.equal(isConversationInactive(null, now), false);
  assert.equal(isConversationInactive(undefined, now), false);
  assert.equal(isConversationInactive('invalid-date', now), false);
});

test('PCG Conversation closed_at computation', () => {
  const lastMessageAt = new Date('2026-10-01T10:00:00.000Z');
  const expectedClosedAt = new Date(lastMessageAt.getTime() + PCG_INACTIVITY_MS).toISOString();

  assert.equal(expectedClosedAt, '2026-10-03T10:00:00.000Z');
});

test('Cron authorization guard for /api/cron/pcg-close-inactive', async () => {
  const { GET } = await import('../app/api/cron/pcg-close-inactive/route');
  const { NextRequest } = await import('next/server');

  process.env.CRON_SECRET = 'test-secret-123';

  // Request without secret -> 401
  const reqUnauth = new NextRequest('http://localhost/api/cron/pcg-close-inactive');
  const resUnauth = await GET(reqUnauth);
  assert.equal(resUnauth.status, 401);

  // Request with invalid secret -> 401
  const reqWrong = new NextRequest('http://localhost/api/cron/pcg-close-inactive', {
    headers: { authorization: 'Bearer wrong-secret' },
  });
  const resWrong = await GET(reqWrong);
  assert.equal(resWrong.status, 401);
});

