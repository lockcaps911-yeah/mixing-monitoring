import { notFound } from 'next/navigation';
import MachineDashboard from '@/components/MachineDashboard';
import { getHistory, getMachines, getSnapshot } from '@/lib/queries';
import type { Point } from '@/lib/types';
import { AuthError, requireLineAccess } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MachinePage({
  params,
}: {
  params: Promise<{ line: string; machine: string }>;
}) {
  const { line, machine } = await params;
  let user;
  try {
    user = await requireLineAccess(line);
  } catch (error) {
    if (error instanceof AuthError) redirect('/dashboard');
    throw error;
  }
  const [snapshot, machines] = await Promise.all([
    getSnapshot(line, machine),
    getMachines(user.role === 'ADMIN' ? null : user.lineCode),
  ]);
  if (!snapshot) notFound();

  const history: Record<string, Point[]> = await getHistory(line, machine, 30, 1800);

  return <MachineDashboard key={`${line}/${machine}`} snapshot={snapshot} history={history} machines={machines} />;
}
