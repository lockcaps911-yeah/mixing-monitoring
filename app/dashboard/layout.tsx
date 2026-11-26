import './dashboard.css';
import SideNav from '@/components/SideNav';
import { AUTH_ENABLED, getCurrentUser } from '@/lib/auth';
import { getMachines } from '@/lib/queries';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const machines = user.role === 'ADMIN'
    ? await getMachines()
    : user.lineCode
      ? await getMachines(user.lineCode)
      : [];
  const defaultMachine = machines[0]
    ? { line: machines[0].line_code, code: machines[0].code }
    : null;

  return (
    <div className="sc-root">
      <SideNav user={user} defaultMachine={defaultMachine} authenticationEnabled={AUTH_ENABLED} />
      <div className="sc-body">{children}</div>
    </div>
  );
}
