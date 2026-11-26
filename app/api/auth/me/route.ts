import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    return NextResponse.json({ user });
  } catch (error) {
    console.error('Current-user request failed', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
