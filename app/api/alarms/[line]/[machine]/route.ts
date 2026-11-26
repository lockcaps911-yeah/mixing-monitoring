import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { authErrorResponse, requireLineAccess } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = 86_400_000;
const RANGE_MS: Record<string, number | null> = { day: DAY, week: 7 * DAY, month: 30 * DAY, all: null };
const pick = <T extends string>(v: string | null, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);

// GET /api/alarms/line4/mixingL4?status=all|active|cleared&range=day|week|month|all&severity=all|critical|alarm
//                                 &q=PLS&page=1&limit=20&format=csv
export async function GET(req: Request, ctx: { params: Promise<{ line: string; machine: string }> }) {
  try {
    const { line } = await ctx.params;
    await requireLineAccess(line);
  } catch (error) {
    return authErrorResponse(error);
  }
  const { line, machine } = await ctx.params;
  const q = new URL(req.url).searchParams;

  const status = pick(q.get('status'), ['all', 'active', 'cleared'] as const, 'all');
  const severity = pick(q.get('severity'), ['all', 'critical', 'alarm'] as const, 'all');
  const range = pick(q.get('range'), ['day', 'week', 'month', 'all'] as const, 'week');
  const search = /^[\w-]{1,40}$/.test(q.get('q') ?? '') ? (q.get('q') as string) : '';
  const csv = q.get('format') === 'csv';
  const limit = csv ? 5000 : Math.min(Math.max(Number(q.get('limit')) || 20, 1), 100);
  const page = Math.max(Number(q.get('page')) || 1, 1);
  const from = new Date(RANGE_MS[range] === null ? 0 : Date.now() - (RANGE_MS[range] as number));

  // alarm yang masih aktif selalu ikut tampil, apa pun rentang waktunya
  const where = `lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
        AND (a.triggered_at >= $3 OR a.cleared_at IS NULL)
        AND ($4 = 'all' OR a.severity = $4)`;

  const list = await pool.query<{
    id: string; tag: string; description: string | null; severity: 'critical' | 'alarm';
    triggered_at: Date; cleared_at: Date | null; total: string;
  }>(
    `SELECT a.id, a.tag, a.description, a.severity, a.triggered_at, a.cleared_at, count(*) OVER() AS total
       FROM log_alarm a JOIN machines m ON m.id = a.machine_id
      WHERE ${where}
        AND ($5 = 'all' OR ($5 = 'active' AND a.cleared_at IS NULL) OR ($5 = 'cleared' AND a.cleared_at IS NOT NULL))
        AND ($6 = '' OR a.tag ILIKE '%' || $6 || '%')
      ORDER BY a.triggered_at DESC
      LIMIT $7 OFFSET $8`,
    [line, machine, from, severity, status, search, limit, (page - 1) * limit],
  );

  const rows = list.rows.map((r) => ({
    id: r.id, tag: r.tag, description: r.description, severity: r.severity,
    triggeredAt: r.triggered_at.toISOString(), clearedAt: r.cleared_at ? r.cleared_at.toISOString() : null,
  }));

  if (csv) {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = ['waktu_mulai,waktu_selesai,tag,keterangan,tingkat,durasi_detik'];
    for (const r of rows) {
      const end = r.clearedAt ? new Date(r.clearedAt).getTime() : Date.now();
      lines.push([
        r.triggeredAt, r.clearedAt ?? '', esc(r.tag), esc(r.description ?? ''),
        r.severity === 'critical' ? 'E-Stop' : 'Gangguan', Math.round((end - new Date(r.triggeredAt).getTime()) / 1000),
      ].join(','));
    }
    return new Response('\uFEFF' + lines.join('\n'), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="riwayat-alarm-${machine}.csv"` },
    });
  }

  const [sum, top] = await Promise.all([
    pool.query<{ active: string; d1: string; d7: string }>(
      `SELECT count(*) FILTER (WHERE a.cleared_at IS NULL) AS active,
              count(*) FILTER (WHERE a.triggered_at >= now() - interval '24 hours') AS d1,
              count(*) FILTER (WHERE a.triggered_at >= now() - interval '7 days') AS d7
         FROM log_alarm a JOIN machines m ON m.id = a.machine_id
        WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)`,
      [line, machine],
    ),
    pool.query<{ tag: string; description: string | null; n: string }>(
      `SELECT a.tag, max(a.description) AS description, count(*) AS n
         FROM log_alarm a JOIN machines m ON m.id = a.machine_id
        WHERE ${where}
        GROUP BY a.tag ORDER BY n DESC, a.tag LIMIT 5`,
      [line, machine, from, severity],
    ),
  ]);

  return NextResponse.json({
    rows,
    total: Number(list.rows[0]?.total ?? 0),
    summary: { active: Number(sum.rows[0].active), d1: Number(sum.rows[0].d1), d7: Number(sum.rows[0].d7) },
    top: top.rows.map((t) => ({ tag: t.tag, description: t.description, n: Number(t.n) })),
  });
}
