// Klasifikasi tag: jenis parameter, area proses, peran sinyal BOOLEAN.
// Dipakai server (queries.ts) dan client. Sesuaikan aturan di sini bila penamaan tag berubah.

export type ParamType = 'temperature' | 'weight' | 'pressure' | 'conductivity' | 'frequency' | 'other';
export type Area = 'tank1' | 'tank2' | 'filter' | 'buffer' | 'other';
export type BoolRole = 'estop' | 'fault' | 'buzzer' | 'run' | 'status';

export const AREA_ORDER: Area[] = ['tank1', 'tank2', 'filter', 'buffer', 'other'];
export const AREA_LABEL: Record<Area, string> = {
  tank1: 'Tanki Mixing 1',
  tank2: 'Tanki Mixing 2',
  filter: 'Jalur Filter dan Produk',
  buffer: 'Buffer Tank',
  other: 'Parameter Lainnya',
};
export const TYPE_LABEL: Record<ParamType, string> = {
  temperature: 'Suhu', pressure: 'Tekanan', weight: 'Berat', conductivity: 'Konduktivitas', frequency: 'Frekuensi', other: 'Lainnya',
};
export const TYPE_DIGITS: Record<ParamType, number> = {
  temperature: 1, pressure: 2, weight: 1, conductivity: 1, frequency: 1, other: 1,
};

export const TYPE_UNIT: Record<ParamType, string> = {
  temperature: '°C',
  pressure: 'bar',
  weight: 'kg',
  conductivity: 'µS/cm',
  frequency: 'Hz',
  other: '',
};

export function formatParameterValue(value: number, type: ParamType, digits = TYPE_DIGITS[type]): string {
  if (!Number.isFinite(value)) return '–';
  return Math.max(0, value).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatRawParameterValue(value: number, type: ParamType, digits = TYPE_DIGITS[type]): string {
  return Number.isFinite(value)
    ? value.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '–';
}

export function formatEngineeringParameterValue(
  value: number,
  type: ParamType,
  lineCode: string,
  digits = TYPE_DIGITS[type],
): string {
  const line = lineCode.trim().toLowerCase();
  return line === 'line3' || (line === 'line4' && type === 'pressure')
    ? formatRawParameterValue(value, type, digits)
    : formatParameterValue(value, type, digits);
}

// Jenis parameter: isi parameter_type -> satuan -> awalan tag
export function normalizeType(type: string | null, unit: string | null, tag: string): ParamType {
  const t = (type ?? '').toLowerCase();
  if (/temp|suhu/.test(t)) return 'temperature';
  if (/weight|berat|massa|mass/.test(t)) return 'weight';
  if (/press|tekan/.test(t)) return 'pressure';
  if (/cond|konduk/.test(t)) return 'conductivity';
  if (/freq|frek|speed|kecepatan/.test(t)) return 'frequency';

  const u = (unit ?? '').toLowerCase().replace(/\s/g, '');
  if (u.includes('°c') || u === 'c' || u === 'degc') return 'temperature';
  if (u === 'kg' || u === 'g') return 'weight';
  if (u === 'bar' || u === 'psi' || u === 'kpa') return 'pressure';
  if (u.includes('s/cm')) return 'conductivity';
  if (u === 'hz' || u === 'rpm') return 'frequency';

  const g = tag.toUpperCase();
  if (g.startsWith('TT')) return 'temperature';
  if (g.startsWith('WM')) return 'weight';
  if (g.startsWith('PT')) return 'pressure';
  if (g.startsWith('CT')) return 'conductivity';
  if (g.startsWith('AG') || /^P\d/.test(g)) return 'frequency';
  return 'other';
}

const BOOL_TYPES = ['valve', 'alarm_status', 'safety_status', 'machine_status'];
export const isBoolean = (dataType: string | null, ptype: string | null) =>
  /^bool/i.test(dataType ?? '') || BOOL_TYPES.includes((ptype ?? '').toLowerCase());

export function boolRole(tag: string, ptype: string | null): BoolRole {
  const t = (ptype ?? '').toLowerCase();
  const g = tag.toUpperCase();
  if (t.includes('safety')) return 'estop';
  if (g.startsWith('BZL') || g.startsWith('BLZ')) return 'buzzer';
  if (t.includes('alarm')) return 'fault';
  if (t.includes('machine')) return 'run';
  return 'status';
}

// Tanki pemilik tag: 1, 2, atau 0 (bersama)
export function tankOf(tag: string): 0 | 1 | 2 {
  const g = tag.toUpperCase();
  const line3 = /^DB2_(?:CE|WM|MS|PT|TT)([12])_/.exec(g);
  if (line3) return Number(line3[1]) as 1 | 2;
  const m = /^(?:P|LMS|LMX|WM|PT|CT)100([12])/.exec(g);
  if (m) return Number(m[1]) as 1 | 2;
  const tt = /^TT10(\d\d)$/.exec(g);
  if (tt) {
    const n = Number(tt[1]);
    if (n <= 4 || n === 11) return 1;
    if (n >= 5 && n <= 8) return 2;
  }
  return 0;
}

const FILTER_TAGS = new Set(['TT1009', 'TT1010', 'TT1013', 'CT1003']);
const BUFFER_TAGS = new Set(['TT1012', 'PT1003', 'CT1004']);

export function areaOf(tag: string): Area {
  const g = tag.toUpperCase();
  const t = tankOf(g);
  if (t === 1) return 'tank1';
  if (t === 2) return 'tank2';
  if (FILTER_TAGS.has(g)) return 'filter';
  if (BUFFER_TAGS.has(g)) return 'buffer';
  return 'other';
}

// Parameter "kritis" yang ditampilkan sebagai kartu besar
export function isCritical(tag: string, type: ParamType, area: Area): boolean {
  if (area !== 'tank1' && area !== 'tank2') return false;
  if (type === 'temperature') return /^(?:TT100[15]|DB2_TT[12]_01)$/i.test(tag); // suhu tanki; TT lain = suhu sterilisasi (SIP)
  return type === 'weight' || type === 'pressure' || type === 'frequency';
}

export function shortLabel(type: ParamType, tag: string): string {
  if (type === 'frequency') return /^P\d/i.test(tag) ? 'Frekuensi Pompa' : 'Frekuensi Agitator';
  return TYPE_LABEL[type];
}

export const VALVE_GROUP_LABEL: Record<string, string> = {
  PAV: 'Pneumatic Actuated Valve',
  PCV: 'Process Control Valve',
  PDV: 'Diaphragm Valve',
  PEV: 'Exhaust Valve',
};
