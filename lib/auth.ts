import 'server-only';

import { cookies } from 'next/headers';
import { pool } from '@/lib/db';
import { hashToken } from '@/lib/authCrypto';
export { hashPassword, hashToken, verifyPassword, createSessionToken } from '@/lib/authCrypto';

const SESSION_COOKIE = 'mixing_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;
const PUBLIC_READ_ONLY_MODE =
  process.env.VERCEL_ENV === 'production' && process.env.PUBLIC_READ_ONLY_MODE === 'true';
export const AUTH_ENABLED =
  !PUBLIC_READ_ONLY_MODE && (process.env.NODE_ENV === 'production' || process.env.AUTH_ENABLED === 'true');

const TRIAL_USER: AuthUser = {
  id: 'development-trial',
  name: 'Trial Mode',
  email: 'trial@localhost',
  role: 'ADMIN',
  isActive: true,
  createdAt: new Date(0).toISOString(),
  lineCode: null,
  lineName: null,
};

export type UserRole = 'ADMIN' | 'USER';
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lineCode: string | null;
  lineName: string | null;
};

type SessionRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  line_code: string | null;
  line_name: string | null;
};

export class AuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

function toUser(row: SessionRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    lineCode: row.line_code,
    lineName: row.line_name,
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!AUTH_ENABLED) return TRIAL_USER;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;

  const result = await pool.query<SessionRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at,
            u.line_code, l.name AS line_name
       FROM app_sessions s
       JOIN app_users u ON u.id = s.user_id
       LEFT JOIN app_production_lines l ON l.line_code = u.line_code AND l.is_active
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function requireAuthenticatedUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, 'Authentication required');
  return user;
}

export async function requireAdmin() {
  if (!AUTH_ENABLED) {
    throw new AuthError(403, 'User management requires authentication to be enabled');
  }
  const user = await requireAuthenticatedUser();
  if (user.role !== 'ADMIN') throw new AuthError(403, 'Administrator access required');
  return user;
}

export async function requireLineAccess(lineCode: string) {
  const user = await requireAuthenticatedUser();
  if (user.role === 'ADMIN') return user;
  if (!user.lineCode || !user.lineName) {
    throw new AuthError(403, 'No active production line is assigned to this account');
  }
  if (user.lineCode.toLowerCase() !== lineCode.toLowerCase()) {
    throw new AuthError(403, 'Access to this production line is not allowed');
  }
  return user;
}

export async function requireAssignedLine() {
  const user = await requireAuthenticatedUser();
  if (user.role === 'ADMIN') return user;
  if (!user.lineCode || !user.lineName) {
    throw new AuthError(403, 'No active production line is assigned to this account');
  }
  return user;
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error('Authentication or authorization check failed', error);
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}

export function hasSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_DURATION_SECONDS,
    expires: new Date(Date.now() + SESSION_DURATION_MS),
  };
}

export { SESSION_COOKIE };
