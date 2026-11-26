import AlarmHistory from '@/components/AlarmHistory';
import { AuthError, requireLineAccess } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Alamat: /dashboard/line4/mixingL4/alarms
export default async function AlarmsPage({ params }: { params: Promise<{ line: string; machine: string }> }) {
  const { line, machine } = await params;
  try {
    await requireLineAccess(line);
  } catch (error) {
    if (error instanceof AuthError) redirect('/dashboard');
    throw error;
  }
  return <AlarmHistory line={line} machine={machine} />;
}
