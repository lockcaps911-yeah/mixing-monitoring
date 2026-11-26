import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { authErrorResponse, requireLineAccess } from '@/lib/auth';
import { loadParameterCalibrations } from '@/lib/parameterCalibration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Nilai terakhir semua parameter + state valve satu mesin (untuk initial load dashboard)
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ line: string; machine: string }> },
) {
  try {
    const { line } = await ctx.params;
    await requireLineAccess(line);
  } catch (error) {
    return authErrorResponse(error);
  }
  const { line, machine } = await ctx.params;

  const [params, valves] = await Promise.all([
    pool.query(
      `SELECT p.tag, p.name, p.unit, p.parameter_type,
              CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END AS value,
              r.quality, r.recorded_at
         FROM parameters p
         JOIN machines m ON m.id = p.machine_id
         LEFT JOIN LATERAL (
           SELECT value, quality, recorded_at FROM parameter_readings
            WHERE parameter_id = p.id ORDER BY recorded_at DESC LIMIT 1
         ) r ON TRUE
        WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2) AND p.is_active
          AND (
            lower(m.line_code) <> 'line3'
            OR lower(coalesce(p.data_type, '')) LIKE 'bool%'
            OR p.tag LIKE 'DB2\_%' ESCAPE '\'
          )
        ORDER BY p.id`,
      [line, machine],
    ),
    pool.query(
      `SELECT v.tag, v.name, s.state, s.changed_at, s.updated_at
         FROM valves v
         JOIN machines m ON m.id = v.machine_id
         LEFT JOIN valve_current_states s ON s.valve_id = v.id
        WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2) AND v.is_active
          AND NOT (lower(m.line_code) = 'line3' AND upper(v.tag) LIKE 'XV%')
        ORDER BY v.id`,
      [line, machine],
    ),
  ]);

  let calibration = 'not-used';
  if (line.toLowerCase() === 'line3') {
    calibration = 'not-used-line3';
  } else if (line.toLowerCase() === 'line4') {
    try {
      const calibrations = await loadParameterCalibrations();
      calibration = [...calibrations.values()].some((byType) => byType.size > 0)
        ? 'applied'
        : 'unavailable-raw-values';
    } catch {
      calibration = 'unavailable-raw-values';
    }
  }

  return NextResponse.json({ line, machine, parameters: params.rows, valves: valves.rows, calibration });
}