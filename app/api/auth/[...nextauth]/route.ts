import handler from '@/auth';
import { withLogging } from '@/lib/log';

export const GET = withLogging('auth', handler);
export const POST = withLogging('auth', handler);
