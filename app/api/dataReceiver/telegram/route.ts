import { NextResponse } from 'next/server';
import { sendTelegram, telegramConfig, telegramReady } from '@/lib/telegram';
import { authErrorResponse, hasSameOrigin, requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET  /api/telegram  -> status konfigurasi (tanpa token)
export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }
  const c = telegramConfig();
  return NextResponse.json({ configured: telegramReady(), chats: c.chatIds.length, cooldownMin: c.cooldownMin, notifyCleared: c.notifyCleared });
}

let lastTest = 0;

// POST /api/telegram  -> kirim pesan tes (maks. 1 kali per 20 detik)
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (error) {
    return authErrorResponse(error);
  }
  if (!hasSameOrigin(req)) return NextResponse.json({ ok: false, error: 'Invalid request origin' }, { status: 403 });
  if (!telegramReady()) return NextResponse.json({ ok: false, error: 'Telegram belum dikonfigurasi' }, { status: 400 });
  if (Date.now() - lastTest < 20_000) return NextResponse.json({ ok: false, error: 'Tunggu 20 detik sebelum tes berikutnya' }, { status: 429 });
  lastTest = Date.now();
  const r = await sendTelegram('🔔 <b>Tes notifikasi</b>\nPesan ini dikirim dari dashboard Satoria Mixing Monitor.', 1);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
