import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Pool } from 'pg';

const migrationDir = path.resolve(process.cwd(), 'db', 'migrations');

async function loadLocalEnv() {
  try {
    const contents = await readFile(path.resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

async function listMigrations() {
  const entries = await readdir(migrationDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^\d{3}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function ensureMigrationHistory(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum text NOT NULL
    )
  `);
}

async function getApplied(pool: Pool) {
  const result = await pool.query<{ filename: string; applied_at: Date }>(
    'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((row) => row.filename));
}

function checksum(sql: string) {
  return createHash('sha256').update(sql).digest('hex');
}

async function verifyFirstMigration(pool: Pool) {
  const result = await pool.query<{ complete: boolean }>(`
    SELECT
      to_regclass('public.app_users') IS NOT NULL
      AND to_regclass('public.app_sessions') IS NOT NULL
      AND to_regclass('public.app_audit_logs') IS NOT NULL
      AND to_regclass('public.app_login_attempts') IS NOT NULL
      AS complete
  `);
  return result.rows[0]?.complete === true;
}

async function applyMigration(pool: Pool, filename: string) {
  if (!/^\d{3}_.+\.sql$/.test(filename)) {
    throw new Error('Migration filename is invalid.');
  }

  const migrationPath = path.resolve(migrationDir, filename);
  if (path.dirname(migrationPath) !== migrationDir) {
    throw new Error('Migration must be inside db/migrations.');
  }

  const sql = await readFile(migrationPath, 'utf8');

  if (filename === '001_auth_rbac.sql' && await verifyFirstMigration(pool)) {
    await pool.query(
      'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
      [filename, checksum(sql)],
    );
    console.info(`${filename}: existing auth tables detected; history recorded`);
    return;
  }

  await pool.query(sql);
  await pool.query(
    'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
    [filename, checksum(sql)],
  );
  console.info(`${filename}: applied`);
}

async function main() {
  await loadLocalEnv();
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL or DATABASE_URL_UNPOOLED is not set. Configure it in .env.local before running migrations.');
  }

  const target = new URL(databaseUrl);
  const hostname = target.hostname.toLowerCase();
  const isLocalTarget = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1';
  const argument = process.argv[2];

  if (argument && argument !== 'status' && isLocalTarget) {
    throw new Error(`Refusing migration to local database ${hostname}:${target.port || '5432'}. Set DATABASE_URL_UNPOOLED or DATABASE_URL to the Neon production database.`);
  }

  process.env.DATABASE_URL = databaseUrl;
  const { pool } = await import('@/lib/db');
  migrationPool = pool;
  const migrations = await listMigrations();
  await ensureMigrationHistory(pool);
  const applied = await getApplied(pool);

  if (!argument || argument === 'status') {
    for (const filename of migrations) {
      console.info(`${applied.has(filename) ? 'APPLIED' : 'PENDING'} ${filename}`);
    }
    return;
  }

  const targets = argument === 'all'
    ? migrations
    : [argument];

  for (const filename of targets) {
    if (!migrations.includes(filename)) {
      throw new Error(`Migration not found: ${filename}`);
    }
    if (applied.has(filename)) {
      console.info(`${filename}: already applied`);
      continue;
    }
    await applyMigration(pool, filename);
  }
}

let migrationPool: Pool | undefined;

main()
  .then(() => undefined)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Migration failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (migrationPool) await migrationPool.end();
  });
