import MimicTabs from '@/components/MimicTabs';
import { AuthError, requireLineAccess } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Alamat: /dashboard/line4/TK1002/mimic            (tab pertama)
//         /dashboard/line4/TK1002/mimic?layar=filling
export default async function MimicPage({
  params,
  searchParams,
}: {
  params: Promise<{ line: string; machine: string }>;
  searchParams: Promise<{ layar?: string }>;
}) {
  const [{ line, machine }, { layar }] = await Promise.all([params, searchParams]);
  try {
    await requireLineAccess(line);
  } catch (error) {
    if (error instanceof AuthError) redirect('/dashboard');
    throw error;
  }
  return (
    <div style={{ padding: 24 }}>
      <MimicTabs line={line} machine={machine} initial={layar} />
    </div>
  );
}
