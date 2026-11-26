import { bus, type RealtimeMessage } from '@/lib/realtime';
import { subscribeLine4Realtime } from '@/lib/line4Realtime';
import { cookies } from 'next/headers';
import { AUTH_ENABLED, authErrorResponse, hashToken, requireAuthenticatedUser, SESSION_COOKIE } from '@/lib/auth';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
        clearInterval(ping);
        if (sessionCheck) clearInterval(sessionCheck);
        try { controller.close(); } catch { /* stream sudah tertutup */ }
      };
      if (useLine4Realtime) {
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
