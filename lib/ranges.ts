// Rentang grafik historis. bucketS = lebar satu titik (detik); data dirata-rata per bucket.
export const RANGES = {
  hour:  { label: '1 Jam',    ms: 3_600_000,      bucketS: 30 },
  day:   { label: '24 Jam',   ms: 86_400_000,     bucketS: 300 },
  week:  { label: '1 Minggu', ms: 7 * 86_400_000, bucketS: 3_600 },
  month: { label: '1 Bulan',  ms: 30 * 86_400_000, bucketS: 21_600 },
} as const;

export type RangeKey = keyof typeof RANGES;
export const isRangeKey = (k: string): k is RangeKey => k in RANGES;

// [waktu ms (tengah bucket), rata-rata, min, maks] -- nilai MENTAH
export type TrendRow = [number, number, number, number];
