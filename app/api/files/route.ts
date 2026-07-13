import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/auth';
import { listDriveFiles } from '@/lib/drive';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const files = await listDriveFiles();
    return NextResponse.json({ files });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
