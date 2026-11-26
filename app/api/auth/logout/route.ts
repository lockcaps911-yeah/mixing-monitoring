import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { hashToken, hasSameOrigin, SESSION_COOKIE } from '@/lib/auth';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!hasSameOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) {
      await pool.query('DELETE FROM app_sessions WHERE token_hash = $1', [hashToken(token)]);
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (error) {
    console.error('Logout request failed', error);
    return NextResponse.json({ error: 'Logout could not be completed' }, { status: 500 });
  }
}
