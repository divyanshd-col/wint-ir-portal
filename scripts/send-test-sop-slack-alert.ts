import './_load-env';
import {
  sendPcgSopSlackAlert,
  getPcgSopSlackChannel,
  getPcgSlackToken,
  PcgSopTrigger,
} from '../lib/pcg/sop-alert';

async function main() {
  const channel = getPcgSopSlackChannel();
  const token = await getPcgSlackToken();

  console.log(`Sending PCG SOP Test Alert to channel: ${channel}`);
  console.log(`Slack token configured: ${token ? 'YES (' + token.slice(0, 9) + '...)' : 'NO'}`);

  const testTrigger: PcgSopTrigger = {
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

  const res = await sendPcgSopSlackAlert(testTrigger, {
    callId: '68fb1d8ec9faf992f3132454',
    rmName: 'Shrey Jain',
    tlName: 'Dheeraj Bhojwani',
    customerPhone: '+919812345210',
    durationSeconds: 252,
  });

  if (res.ok) {
    console.log(`\n✅ Alert successfully sent to Slack channel ${channel}! Message ts: ${res.ts}`);
  } else {
    console.error(`\n❌ Failed to post Slack alert: ${res.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Execution failed:', err);
  process.exit(1);
});

