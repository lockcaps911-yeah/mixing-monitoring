import type { MimicConfig } from '@/lib/mimic/types';
import { tk1001 } from '@/lib/mimic/tk1001';
import { tk1002 } from '@/lib/mimic/tk1002';
import { filterLine } from '@/lib/mimic/filterLine';
import { fillingRoom } from '@/lib/mimic/fillingRoom';

// Urutan mengikuti tombol 1-4 pada HMI. config = null berarti layar belum dibuat (tab nonaktif).
export const SCREENS: { id: string; label: string; config: MimicConfig | null }[] = [
  { id: 'tk1001', label: 'TK1001', config: tk1001 },
  { id: 'tk1002', label: 'TK1002', config: tk1002 },
  { id: 'filterLine', label: 'Filter Line', config: filterLine },
  { id: 'filling', label: 'Filling Room', config: fillingRoom },
];
