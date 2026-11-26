import { bus, type RealtimeMessage } from '@/lib/realtime';
import { subscribeLine4Realtime } from '@/lib/line4Realtime';
import { cookies } from 'next/headers';
import { AUTH_ENABLED, authErrorResponse, hashToken, requireAuthenticatedUser, SESSION_COOKIE } from '@/lib/auth';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type ParameterSnapshotRow = {
  line: string;
  machine: string;
  tag: string;
  value: number | null;
  quality: 'GOOD' | 'BAD' | null;
  recorded_at: Date | string | null;
};

type ValveSnapshotRow = {
  line: string;
  machine: string;
  tag: string;
  state: boolean | null;
  updated_at: Date | string | null;
};

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function getRealtimeSnapshot(
  lineFilter: string | null,
  machineFilter: string | undefined,
): Promise<RealtimeMessage[]> {
  const [parameters, valves] = await Promise.all([
    pool.query<ParameterSnapshotRow>(
      `SELECT m.line_code AS line, m.code AS machine, p.tag,
              CASE WHEN lower(m.line_code) IN ('line3', 'line4') THEN r.value ELSE GREATEST(r.value, 0) END AS value,
              r.quality, r.recorded_at
         FROM machines m
         JOIN parameters p ON p.machine_id = m.id AND p.is_active
         LEFT JOIN LATERAL (
           SELECT value, quality, recorded_at FROM parameter_readings
            WHERE parameter_id = p.id ORDER BY recorded_at DESC LIMIT 1
         ) r ON TRUE
        WHERE m.is_active
          AND ($1::text IS NULL OR lower(m.line_code) = lower($1))
          AND ($2::text IS NULL OR lower(m.code) = lower($2))
          AND lower(coalesce(p.parameter_type, '')) <> 'valve'
          AND (
            lower(m.line_code) <> 'line3'
            OR lower(coalesce(p.data_type, '')) LIKE 'bool%'
            OR p.tag LIKE 'DB2\\_%' ESCAPE '\\'
          )
        ORDER BY m.id, p.id`,
      [lineFilter, machineFilter ?? null],
    ),
    pool.query<ValveSnapshotRow>(
      `SELECT m.line_code AS line, m.code AS machine, v.tag, s.state, s.updated_at
         FROM machines m
         JOIN valves v ON v.machine_id = m.id AND v.is_active
         LEFT JOIN valve_current_states s ON s.valve_id = v.id
        WHERE m.is_active
          AND ($1::text IS NULL OR lower(m.line_code) = lower($1))
          AND ($2::text IS NULL OR lower(m.code) = lower($2))
          AND NOT (lower(m.line_code) = 'line3' AND upper(v.tag) LIKE 'XV%')
        ORDER BY m.id, v.id`,
      [lineFilter, machineFilter ?? null],
    ),
  ]);

  const messages = new Map<string, RealtimeMessage>();
  const getMessage = (line: string, machine: string): RealtimeMessage => {
    const key = `${line.toLowerCase()}/${machine.toLowerCase()}`;
    let message = messages.get(key);
    if (!message) {
      message = {
        line,
        machine,
        ts: '',
        values: {},
        quality: {},
        timestamps: {},
        valves: {},
      };
      messages.set(key, message);
    }
    return message;
  };

  for (const row of parameters.rows) {
    const message = getMessage(row.line, row.machine);
    const timestamp = toIsoString(row.recorded_at);
    if (timestamp) message.timestamps[row.tag] = timestamp;
    if (row.value !== null && Number.isFinite(Number(row.value))) {
      message.values[row.tag] = Number(row.value);
    }
    message.quality[row.tag] = row.quality === 'BAD' ? 'BAD' : 'GOOD';
  }

  for (const row of valves.rows) {
    const message = getMessage(row.line, row.machine);
    const timestamp = toIsoString(row.updated_at);
    if (timestamp) message.timestamps[row.tag] = timestamp;
    if (typeof row.state === 'boolean') message.valves[row.tag] = row.state;
    message.quality[row.tag] = typeof row.state === 'boolean' ? 'GOOD' : 'BAD';
  }

  return [...messages.values()];
}

