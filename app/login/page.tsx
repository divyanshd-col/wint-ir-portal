import { redirect } from 'next/navigation';
import { readConfig } from '@/lib/config';
import LoginClient from './LoginClient';

export default async function LoginPage() {
  const config = await readConfig();
  if (!config.isConfigured) redirect('/setup');
  return <LoginClient />;
}
