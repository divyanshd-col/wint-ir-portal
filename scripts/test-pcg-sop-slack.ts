import assert from 'node:assert';
import {
  maskCustomerPhone,
  formatCallDuration,
  buildPcgSopSlackMessage,
  resolvePcgRmSlackId,
  resolvePcgTlSlackId,
  formatRmSlackTag,
  formatTlSlackTag,
  detectPcgSopTriggers,
  PCG_MONITORING_CATEGORIES,
  PcgSopTrigger,
} from '../lib/pcg/sop-alert';

console.log('🧪 Running PCG SOP Slack Alert Integration Tests...\n');

// 1. Phone number masking test
console.log('Test 1: Phone number masking (+91 98•••• ••210 format)');
assert.strictEqual(maskCustomerPhone('+919812345210'), '+91 98•••• ••210');
assert.strictEqual(maskCustomerPhone('9812345210'), '+91 98•••• ••210');
assert.strictEqual(maskCustomerPhone('+91 9812345210'), '+91 98•••• ••210');
console.log('✓ Phone masking passed.\n');

// 2. Call duration format test
console.log('Test 2: Call duration format (04:12)');
assert.strictEqual(formatCallDuration(252), '04:12');
assert.strictEqual(formatCallDuration(65), '01:05');
assert.strictEqual(formatCallDuration(0), '00:00');
console.log('✓ Duration formatting passed.\n');

// 3. RM and TL Slack Member ID tagging
console.log('Test 3: RM and TL Slack Member ID resolution');
const shreySlackId = resolvePcgRmSlackId('Shrey Jain');
assert.strictEqual(shreySlackId, 'U0B5ZNXK6SV');
assert.strictEqual(formatRmSlackTag('Shrey Jain'), '<@U0B5ZNXK6SV> (Shrey Jain)');

const dheerajSlackId = resolvePcgTlSlackId('Dheeraj Bhojwani');
assert.strictEqual(dheerajSlackId, 'U0A3PEUCFPW');
assert.strictEqual(formatTlSlackTag('Team Dheeraj Bhojwani'), '<@U0A3PEUCFPW> (Dheeraj Bhojwani)');
console.log('✓ RM and TL Slack tagging passed.\n');

// 4. Exact Slack Alert message construction (Matching PDF Sample)
console.log('Test 4: Verify exact Slack Alert template output against Spec Page 2');
const sampleTrigger: PcgSopTrigger = {
  call_id: '68fb1d8ec9faf992f3132454',
  rm_name: 'Shrey Jain',
  tl_name: 'Dheeraj Bhojwani',
  customer_phone: '+919812345210',
  category: 'Customer Behaviour & Hostility',
  severity: 'CRITICAL',
  direction: 'Customer said this to RM',
  signal: 'Threatening legal action or regulator complaint',
  quote: 'If this interest is not credited by 5 PM, I will file a formal complaint with SEBI against Wint Wealth.',
  timestamp: '02:45',
  turn_index: 14,
};

const msg = buildPcgSopSlackMessage(sampleTrigger, {
  callId: '68fb1d8ec9faf992f3132454',
  rmName: 'Shrey Jain',
  tlName: 'Dheeraj Bhojwani',
  customerPhone: '+919812345210',
  durationSeconds: 252, // 04:12
});

console.log('Generated Slack Alert:\n');
console.log(msg);
console.log('\n');

assert(msg.includes('🚨 PCG CALL MONITORING ALERT — Customer Behaviour & Hostility'));
assert(msg.includes('• Call ID: 68fb1d8ec9faf992f3132454'));
assert(msg.includes('• RM: <@U0B5ZNXK6SV> (Shrey Jain)'));
assert(msg.includes('• TL: <@U0A3PEUCFPW> (Dheeraj Bhojwani)'));
assert(msg.includes('• Customer Phone: +91 98•••• ••210'));
assert(msg.includes('• Call Duration: 04:12'));
assert(msg.includes('Trigger Category: Customer Behaviour & Hostility'));
assert(msg.includes('Severity Level: CRITICAL'));
assert(msg.includes('Direction: Customer said this to RM'));
assert(msg.includes('Timestamp: 02:45 (Turn 14)'));
assert(msg.includes('"If this interest is not credited by 5 PM, I will file a formal complaint with SEBI against Wint Wealth."'));
assert(msg.includes('admin/pcg-calls?callId=68fb1d8ec9faf992f3132454'));
console.log('✓ Slack Alert template output strictly verified.\n');

// 5. 7 Monitoring Categories definition test
console.log('Test 5: Verify 7 monitoring categories');
assert.strictEqual(PCG_MONITORING_CATEGORIES.length, 7);
console.log('All 7 categories defined:');
PCG_MONITORING_CATEGORIES.forEach((c, i) => {
  console.log(`  ${i + 1}. [${c.severity}] ${c.name} (${c.defaultDirection})`);
});
console.log('✓ All 7 monitoring categories verified.\n');

// 6. Deterministic detection test
console.log('Test 6: Deterministic tripwire detection without LLM call');
async function testDeterministicRules() {
  const turns: Array<{ speaker: 'RM' | 'Customer'; text: string; time: string; turnIndex: number }> = [
    { speaker: 'RM', text: 'Good morning sir, Shrey Jain from Wint Wealth. Is it a good time to speak?', time: '00:04', turnIndex: 1 },
    { speaker: 'Customer', text: 'Yes, tell me.', time: '00:10', turnIndex: 2 },
    { speaker: 'Customer', text: 'If this interest is not credited by 5 PM, I will file a formal complaint with SEBI against Wint Wealth.', time: '02:45', turnIndex: 14 },
    { speaker: 'RM', text: 'Sir I will immediately check with our operations team and get this resolved.', time: '02:55', turnIndex: 15 },
  ];

  const triggers = await detectPcgSopTriggers(turns, {
    callId: 'test-call-123',
    rmName: 'Shrey Jain',
    tlName: 'Dheeraj Bhojwani',
    customerPhone: '+919812345210',
    durationSeconds: 180,
  }, []);

  assert.strictEqual(triggers.length, 1);
  assert.strictEqual(triggers[0].category, 'Customer Behaviour & Hostility');
  assert.strictEqual(triggers[0].severity, 'CRITICAL');
  assert.strictEqual(triggers[0].direction, 'Customer said this to RM');
  assert.strictEqual(triggers[0].turn_index, 14);
  assert.strictEqual(triggers[0].timestamp, '02:45');
  console.log('✓ Deterministic SEBI regulatory complaint detection passed.\n');
}

testDeterministicRules().then(() => {
  console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
}).catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

