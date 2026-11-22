import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDurationFromTranscript } from '../lib/call-quality';

// Robylon's CC_VOICE_CALL_COMPLETE sends a negative call_duration and null started_at, so call length comes from
// the last transcript segment's `ts`.
test('extractDurationFromTranscript reads the last segment ts (m:ss and h:mm:ss)', () => {
  assert.equal(extractDurationFromTranscript([{ ts: '0:00' }, { ts: '15:46' }]), 946);
  assert.equal(extractDurationFromTranscript([{ ts: '0:01' }, { ts: '1:02:03' }]), 3723);
});

test('extractDurationFromTranscript is null when there is no usable timestamp', () => {
  for (const bad of [null, undefined, [], [{ text: 'no ts' }], [{ ts: 'abc' }]]) {
    assert.equal(extractDurationFromTranscript(bad), null);
  }
});
