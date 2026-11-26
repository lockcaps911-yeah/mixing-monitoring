import { pool } from '@/lib/db';
import { areaOf, boolRole, isBoolean, isCritical, normalizeType, TYPE_UNIT } from '@/lib/classify';
import type { Point, Snapshot } from '@/lib/types';
import { RANGES, type RangeKey, type TrendRow } from '@/lib/ranges';

export async function getMachines(lineCode?: string | null) {
  const r = await pool.query<{ code: string; line_code: string; name: string }>(
    `SELECT code, line_code, name FROM machines
      WHERE is_active AND ($1::text IS NULL OR lower(line_code) = lower($1))
      ORDER BY id`,
    [lineCode ?? null],
  );
  return r.rows;
}

export async function getProductionLines() {
  const result = await pool.query<{ line_code: string; name: string }>(
    `SELECT line_code, name FROM app_production_lines
      WHERE is_active ORDER BY line_code`,
  );
  return result.rows;
}

export async function getSnapshot(line: string, code: string): Promise<Snapshot | null> {
  const m = await pool.query<{ id: string; code: string; line_code: string; name: string }>(
    `SELECT id, code, line_code, name FROM machines
      WHERE lower(line_code) = lower($1) AND lower(code) = lower($2) AND is_active`,
    [line, code],
  );
  const machine = m.rows[0];
  if (!machine) return null;

  const [ps, vs] = await Promise.all([
    pool.query<{
      tag: string; name: string; description: string | null; unit: string | null;
      parameter_type: string | null; data_type: string | null;
      min_value: number | null; max_value: number | null;
      value: number | null; quality: 'GOOD' | 'BAD' | null; recorded_at: Date | null;
    }>(
      `SELECT p.tag, p.name, p.description, p.unit, p.parameter_type, p.data_type, p.min_value, p.max_value,
              CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END AS value,
              r.quality, r.recorded_at
         FROM parameters p
         JOIN machines m ON m.id = p.machine_id
         LEFT JOIN LATERAL (
           SELECT value, quality, recorded_at FROM parameter_readings
            WHERE parameter_id = p.id ORDER BY recorded_at DESC LIMIT 1
         ) r ON TRUE
        WHERE p.machine_id = $1 AND p.is_active
          AND lower(coalesce(p.parameter_type, '')) <> 'valve'   -- valve dibaca dari tabel valves
          AND (
            lower(m.line_code) <> 'line3'
            OR lower(coalesce(p.data_type, '')) LIKE 'bool%'
            OR p.tag LIKE 'DB2\_%' ESCAPE '\'
          )
        ORDER BY p.id`,
      [machine.id],
    ),
    pool.query<{ tag: string; name: string; description: string | null; state: boolean | null; changed_at: Date | null }>(
      `SELECT v.tag, v.name, v.description, s.state, s.changed_at
         FROM valves v LEFT JOIN valve_current_states s ON s.valve_id = v.id
         JOIN machines m ON m.id = v.machine_id
        WHERE v.machine_id = $1 AND v.is_active
          AND NOT (lower(m.line_code) = 'line3' AND upper(v.tag) LIKE 'XV%')
        ORDER BY v.tag`,
      [machine.id],
    ),
  ]);

  return {
    machine: { code: machine.code, line: machine.line_code, name: machine.name },
    parameters: ps.rows.map((r) => {
      const bool = isBoolean(r.data_type, r.parameter_type);
      const type = bool ? 'other' : normalizeType(r.parameter_type, r.unit, r.tag);
      const area = areaOf(r.tag);
      return {
        tag: r.tag,
        name: r.name,
        label: r.description?.trim() || r.name,
        unit: bool ? '' : r.unit?.trim() || TYPE_UNIT[type],
        type,
        dataType: r.data_type,
        isBool: bool,
        role: bool ? boolRole(r.tag, r.parameter_type) : 'analog',
        area,
        critical: !bool && isCritical(r.tag, type, area),
        value: r.value,
        quality: r.quality,
        at: r.recorded_at ? r.recorded_at.toISOString() : null,
        min: r.min_value,
        max: r.max_value,
      };
    }),
    valves: vs.rows.map((r) => ({
      tag: r.tag,
      name: r.name,
      description: r.description,
      state: r.state,
      changedAt: r.changed_at ? r.changed_at.toISOString() : null,
    })),
  };
}

