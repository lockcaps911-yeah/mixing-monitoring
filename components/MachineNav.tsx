'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Item = { code: string; line_code: string; name: string };

export default function MachineNav({ machines }: { machines: Item[] }) {
  const path = usePathname().toLowerCase();
  return (
    <nav className="mm-nav" aria-label="Pilih mesin">
      {machines.map((m) => {
        const href = `/dashboard/${m.line_code}/${m.code}`;
        const active = path === href.toLowerCase();
        return (
          <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''}>
            {m.name}
          </Link>
        );
      })}
    </nav>
  );
}
