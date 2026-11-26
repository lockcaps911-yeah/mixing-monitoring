import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  createSessionToken,
  AUTH_ENABLED,
  hashToken,
  hasSameOrigin,
  sessionCookieOptions,
  SESSION_COOKIE,
  verifyPassword,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoginRow = { id: string; name: string; email: string; password_hash: string; is_active: boolean };

function fingerprint(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export async function POST(req: Request) {
  if (!AUTH_ENABLED) {
    return NextResponse.json({ error: 'Login is disabled in development trial mode' }, { status: 404 });
  }
  if (!hasSameOrigin(req)) return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 });

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { email, password } = body as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 128) {
      return NextResponse.json({ error: 'Email or password is invalid' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const emailHash = fingerprint(normalizedEmail);
    const address = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const ipHash = fingerprint(address);
    await pool.query(`DELETE FROM app_login_attempts WHERE attempted_at <= now() - interval '24 hours'`);
    const attempts = await pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM app_login_attempts
        WHERE attempted_at > now() - interval '15 minutes'
          AND (email_hash = $1 OR ip_hash = $2)`,
      [emailHash, ipHash],
    );
    if (Number(attempts.rows[0]?.total ?? 0) >= 10) {
      return NextResponse.json({ error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }, { status: 429 });
    }

    const result = await pool.query<LoginRow>(
      `SELECT id, name, email, password_hash, is_active
         FROM app_users WHERE lower(email) = $1 LIMIT 1`,
      [normalizedEmail],
    );
    const account = result.rows[0];
    const validPassword = await verifyPassword(password, account?.password_hash ?? null);
    if (!account || !account.is_active || !validPassword) {
      await pool.query(
        `INSERT INTO app_login_attempts (email_hash, ip_hash) VALUES ($1, $2)`,
        [emailHash, ipHash],
      );
      return NextResponse.json({ error: 'Email atau password tidak valid' }, { status: 401 });
    }

    await pool.query('DELETE FROM app_login_attempts WHERE email_hash = $1', [emailHash]);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [account.id, hashToken(token), expiresAt],
      );
      await client.query(
        `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id)
         VALUES ($1, 'LOGIN', 'user', $2)`,
        [account.id, account.id],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const response = NextResponse.json({
      user: { id: account.id, name: account.name, email: account.email },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    console.error('Login request failed', error);
    return NextResponse.json({ error: 'Login could not be completed' }, { status: 500 });
  }
}
