import type { Area, BoolRole, ParamType } from '@/lib/classify';

export type Point = [number, number]; // [timestamp ms, nilai]

export type ParamInfo = {
  tag: string;
  name: string;
  label: string;           // deskripsi (atau nama bila deskripsi kosong)
  unit: string;            // satuan tampilan
  type: ParamType;
  dataType: string | null;
  isBool: boolean;
  role: 'analog' | BoolRole;
  area: Area;
  critical: boolean;
  value: number | null;    // nilai MENTAH terakhir
  quality: 'GOOD' | 'BAD' | null;
  at: string | null;       // ISO
  min: number | null;      // batas dalam nilai mentah
  max: number | null;
};

export type ValveInfo = {
  tag: string;
  name: string;
  description: string | null;
  state: boolean | null;
  changedAt: string | null; // ISO
};

export type Snapshot = {
  machine: { code: string; line: string; name: string };
  parameters: ParamInfo[];
  valves: ValveInfo[];
};
