import { pool } from '@/lib/db';

async function main() {
  const result = await pool.query<{
    name: string;
    email: string;
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT name, email, is_active, created_at
       FROM app_users
      WHERE role = 'ADMIN'
      ORDER BY created_at`,
  );

  if (result.rows.length === 0) {
    console.info('Tidak ada akun Admin. Jalankan npm run admin:create untuk membuat Admin pertama.');
    return;
  }

  console.table(result.rows.map((row) => ({
    nama: row.name,
    email: row.email,
    status: row.is_active ? 'Aktif' : 'Nonaktif',
    dibuat: row.created_at.toLocaleString(),
  })));
}

main()
  .catch((error: unknown) => {
    console.error('Gagal membaca daftar Admin:', error instanceof Error ? error.message : 'Kesalahan tidak diketahui.');
    process.exitCode = 1;
  })
  .finally(() => pool.end());
