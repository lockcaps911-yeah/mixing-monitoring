import { pool } from '@/lib/db';
import { esc, sendTelegram, telegramConfig, telegramReady } from '@/lib/telegram';

export type OpenedAlarm = { id: string; tag: string; description: string | null; severity: 'critical' | 'alarm'; at: Date };
export type ClosedAlarm = OpenedAlarm & { clearedAt: Date; notified: boolean };
type Machine = { line: string; code: string };

const MAX_LINES = 12; // batas daftar dalam satu pesan

const fmt = (d: Date) =>
  d.toLocaleString('id-ID', {
    timeZone: process.env.APP_TIMEZONE ?? 'Asia/Jakarta',
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });

function dur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} detik`;
  if (s < 3600) return `${Math.floor(s / 60)} menit ${s % 60} detik`;
  return `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`;
}

function footer(m: Machine) {
  const base = telegramConfig().baseUrl;
  return base ? `\n\n<a href="${esc(`${base}/dashboard/${m.line}/${m.code}/alarms`)}">Buka riwayat alarm</a>` : '';
}

function listOf<T>(items: T[], line: (x: T) => string) {
  const shown = items.slice(0, MAX_LINES).map(line).join('\n');
  return items.length > MAX_LINES ? `${shown}\n... dan ${items.length - MAX_LINES} lainnya` : shown;
}

export function openedMessage(m: Machine, list: OpenedAlarm[]) {
  const head =
    list.length > 1 ? `🚨 <b>${list.length} ALARM BARU</b>`
    : list[0].severity === 'critical' ? '🛑 <b>E-STOP AKTIF</b>' : '🚨 <b>ALARM AKTIF</b>';
  const body = listOf(list, (a) =>
    `• <b>${esc(a.tag)}</b>${a.severity === 'critical' ? ' (E-Stop)' : ''}\n  ${esc(a.description ?? '-')}\n  ${fmt(a.at)}`);
  return `${head}\nMesin: <b>${esc(m.code)}</b> (${esc(m.line)})\n\n${body}${footer(m)}`;
}

export function closedMessage(m: Machine, list: ClosedAlarm[]) {
  const head = list.length > 1 ? `✅ <b>${list.length} ALARM KEMBALI NORMAL</b>` : '✅ <b>ALARM KEMBALI NORMAL</b>';
  const body = listOf(list, (a) =>
    `• <b>${esc(a.tag)}</b>\n  ${esc(a.description ?? '-')}\n  Durasi ${dur(a.clearedAt.getTime() - a.at.getTime())}`);
  return `${head}\nMesin: <b>${esc(m.code)}</b> (${esc(m.line)})\n\n${body}${footer(m)}`;
}

// Dipanggil receiver SETELAH data tersimpan. Tidak boleh melempar error ke receiver.
export async function dispatchAlarmNotifications(machine: Machine, opened: OpenedAlarm[], closed: ClosedAlarm[]) {
  if (!telegramReady()) return;
  const cfg = telegramConfig();

  if (opened.length) {
    // Tahan alarm yang tag-nya sudah dikirim dalam masa cooldown (mencegah banjir pesan saat alarm naik-turun)
    const free = await pool.query<{ id: string }>(
      `SELECT a.id FROM log_alarm a
        WHERE a.id = ANY($1::bigint[])
          AND NOT EXISTS (SELECT 1 FROM log_alarm b
                           WHERE b.parameter_id = a.parameter_id AND b.id <> a.id
                             AND b.notified_at > now() - make_interval(mins => $2::int))`,
      [opened.map((o) => o.id), cfg.cooldownMin],
    );
    const ok = new Set(free.rows.map((r) => r.id));
    const held = opened.filter((o) => !ok.has(o.id));
    const toSend = opened.filter((o) => ok.has(o.id));

    if (held.length) {
      await pool.query(`UPDATE log_alarm SET notify_error = 'ditahan (cooldown)' WHERE id = ANY($1::bigint[])`, [held.map((h) => h.id)]);
    }
    if (toSend.length) {
      const r = await sendTelegram(openedMessage(machine, toSend));
      await pool.query(
        `UPDATE log_alarm SET notified_at = CASE WHEN $2::boolean THEN now() END, notify_error = $3 WHERE id = ANY($1::bigint[])`,
        [toSend.map((s) => s.id), r.ok, r.error],
      );
      if (!r.ok) console.error('[telegram] gagal kirim alarm:', r.error);
    }
  }

  // Pesan "kembali normal" hanya untuk alarm yang sebelumnya benar-benar terkirim
  const back = closed.filter((c) => c.notified);
  if (cfg.notifyCleared && back.length) {
    const r = await sendTelegram(closedMessage(machine, back));
    if (!r.ok) console.error('[telegram] gagal kirim pesan normal:', r.error);
  }
}