// SSE: GET /api/realtime/stream            -> semua mesin
//      GET /api/realtime/stream?machine=TK1001
export async function GET(req: Request) {
  let user;
  try {
    user = await requireAuthenticatedUser();
  } catch (error) {
    return authErrorResponse(error);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (AUTH_ENABLED && !token) return Response.json({ error: 'Authentication required' }, { status: 401 });
  const tokenHash = token ? hashToken(token) : null;
  const searchParams = new URL(req.url).searchParams;
  const machineFilter = searchParams.get('machine')?.toLowerCase();
  const useLine4Realtime = searchParams.get('line')?.toLowerCase() === 'line4';
  const lineFilter = user.role === 'ADMIN' ? null : user.lineCode?.toLowerCase() ?? '';
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribeLine4: (() => void) | null = null;
      let snapshotTimer: ReturnType<typeof setInterval> | null = null;
      let snapshotInProgress = false;
      const lastSnapshots = new Map<string, Map<string, string>>();
      const send = (m: RealtimeMessage) => {
        if (closed) return;
        if (lineFilter !== null && m.line.toLowerCase() !== lineFilter) return;
        if (machineFilter && m.machine.toLowerCase() !== machineFilter) return;
        controller.enqueue(enc.encode(`data: ${JSON.stringify(m)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        bus.off('reading', send);
        unsubscribeLine4?.();
        if (snapshotTimer) clearInterval(snapshotTimer);
        clearInterval(ping);
        if (sessionCheck) clearInterval(sessionCheck);
        try { controller.close(); } catch { /* stream sudah tertutup */ }
      };
      if (process.env.VERCEL === '1') {
        const pollSnapshot = async () => {
          if (closed || snapshotInProgress) return;
          snapshotInProgress = true;
          try {
            const messages = await getRealtimeSnapshot(lineFilter, machineFilter);
            for (const message of messages) {
              const key = `${message.line.toLowerCase()}/${message.machine.toLowerCase()}`;
              const previous = lastSnapshots.get(key) ?? new Map<string, string>();
              const current = new Map<string, string>();
              const changed: RealtimeMessage = {
                line: message.line,
                machine: message.machine,
                ts: '',
                values: {},
                quality: {},
                timestamps: {},
                valves: {},
              };
              const tags = new Set([
                ...Object.keys(message.values),
                ...Object.keys(message.quality),
                ...Object.keys(message.timestamps),
                ...Object.keys(message.valves),
              ]);
              for (const tag of tags) {
                const hasValue = Object.hasOwn(message.values, tag);
                const hasValve = Object.hasOwn(message.valves, tag);
                const snapshot = JSON.stringify({
                  hasValue,
                  value: message.values[tag],
                  quality: message.quality[tag],
                  timestamp: message.timestamps[tag],
                  hasValve,
                  valve: message.valves[tag],
                });
                current.set(tag, snapshot);
                if (previous.get(tag) === snapshot) continue;
                if (hasValue) changed.values[tag] = message.values[tag];
                if (hasValve) changed.valves[tag] = message.valves[tag];
                if (Object.hasOwn(message.quality, tag)) changed.quality[tag] = message.quality[tag];
                if (Object.hasOwn(message.timestamps, tag)) changed.timestamps[tag] = message.timestamps[tag];
              }
              lastSnapshots.set(key, current);
              if (
                Object.keys(changed.values).length === 0 &&
                Object.keys(changed.quality).length === 0 &&
                Object.keys(changed.timestamps).length === 0 &&
                Object.keys(changed.valves).length === 0
              ) continue;
              changed.ts = new Date().toISOString();
              send(changed);
            }
          } catch (error) {
            console.error('Failed to poll realtime snapshot', error);
            close();
          } finally {
            snapshotInProgress = false;
          }
        };
        void pollSnapshot();
        snapshotTimer = setInterval(() => void pollSnapshot(), 2000);
      } else if (useLine4Realtime) {
        void subscribeLine4Realtime(send, (error) => {
          console.error('Line 4 realtime stream listener failed', error);
          close();
        }).then((unsubscribe) => {
          if (closed) unsubscribe();
          else unsubscribeLine4 = unsubscribe;
        }).catch((error: unknown) => {
          console.error('Failed to start Line 4 realtime stream', error);
          close();
        });
      } else {
        bus.on('reading', send);
      }

      const ping = setInterval(() => {
        if (!closed) controller.enqueue(enc.encode(': ping\n\n'));
      }, 15000);
      const sessionCheck = AUTH_ENABLED ? setInterval(() => {
        void pool.query<{ role: string; line_code: string | null }>(
          `SELECT u.role, u.line_code
             FROM app_sessions s
             JOIN app_users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
          [tokenHash],
        ).then((result) => {
          const current = result.rows[0];
          if (!current || current.role !== user.role || current.line_code !== user.lineCode) close();
        }).catch((error: unknown) => {
          console.error('Realtime session validation failed', error);
          close();
        });
      }, 15000) : null;

      if (req.signal.aborted) close();
      else req.signal.addEventListener('abort', close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      ...(useLine4Realtime ? { 'X-Accel-Buffering': 'no' } : {}),
    },
  });
}
