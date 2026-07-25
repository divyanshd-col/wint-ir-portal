import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { redirect } from 'next/navigation';

// This page duplicated /tl/quality-chats (same data, same read-only EvalPanel).
// Keep the URL alive for bookmarks, but send everyone to the canonical view.
export default async function TLEvaluationPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');
  const role = ((session.user as any)?.role as string) || '';
  if (!['tl', 'admin'].includes(role)) redirect('/quality');
  redirect('/tl/quality-chats');
}
