// Pengiriman pesan lewat Telegram Bot API. Token hanya dibaca di server (jangan pakai NEXT_PUBLIC_).
const API_BASE = () => (process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org').replace(/\/$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function telegramConfig() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatIds: (process.env.TELEGRAM_CHAT_ID ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    notifyCleared: (process.env.TELEGRAM_NOTIFY_CLEARED ?? 'true') !== 'false',
    cooldownMin: Math.max(0, Math.floor(Number(process.env.TELEGRAM_COOLDOWN_MIN ?? 5)) || 0),
    retryMs: Number(process.env.TELEGRAM_RETRY_MS ?? 2000),
    baseUrl: (process.env.APP_BASE_URL ?? '').replace(/\/$/, ''),
  };
}

export const telegramReady = () => {
  const c = telegramConfig();
  return c.token !== '' && c.chatIds.length > 0;
};

// Pesan memakai parse_mode HTML, jadi teks dari database harus di-escape.
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function postOnce(token: string, chatId: string, text: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${API_BASE()}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    if (res.ok) return null;
    const j = (await res.json().catch(() => null)) as { description?: string } | null;
    return `HTTP ${res.status}${j?.description ? `: ${j.description}` : ''}`;
  } catch (e) {
    const err = e as Error;
    return err.name === 'AbortError' ? 'timeout' : err.message.split(token).join('***');
  } finally {
    clearTimeout(timer);
  }
}

// Mengirim ke semua chat; tiap chat dicoba maksimal `attempts` kali. ok = minimal satu chat berhasil.
export async function sendTelegram(text: string, attempts = 3): Promise<{ ok: boolean; error: string | null }> {
  const { token, chatIds, retryMs } = telegramConfig();
  if (!token || chatIds.length === 0) return { ok: false, error: 'Telegram belum dikonfigurasi' };

  const errors: string[] = [];
  let anyOk = false;
  for (const chat of chatIds) {
    let err: string | null = 'belum dikirim';
    for (let i = 0; i < attempts && err; i++) {
      if (i > 0) await sleep(retryMs * i);
      err = await postOnce(token, chat, text.slice(0, 4000)); // batas Telegram 4096 karakter
    }
    if (err) errors.push(`${chat}: ${err}`);
    else anyOk = true;
  }
  return { ok: anyOk, error: errors.length ? errors.join('; ') : null };
}
