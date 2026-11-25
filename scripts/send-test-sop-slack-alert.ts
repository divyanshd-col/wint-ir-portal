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
    call_id: '6b068687e9ead89aab226356',
    rm_name: 'Richa Mishra',
    tl_name: 'Team Sravanthi',
    category: 'Customer Behaviour & Hostility',
    severity: 'MEDIUM',
    direction: 'Customer said this to RM',
    signal: 'Customer hostility towards RM',
    quote: 'You are a relationship manager, first try to listen. Right? Listen to your customer, talk less. Now if it is not getting generated, then this is a new task given to you. By when will you respond?',
  };

  const res = await sendPcgSopSlackAlert(testTrigger, {
    callId: '6b068687e9ead89aab226356',
    rmName: 'Richa Mishra',
    tlName: 'Team Sravanthi',
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

