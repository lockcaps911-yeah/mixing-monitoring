'use client';

import { useRouter } from 'next/navigation';

type Item = { code: string; line_code: string; name: string };

export default function MachineSelect({ machines, current }: { machines: Item[]; current: string }) {
  const router = useRouter();
  return (
    <select
      className="sc-select"
      aria-label="Pilih mesin"
      value={current}
      onChange={(e) => router.push(`/dashboard/${e.target.value}`)}
    >
      {machines.map((m) => (
        <option key={`${m.line_code}/${m.code}`} value={`${m.line_code}/${m.code}`}>
          {m.code}
        </option>
      ))}
    </select>
  );
}
