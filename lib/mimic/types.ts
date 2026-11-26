// Definisi layar proses (mimic) sebagai DATA. Layar HMI lain cukup dibuat sebagai config baru,
// tanpa mengubah komponen penggambarnya. Koordinat memakai sistem koordinat gambar (viewBox).

export type MimicValve = {
  tag: string;               // harus sama dengan valves.tag di database
  x: number;
  y: number;
  vertical?: boolean;        // true bila dipasang pada pipa vertikal
  inverted?: boolean;       // true bila status PLC terbalik dengan indikator HMI
  label: { x: number; y: number; rotate?: boolean; anchor?: 'start' | 'middle' | 'end' };
};

export type MimicPipe = { d: string; color: string; width?: number };
export type MimicArrow = { x: number; y: number; rot: 0 | 90 | 180 | 270; color: string }; // 0 = ke kanan
export type MimicText = {
  x: number; y: number; text: string;
  anchor?: 'start' | 'middle' | 'end'; underline?: boolean; size?: number; bold?: boolean; rotate?: number;
};
export type MimicTank = { x: number; y: number; w: number; h: number };

export type MimicInstrument = {
  tag: string;               // parameters.tag
  unit: string;
  digits: number;
  pos?: { x: number; y: number };   // bila diisi: kotak ditempatkan di posisi ini (bukan di panel)
  kind?: 'value' | 'motor';  // motor: kotak hijau saat runTag = 1 (frekuensi motor / agitator)
  runTag?: string;           // tag BOOLEAN RUN untuk kind 'motor'
  setTag?: string;           // (motor) tag setpoint; ditampilkan sebagai kotak putih di bawah kotak aktual
};

export type MimicPump = { x: number; y: number; runTag: string };
export type MimicAgitator = { x: number; y: number; h: number; runTag: string }; // poros dari (x,y) ke bawah sepanjang h

export type MimicConfig = {
  title: string;
  x0?: number;               // asal viewBox (default 0)
  y0?: number;
  width: number;
  height: number;
  pipes: MimicPipe[];
  arrows: MimicArrow[];
  tanks: MimicTank[];
  texts: MimicText[];
  valves: MimicValve[];
  instruments: MimicInstrument[];
  instrumentBox?: { x: number; y: number };   // panel untuk instrumen tanpa pos
  pumps?: MimicPump[];
  agitators?: MimicAgitator[];
  tankLabel?: { x: number; y: number; text: string };
};
