import 'server-only';

import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/authCrypto';
import type { UserRole } from '@/lib/auth';

export class UserInputError extends Error {}
export class UserNotFoundError extends Error {}

export function isEmailConflict(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === '23505'
    && 'constraint' in error
    && error.constraint === 'app_users_email_lower_unique';
}

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lineCode: string | null;
  lineName: string | null;
};

export type ProductionLine = { lineCode: string; name: string };

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  line_code: string | null;
  line_name: string | null;
};

function mapUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    lineCode: row.line_code,
    lineName: row.line_name,
  };
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120;
}

function validEmail(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

function validRole(value: unknown): value is UserRole {
  return value === 'ADMIN' || value === 'USER';
}

export function validateUserCreate(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UserInputError('Invalid request body');
  const data = body as Record<string, unknown>;
  const allowed = new Set(['name', 'email', 'password', 'role', 'isActive', 'lineCode']);
  if (Object.keys(data).some((key) => !allowed.has(key))) throw new UserInputError('Unknown user field');
  if (!validName(data.name)) throw new UserInputError('Name must contain 1 to 120 characters');
  if (!validEmail(data.email)) throw new UserInputError('A valid email is required');
  if (!validPassword(data.password)) throw new UserInputError('Password must contain 12 to 128 characters');
  if (data.role !== undefined && !validRole(data.role)) throw new UserInputError('Role must be ADMIN or USER');
  const role: UserRole = data.role === undefined ? 'USER' : data.role;
  if (data.isActive !== undefined && typeof data.isActive !== 'boolean') throw new UserInputError('isActive must be a boolean');
  if (role === 'USER' && (typeof data.lineCode !== 'string' || !data.lineCode.trim())) {
    throw new UserInputError('A production line is required for USER accounts');
  }
  if (role === 'ADMIN' && data.lineCode !== undefined && data.lineCode !== null && typeof data.lineCode !== 'string') {
    throw new UserInputError('lineCode must be a valid production line');
  }
  return {
    name: data.name.trim(),
    email: data.email.trim().toLowerCase(),
    password: data.password,
    role,
    isActive: (data.isActive ?? true) as boolean,
    lineCode: role === 'ADMIN' ? null : (data.lineCode as string).trim().toLowerCase(),
  };
}

export function validateUserUpdate(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UserInputError('Invalid request body');
  const data = body as Record<string, unknown>;
  const allowed = new Set(['name', 'email', 'password', 'role', 'isActive', 'lineCode']);
  if (Object.keys(data).length === 0 || Object.keys(data).some((key) => !allowed.has(key))) {
    throw new UserInputError('Provide at least one valid user field');
  }
  if ('name' in data && !validName(data.name)) throw new UserInputError('Name must contain 1 to 120 characters');
  if ('email' in data && !validEmail(data.email)) throw new UserInputError('A valid email is required');
  if ('password' in data && !validPassword(data.password)) throw new UserInputError('Password must contain 12 to 128 characters');
  if ('role' in data && !validRole(data.role)) throw new UserInputError('Role must be ADMIN or USER');
  if ('isActive' in data && typeof data.isActive !== 'boolean') throw new UserInputError('isActive must be a boolean');
  if ('lineCode' in data && data.lineCode !== null && (typeof data.lineCode !== 'string' || !data.lineCode.trim())) {
    throw new UserInputError('lineCode must be a valid production line');
  }
  if (data.role === 'USER' && !('lineCode' in data)) {
    throw new UserInputError('A production line is required for USER accounts');
  }
  if (data.role === 'ADMIN' && data.lineCode === undefined) {
    data.lineCode = null;
  }
  return {
    ...(data.name !== undefined ? { name: (data.name as string).trim() } : {}),
    ...(data.email !== undefined ? { email: (data.email as string).trim().toLowerCase() } : {}),
    ...(data.password !== undefined ? { password: data.password as string } : {}),
    ...(data.role !== undefined ? { role: data.role as UserRole } : {}),
    ...(data.isActive !== undefined ? { isActive: data.isActive as boolean } : {}),
    ...(data.lineCode !== undefined ? { lineCode: data.lineCode === null ? null : (data.lineCode as string).trim().toLowerCase() } : {}),
  };
}

export function validUserId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function listUsers(
  search: string,
  page: number,
  pageSize: number,
  role: UserRole | '',
  active: boolean | null,
) {
  const filter = `%${search.trim()}%`;
  const [count, result] = await Promise.all([
    pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM app_users
        WHERE (name ILIKE $1 OR email ILIKE $1)
          AND ($2 = '' OR role = $2)
          AND ($3::boolean IS NULL OR is_active = $3)`,
      [filter, role, active],
    ),
    pool.query<UserRow>(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.updated_at,
              u.line_code, l.name AS line_name
         FROM app_users u
         LEFT JOIN app_production_lines l ON l.line_code = u.line_code
        WHERE (u.name ILIKE $1 OR u.email ILIKE $1)
          AND ($2 = '' OR u.role = $2)
          AND ($3::boolean IS NULL OR u.is_active = $3)
        ORDER BY u.created_at DESC, u.id LIMIT $4 OFFSET $5`,
      [filter, role, active, pageSize, (page - 1) * pageSize],
    ),
  ]);
  return {
    users: result.rows.map(mapUser),
    total: Number(count.rows[0]?.total ?? 0),
    page,
    pageSize,
  };
}

