import { redirect } from 'next/navigation';
import { getMachines } from '@/lib/queries';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function DashboardIndex() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const machines = user.role === 'ADMIN'
    ? await getMachines()
    : user.lineCode
      ? await getMachines(user.lineCode)
      : [];
  if (machines.length === 0) {
    return <p className="mm-empty">Belum ada mesin. Jalankan seed database (db/init/02_seed.sql) terlebih dahulu.</p>;
  }
  redirect(`/dashboard/${machines[0].line_code}/${machines[0].code}`);
}
