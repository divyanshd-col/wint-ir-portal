import './_load-env';
import { syncExotelCalls } from '@/lib/exotel/sync';

async function main() {
  console.log('🔄 Starting Exotel Call Sync (strictly storage, moving forward only)...');
  const result = await syncExotelCalls();
  console.log('Sync Result:', result);
  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

