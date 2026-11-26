import { pool } from '@/lib/db';
import { hashPassword } from '@/lib/authCrypto';

async function main() {
  const name = process.env.ADMIN_BOOTSTRAP_NAME?.trim();
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!name || name.length > 120 || !email || email.length > 254 || !password || password.length < 12 || password.length > 128) {
    throw new Error('Set ADMIN_BOOTSTRAP_NAME, ADMIN_BOOTSTRAP_EMAIL, and a 12-128 character ADMIN_BOOTSTRAP_PASSWORD.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ADMIN_BOOTSTRAP_EMAIL must be a valid email address.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [746201]);
    const existing = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM app_users WHERE role = 'ADMIN' AND is_active`,
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0) throw new Error('An active administrator already exists.');

    const passwordHash = await hashPassword(password);
    const created = await client.query<{ id: string }>(
      `INSERT INTO app_users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'ADMIN')
       RETURNING id`,
      [name, email, passwordHash],
    );
    await client.query(
      `INSERT INTO app_audit_logs (action, target_type, target_id, details)
       VALUES ('ADMIN_BOOTSTRAPPED', 'user', $1, $2)`,
      [created.rows[0].id, JSON.stringify({ email })],
    );
    await client.query('COMMIT');
    console.info(`Initial administrator created: ${email}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Administrator bootstrap failed.');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