export async function getUser(id: string) {
  const result = await pool.query<UserRow>(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.updated_at,
            u.line_code, l.name AS line_name
       FROM app_users u LEFT JOIN app_production_lines l ON l.line_code = u.line_code
      WHERE u.id = $1`,
    [id],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function createUser(
  actorId: string,
  input: ReturnType<typeof validateUserCreate>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await hashPassword(input.password);
    if (input.lineCode) {
      const line = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM app_production_lines WHERE line_code = $1`,
        [input.lineCode],
      );
      if (!line.rows[0]?.is_active) throw new UserInputError('Selected production line is not active');
    }
    const inserted = await client.query<UserRow>(
      `INSERT INTO app_users (name, email, password_hash, role, is_active, line_code)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, is_active, created_at, updated_at, line_code,
         (SELECT name FROM app_production_lines WHERE line_code = app_users.line_code) AS line_name`,
      [input.name, input.email, passwordHash, input.role, input.isActive, input.lineCode],
    );
    const user = inserted.rows[0];
    await client.query(
      `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id, details)
       VALUES ($1, 'USER_CREATED', 'user', $2, $3)`,
      [actorId, user.id, JSON.stringify({ role: user.role, isActive: user.is_active, lineCode: user.line_code })],
    );
    await client.query('COMMIT');
    return mapUser(user);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateUser(
  actorId: string,
  id: string,
  input: ReturnType<typeof validateUserUpdate>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (input.role !== undefined || input.isActive !== undefined || input.lineCode !== undefined) {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [746201]);
    }
    const found = await client.query<UserRow>(
      `SELECT id, name, email, role, is_active, created_at, updated_at, line_code,
              (SELECT name FROM app_production_lines WHERE line_code = app_users.line_code) AS line_name
         FROM app_users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!found.rows[0]) throw new UserNotFoundError('User not found');
    const current = found.rows[0];

    const name = input.name ?? current.name;
    const email = input.email ?? current.email;
    const role = input.role ?? current.role;
    const isActive = input.isActive ?? current.is_active;
    const lineCode = input.lineCode !== undefined ? input.lineCode : role === 'ADMIN' ? null : current.line_code;
    if (role === 'USER' && !lineCode) throw new UserInputError('A production line is required for USER accounts');
    if (lineCode) {
      const line = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM app_production_lines WHERE line_code = $1`,
        [lineCode],
      );
      if (!line.rows[0]?.is_active) throw new UserInputError('Selected production line is not active');
    }
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const updated = await client.query<UserRow>(
      `UPDATE app_users
          SET name = $2, email = $3, role = $4, is_active = $5, line_code = $6,
              password_hash = coalesce($7, password_hash), updated_at = now()
        WHERE id = $1
        RETURNING id, name, email, role, is_active, created_at, updated_at, line_code,
          (SELECT name FROM app_production_lines WHERE line_code = app_users.line_code) AS line_name`,
      [id, name, email, role, isActive, lineCode, passwordHash],
    );
    const user = updated.rows[0];

    if (current.role === 'ADMIN' && current.is_active && (role !== 'ADMIN' || !isActive)) {
      const admins = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM app_users WHERE role = 'ADMIN' AND is_active`,
      );
      if (Number(admins.rows[0]?.count ?? 0) === 0) throw new UserInputError('At least one active administrator must remain');
    }

    if (role !== current.role) {
      await client.query(
        `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id, details)
         VALUES ($1, 'USER_ROLE_CHANGED', 'user', $2, $3)`,
        [actorId, id, JSON.stringify({ from: current.role, to: role })],
      );
    }
    if (isActive !== current.is_active) {
      await client.query(
        `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id, details)
         VALUES ($1, 'USER_STATUS_CHANGED', 'user', $2, $3)`,
        [actorId, id, JSON.stringify({ isActive })],
      );
    }
    if (lineCode !== current.line_code) {
      await client.query(
        `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id, details)
         VALUES ($1, 'USER_LINE_CHANGED', 'user', $2, $3)`,
        [actorId, id, JSON.stringify({ from: current.line_code, to: lineCode })],
      );
    }
    if (name !== current.name || email !== current.email || passwordHash) {
      await client.query(
        `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id)
         VALUES ($1, 'USER_UPDATED', 'user', $2)`,
        [actorId, id],
      );
    }

    const sessionRevoked = role !== current.role || current.is_active !== isActive
      || current.line_code !== lineCode || Boolean(passwordHash);
    if (sessionRevoked) {
      await client.query('DELETE FROM app_sessions WHERE user_id = $1', [id]);
    }
    await client.query('COMMIT');
    return { user: mapUser(user), sessionRevoked };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteUser(actorId: string, id: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [746201]);
    const found = await client.query<UserRow>(
      `SELECT id, name, email, role, is_active, created_at, updated_at
         FROM app_users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const user = found.rows[0];
    if (!user) throw new UserNotFoundError('User not found');
    if (user.id === actorId) throw new UserInputError('You cannot delete your own account');
    if (user.role === 'ADMIN' && user.is_active) {
      const admins = await client.query<{ count: string }>(
        `SELECT count(*) AS count FROM app_users WHERE role = 'ADMIN' AND is_active`,
      );
      if (Number(admins.rows[0]?.count ?? 0) <= 1) throw new UserInputError('At least one active administrator must remain');
    }
    await client.query(
      `INSERT INTO app_audit_logs (actor_user_id, action, target_type, target_id, details)
       VALUES ($1, 'USER_DELETED', 'user', $2, $3)`,
      [actorId, id, JSON.stringify({ role: user.role, isActive: user.is_active })],
    );
    await client.query('DELETE FROM app_users WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