// Riwayat pendek (nilai MENTAH) untuk mengisi grafik saat halaman dibuka.
export async function getHistory(
  line: string,
  code: string,
  minutes = 10,
  maxPoints = 150,
): Promise<Record<string, Point[]>> {
  const res = await pool.query<{ tag: string; ts: Date; value: number }>(
    `SELECT p.tag, r.recorded_at AS ts,
            CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END AS value
       FROM parameter_readings r
       JOIN parameters p ON p.id = r.parameter_id
       JOIN machines m ON m.id = p.machine_id
      WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
        AND r.recorded_at > now() - make_interval(mins => $3::int)
        AND r.value IS NOT NULL
        AND lower(coalesce(p.data_type, '')) NOT LIKE 'bool%'
      ORDER BY r.recorded_at`,
    [line, code, Math.floor(minutes)],
  );

  const out: Record<string, Point[]> = {};
  for (const r of res.rows) (out[r.tag] ??= []).push([r.ts.getTime(), r.value]);
  for (const tag of Object.keys(out)) {
    if (out[tag].length > maxPoints) out[tag] = out[tag].slice(-maxPoints);
  }
  return out;
}

// Data historis teragregasi (rata-rata, min, maks per bucket) untuk grafik 1 jam .. 1 bulan.
export async function getTrend(
  line: string,
  code: string,
  tags: string[],
  range: RangeKey,
): Promise<Record<string, TrendRow[]>> {
  const { ms, bucketS } = RANGES[range];
  const res = await pool.query<{ tag: string; b: string; avg: number; min: number; max: number }>(
    `SELECT p.tag,
            (floor(extract(epoch FROM r.recorded_at) / $4::float8) * $4::float8)::bigint AS b,
            avg(CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END) AS avg,
            min(CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END) AS min,
            max(CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END) AS max
       FROM parameter_readings r
       JOIN parameters p ON p.id = r.parameter_id
       JOIN machines m ON m.id = p.machine_id
      WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
        AND p.tag = ANY($3::text[])
        AND r.recorded_at >= now() - make_interval(secs => $5::float8)
        AND r.value IS NOT NULL
      GROUP BY p.tag, b
      ORDER BY b`,
    [line, code, tags, bucketS, ms / 1000],
  );

  const out: Record<string, TrendRow[]> = {};
  for (const r of res.rows) {
    (out[r.tag] ??= []).push([(Number(r.b) + bucketS / 2) * 1000, Number(r.avg), Number(r.min), Number(r.max)]);
  }
  return out;
}

// Mengambil daftar parameter analog untuk dropdown filter
export async function getParameters(line: string, code: string) {
  const r = await pool.query<{
    tag: string;
    name: string;
    description: string | null;
    unit: string | null;
    parameter_type: string | null;
    data_type: string | null;
    min_value: number | null;
    max_value: number | null;
  }>(
    `SELECT p.tag, p.name, p.description, p.unit, p.parameter_type, p.data_type, p.min_value, p.max_value
       FROM parameters p
       JOIN machines m ON m.id = p.machine_id
      WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
        AND p.is_active
        AND lower(coalesce(p.parameter_type, '')) <> 'valve'
        AND lower(coalesce(p.data_type, '')) NOT LIKE 'bool%'
        AND (
          lower(m.line_code) <> 'line3'
          OR p.tag LIKE 'DB2\_%' ESCAPE '\'
        )
      ORDER BY p.id`,
    [line, code],
  );
  return r.rows;
}

// Mengambil data log tabel riwayat berdasarkan rentang waktu
export async function getHistoryLog(
  line: string,
  code: string,
  tag: string,
  from?: Date,
  to?: Date,
  limit = 500,
) {
  let query = `
    SELECT r.recorded_at AS ts,
           CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END AS value
      FROM parameter_readings r
      JOIN parameters p ON p.id = r.parameter_id
      JOIN machines m ON m.id = p.machine_id
     WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
       AND p.tag = $3
       AND r.value IS NOT NULL
  `;
  const params: (string | Date | number)[] = [line, code, tag];

  if (from && to) {
    params.push(from, to);
    query += ` AND r.recorded_at >= $4 AND r.recorded_at <= $5`;
  } else if (from) {
    params.push(from);
    query += ` AND r.recorded_at >= $4`;
  }

  params.push(limit);
  query += ` ORDER BY r.recorded_at DESC LIMIT $${params.length}`;

  const res = await pool.query<{ ts: Date; value: number }>(query, params);
  return res.rows;
}
