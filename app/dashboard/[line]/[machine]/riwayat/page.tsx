import { notFound } from 'next/navigation';
import RiwayatData from '@/components/RiwayatData';
import { getMachines, getSnapshot } from '@/lib/queries';
import { AuthError, requireLineAccess } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function RiwayatPage({
  params,
  searchParams,
}: {
  params: Promise<{ line: string; machine: string }>;
  searchParams?: Promise<{ unit?: string }>;
}) {
  const [{ line, machine }, sp] = await Promise.all([
    params,
    searchParams ?? Promise.resolve<{ unit?: string }>({}),
  ]);
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

  return (
    <RiwayatData
      key={`${line}/${machine}`}
      line={line}
      machine={machine}
      machines={machines}
      initialUnit={sp?.unit}
    />
  );
}
