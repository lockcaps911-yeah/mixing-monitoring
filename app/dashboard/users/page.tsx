import { redirect } from 'next/navigation';
import { AUTH_ENABLED, getCurrentUser } from '@/lib/auth';
import { listUsers } from '@/lib/adminUsers';
import { getProductionLines } from '@/lib/queries';
import UserManagement from '@/components/UserManagement';

export const dynamic = 'force-dynamic';

export default async function UserManagementPage() {
  if (!AUTH_ENABLED) redirect('/dashboard');
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'ADMIN') redirect('/dashboard');
  const [initialData, lines] = await Promise.all([
    listUsers('', 1, 20, '', null),
    getProductionLines(),
  ]);
  return <UserManagement initialData={initialData} currentUserId={user.id} lines={lines.map((line) => ({
    lineCode: line.line_code,
    name: line.name,
  }))} />;
}
