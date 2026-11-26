import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { bus, type RealtimeMessage } from '@/lib/realtime';
import { boolRole } from '@/lib/classify';
import { dispatchAlarmNotifications, type ClosedAlarm, type OpenedAlarm } from '@/lib/alarmNotify';
import { notifyLine4Realtime } from '@/lib/line4Realtime';
import {
  applyParameterCalibration,
  loadParameterCalibrations,
  type ParameterCalibrations,
} from '@/lib/parameterCalibration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Format mengikuti KEPServerEX IoT Gateway (REST Client agent):
// { "timestamp": 1735000000000, "values": [ { "id": "Line1.TK1001.TT1001", "v": 45.5, "q": true, "t": 1735000000000 } ] }
type KepValue = { id: string; v: unknown; q?: boolean; t?: number | string };

type ParamRow = {
  id: string;
  tag: string;
  kepserver_tag: string;
  parameter_type: string | null;
  data_type: string | null;
  description: string | null;
  machine_id: string;
};
type AlarmEvent = { machineId: string; paramId: string; tag: string; description: string | null; severity: 'critical' | 'alarm'; on: boolean; at: Date };

function toDate(t: unknown): Date {
  if (typeof t === 'number') return new Date(t);
  if (typeof t === 'string') {
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function toBool(v: unknown): boolean {
  return v === true || v === 1 || (typeof v === 'string' && ['1', 'true', 'on', 'yes'].includes(v.trim().toLowerCase()));
}

function toLine4Bool(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no'].includes(normalized)) return false;
  return null;
}

function toLine4Number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ line: string; machine: string }> },
) {
  const secret = process.env.DATA_RECEIVER_KEY;
  if (!secret && process.env.NODE_ENV === 'production') {
    console.error('DATA_RECEIVER_KEY must be configured in production.');
    return NextResponse.json({ ok: false, error: 'data receiver is not configured' }, { status: 503 });
  }
  if (secret && req.headers.get('x-api-key') !== secret) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { line, machine } = await ctx.params;
  const isLine3 = line.trim().toLowerCase() === 'line3';
  const isLine4 = line.trim().toLowerCase() === 'line4';

  let body: { values?: KepValue[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  const values = Array.isArray(body?.values) ? body.values : [];
  if (values.length === 0) {
    return NextResponse.json({ ok: false, error: '"values" kosong' }, { status: 400 });
  }

  let calibrations: ParameterCalibrations = new Map();
  let calibrationAvailable = false;
  if (isLine4) {
    try {
      calibrations = await loadParameterCalibrations();
      calibrationAvailable = [...calibrations.values()].some((byType) => byType.size > 0);
    } catch (error) {
      calibrationAvailable = false;
      console.error('[dataReceiver] gagal memuat kalibrasi Line 4:', error);
    }
  }

  const [paramRes, valveRes] = await Promise.all([
    pool.query<ParamRow>(
      `SELECT p.id, p.tag, p.kepserver_tag, p.parameter_type, p.data_type, p.description, m.id AS machine_id
         FROM parameters p JOIN machines m ON m.id = p.machine_id
        WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
          AND m.is_active AND p.is_active
          AND (
            lower(m.line_code) <> 'line3'
            OR lower(coalesce(p.data_type, '')) LIKE 'bool%'
            OR p.tag LIKE 'DB2\_%' ESCAPE '\'
          )`,
      [line, machine],
    ),
    pool.query<{ id: string; tag: string; kepserver_tag: string }>(
      `SELECT v.id, v.tag, v.kepserver_tag
         FROM valves v JOIN machines m ON m.id = v.machine_id
        WHERE lower(m.line_code) = lower($1) AND lower(m.code) = lower($2)
           AND m.is_active AND v.is_active
           AND NOT (lower(m.line_code) = 'line3' AND upper(v.tag) LIKE 'XV%')`,
      [line, machine],
    ),
  ]);

  if (paramRes.rowCount === 0 && valveRes.rowCount === 0) {
    return NextResponse.json({ ok: false, error: `mesin ${line}/${machine} tidak ditemukan` }, { status: 404 });
  }

  // Cocokkan berdasarkan kepserver_tag, variasi format underscore, atau tag pendek (mis. TT1001)
  const paramMap = new Map<string, ParamRow>();
  for (const p of paramRes.rows) {
    if (p.kepserver_tag) {
      paramMap.set(p.kepserver_tag, p);
      paramMap.set(p.kepserver_tag.toLowerCase(), p);
      paramMap.set(p.kepserver_tag.replace(/\./g, '_'), p);
      paramMap.set(p.kepserver_tag.replace(/\./g, '_').toLowerCase(), p);
    }
    if (p.tag) {
      paramMap.set(p.tag, p);
      paramMap.set(p.tag.toLowerCase(), p);
    }
  }
  const valveMap = new Map<string, { id: string; tag: string }>();
  for (const v of valveRes.rows) {
    if (v.kepserver_tag) {
      valveMap.set(v.kepserver_tag, v);
      valveMap.set(v.kepserver_tag.toLowerCase(), v);
      valveMap.set(v.kepserver_tag.replace(/\./g, '_'), v);
      valveMap.set(v.kepserver_tag.replace(/\./g, '_').toLowerCase(), v);
    }
    if (v.tag) {
      valveMap.set(v.tag, v);
      valveMap.set(v.tag.toLowerCase(), v);
    }
  }

  const pIds: string[] = [];
  const pTimes: Date[] = [];
  const pVals: number[] = [];
  const pQual: string[] = [];
  const vRows: { id: string; state: boolean; at: Date }[] = [];
  const alarmEvents: AlarmEvent[] = [];
  const opened: OpenedAlarm[] = [];   // kejadian alarm BARU (untuk notifikasi)
  const closed: ClosedAlarm[] = [];   // kejadian yang baru padam
  const unknown: string[] = [];
  const msg: RealtimeMessage = {
    line,
    machine,
    ts: new Date().toISOString(),
    values: {},
    quality: {},
    timestamps: {},
    valves: {},
  };

  for (const item of values) {
    const at = toDate(item.t);
    const rawId = String(item.id || '');
    const suffixDot = rawId.includes('.') ? rawId.split('.').pop()! : '';
    const suffixUnderscore = rawId.includes('_') ? rawId.split('_').pop()! : '';

    const p =
      paramMap.get(rawId) ||
      paramMap.get(rawId.toLowerCase()) ||
      (suffixDot ? paramMap.get(suffixDot) || paramMap.get(suffixDot.toLowerCase()) : null) ||
      (suffixUnderscore ? paramMap.get(suffixUnderscore) || paramMap.get(suffixUnderscore.toLowerCase()) : null);

    if (p) {
      const line4Value = isLine4 ? toLine4Number(item.v) : null;
      const valueQuality = item.q === false ? 'BAD' : 'GOOD';
      if (isLine4) {
        msg.quality[p.tag] = line4Value === null ? 'BAD' : valueQuality;
        msg.timestamps[p.tag] = at.toISOString();
      }
      const rawValue = isLine4 ? line4Value : Number(item.v);
      if (rawValue === null) continue;
      if (!Number.isFinite(rawValue)) continue;
      const num = applyParameterCalibration(line, rawValue, p.tag, p.parameter_type, calibrations);
      pIds.push(p.id);
      pTimes.push(at);
      pVals.push(num);
      pQual.push(valueQuality);
      msg.values[p.tag] = num;
      msg.quality[p.tag] = valueQuality;
      msg.timestamps[p.tag] = at.toISOString();

      // Sinyal alarm / E-Stop -> catat kejadian (data berkualitas BAD diabaikan)
      const role = boolRole(p.tag, p.parameter_type);
      if ((role === 'fault' || role === 'estop') && item.q !== false) {
        alarmEvents.push({
          machineId: p.machine_id, paramId: p.id, tag: p.tag, description: p.description,
          severity: role === 'estop' ? 'critical' : 'alarm', on: num > 0, at,
        });
      }
      continue;
    }

    const v =
      valveMap.get(rawId) ||
      valveMap.get(rawId.toLowerCase()) ||
      (suffixDot ? valveMap.get(suffixDot) || valveMap.get(suffixDot.toLowerCase()) : null) ||
      (suffixUnderscore ? valveMap.get(suffixUnderscore) || valveMap.get(suffixUnderscore.toLowerCase()) : null);

    if (v) {
      if (item.q === false) {
        if (isLine3 || isLine4) {
          msg.quality[v.tag] = 'BAD';
          msg.timestamps[v.tag] = at.toISOString();
        }
        continue;
      }
      const line4State = isLine4 ? toLine4Bool(item.v) : null;
      if (isLine4 && line4State === null) {
        msg.quality[v.tag] = 'BAD';
        msg.timestamps[v.tag] = at.toISOString();
        continue;
      }
      const state = isLine4 ? line4State! : toBool(item.v);
      vRows.push({ id: v.id, state, at });
      msg.valves[v.tag] = state;
      if (isLine3 || isLine4) {
        msg.quality[v.tag] = 'GOOD';
        msg.timestamps[v.tag] = at.toISOString();
      }
      continue;
    }
    unknown.push(item.id);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (pIds.length) {
      await client.query(
        `INSERT INTO parameter_readings (parameter_id, recorded_at, value, quality)
         SELECT * FROM unnest($1::bigint[], $2::timestamptz[], $3::float8[], $4::text[])
         ON CONFLICT DO NOTHING`,
        [pIds, pTimes, pVals, pQual],
      );
    }

    if (isLine4 && vRows.length > 0) {
      const latestByValve = new Map<string, { state: boolean; at: Date }>();
      for (const valve of vRows) latestByValve.set(valve.id, valve);
      const rows = [...latestByValve.entries()];

      await client.query(
        `INSERT INTO valve_current_states (valve_id, state, changed_at, updated_at)
         SELECT valve_id, state, recorded_at, recorded_at
           FROM unnest($1::bigint[], $2::boolean[], $3::timestamptz[])
                AS incoming(valve_id, state, recorded_at)
         ON CONFLICT (valve_id) DO UPDATE SET
           changed_at = CASE WHEN valve_current_states.state IS DISTINCT FROM EXCLUDED.state
                             THEN EXCLUDED.changed_at
                             ELSE valve_current_states.changed_at END,
           state      = EXCLUDED.state,
           updated_at = EXCLUDED.updated_at`,
        [
          rows.map(([id]) => id),
          rows.map(([, valve]) => valve.state),
          rows.map(([, valve]) => valve.at),
        ],
      );
    } else {
      for (const v of vRows) {
        await client.query(
          `INSERT INTO valve_current_states (valve_id, state, changed_at, updated_at)
           VALUES ($1, $2, $3, $3)
           ON CONFLICT (valve_id) DO UPDATE SET
             changed_at = CASE WHEN valve_current_states.state IS DISTINCT FROM EXCLUDED.state
                               THEN EXCLUDED.changed_at
                               ELSE valve_current_states.changed_at END,
             state      = EXCLUDED.state,
             updated_at = EXCLUDED.updated_at`,
          [v.id, v.state, v.at],
        );
      }
    }

    // Riwayat alarm: 0 -> 1 membuka kejadian baru, 1 -> 0 menutup kejadian yang aktif.
    for (const a of alarmEvents) {
      if (a.on) {
        const ins = await client.query<{ id: string }>(
          `INSERT INTO log_alarm (machine_id, parameter_id, tag, description, severity, triggered_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (parameter_id) WHERE cleared_at IS NULL DO NOTHING
           RETURNING id`,
          [a.machineId, a.paramId, a.tag, a.description, a.severity, a.at],
        );
        // baris dikembalikan hanya bila kejadian benar-benar baru (bukan kiriman ulang)
        if (ins.rows[0]) opened.push({ id: ins.rows[0].id, tag: a.tag, description: a.description, severity: a.severity, at: a.at });
      } else {
        const upd = await client.query<{ id: string; tag: string; description: string | null; severity: 'critical' | 'alarm'; triggered_at: Date; cleared_at: Date; notified_at: Date | null }>(
          `UPDATE log_alarm SET cleared_at = GREATEST($2::timestamptz, triggered_at)
            WHERE parameter_id = $1 AND cleared_at IS NULL
            RETURNING id, tag, description, severity, triggered_at, cleared_at, notified_at`,
          [a.paramId, a.at],
        );
        for (const r of upd.rows) {
          closed.push({ id: r.id, tag: r.tag, description: r.description, severity: r.severity, at: r.triggered_at, clearedAt: r.cleared_at, notified: r.notified_at !== null });
        }
      }
    }

    if (isLine4 && process.env.VERCEL !== '1') await notifyLine4Realtime(client, msg);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[dataReceiver] gagal simpan', err);
    return NextResponse.json({ ok: false, error: 'db error' }, { status: 500 });
  } finally {
    client.release();
  }

  // Notifikasi Telegram dikirim di latar belakang: kegagalan jaringan tidak boleh menunda atau menggagalkan receiver.
  if (opened.length || closed.length) {
    void dispatchAlarmNotifications({ line, code: machine }, opened, closed).catch((e) => console.error('[telegram]', e));
  }

  bus.emit('reading', msg);

  return NextResponse.json({
    ok: true,
    line,
    machine,
    parameters: pIds.length,
    alarmSignals: alarmEvents.length,
    valves: vRows.length,
    calibration: isLine3
      ? 'not-used-line3'
      : isLine4
        ? calibrationAvailable ? 'applied' : 'unavailable-raw-values'
        : 'not-used',
    unknown,
  });
}
