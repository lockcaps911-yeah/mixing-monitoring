
export type Line3Tank = 'T1' | 'T2';

// =====================================================
// 1. SENSOR TAG ASLI
// Tetap digunakan untuk backend dan KEPServerEX.
// Jangan mengganti nama tag berikut.
// =====================================================

const sensorTags = {
  T1: [
    'DB2_CE1_01',
    'DB2_WM1_01',
    'DB2_MS1_01',
    'DB2_PT1_01',
    'DB2_TT1_01',
    'DB2_TT1_02',
    'DB2_TT1_03',
    'DB2_TT1_04',
    'DB2_TT1_05',
  ],
  T2: [
    'DB2_CE2_01',
    'DB2_WM2_01',
    'DB2_MS2_01',
    'DB2_PT2_01',
    'DB2_TT2_01',
    'DB2_TT2_02',
    'DB2_TT2_03',
    'DB2_TT2_04',
    'DB2_TT2_05',
  ],
} as const satisfies Record<Line3Tank, readonly string[]>;


// =====================================================
// 2. ALIAS SENSOR
// Khusus nama yang ditampilkan pada frontend.
// =====================================================

const sensorAliases = {
  T1: [
    'CE1-01',
    'WM1-01',
    'MS1-01',
    'PT1-01',
    'TT1-01',
    'TT1-02',
    'TT1-03',
    'TT1-04',
    'TT1-05',
  ],
  T2: [
    'CE2-01',
    'WM2-01',
    'MS2-01',
    'PT2-01',
    'TT2-01',
    'TT2-02',
    'TT2-03',
    'TT2-04',
    'TT2-05',
  ],
} as const satisfies Record<Line3Tank, readonly string[]>;


// =====================================================
// 3. MAPPING TAG ASLI -> ALIAS
// =====================================================

const sensorDisplayMap: Record<string, string> = {
  DB2_CE1_01: 'CE1-01',
  DB2_WM1_01: 'WM1-01',
  DB2_MS1_01: 'MS1-01',
  DB2_PT1_01: 'PT1-01',
  DB2_TT1_01: 'TT1-01',
  DB2_TT1_02: 'TT1-02',
  DB2_TT1_03: 'TT1-03',
  DB2_TT1_04: 'TT1-04',
  DB2_TT1_05: 'TT1-05',

  DB2_CE2_01: 'CE2-01',
  DB2_WM2_01: 'WM2-01',
  DB2_MS2_01: 'MS2-01',
  DB2_PT2_01: 'PT2-01',
  DB2_TT2_01: 'TT2-01',
  DB2_TT2_02: 'TT2-02',
  DB2_TT2_03: 'TT2-03',
  DB2_TT2_04: 'TT2-04',
  DB2_TT2_05: 'TT2-05',
};


// =====================================================
// 4. FUNGSI ALIAS UNTUK TAMPILAN FRONTEND
// =====================================================

export function line3SensorDisplayName(tag: string): string {
  return sensorDisplayMap[tag] ?? tag;
}


// =====================================================
// 5. FUNGSI MAPPING HMI KE TAG ASLI KEPServerEX
// Tetap menggunakan nama tag asli.
// =====================================================

export function line3HmiSensorTag(
  hmiTag: string,
  tank: Line3Tank
): string | null {
  const tankNumber = tank === 'T1' ? '1' : '2';

  const match = /^(CE|WM|PT|TT) ([12])-(\d{2})$/.exec(hmiTag);

  const tag = hmiTag === 'AGIT'
    ? `DB2_MS${tankNumber}_01`
    : match && match[2] === tankNumber
      ? `DB2_${match[1]}${match[2]}_${match[3]}`
      : null;

  return tag && sensorTags[tank].some(
    (sensorTag) => sensorTag === tag
  )
    ? tag
    : null;
}


// =====================================================
// 6. VALVE TAG ASLI
// Tidak ada perubahan pada konfigurasi valve.
// =====================================================

const valveTags = {
  T1: [
    ...Array.from(
      { length: 20 },
      (_, index) => `PBV 1-${String(index + 1).padStart(2, '0')}`
    ),
    ...Array.from(
      { length: 25 },
      (_, index) => `DKV 1-${String(index + 1).padStart(2, '0')}`
    ),
  ],
  T2: [
    ...Array.from(
      { length: 20 },
      (_, index) => `PBV 2-${String(index + 1).padStart(2, '0')}`
    ),
    ...Array.from(
      { length: 25 },
      (_, index) => `DKV 2-${String(index + 1).padStart(2, '0')}`
    ),
  ],
} as const satisfies Record<Line3Tank, readonly string[]>;


// =====================================================
// 7. EXPORT KONFIGURASI LINE 3
// =====================================================

export const LINE3_TANK_TAGS = {
  sensors: sensorTags,
  sensorAliases,
  sensorDisplayMap,
  valves: valveTags,
} as const;
