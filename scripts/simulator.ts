/**
 * Simulator data acak (random walk) untuk menggantikan PLC/KEPServer sementara.
 * Tidak memakai parameter_type, min_value, maupun max_value dari database.
 * Rentang nilai ditentukan dari awalan tag (TT, WM, PT, CT, AG, P).
 *
 * - Daftar parameter/valve dimuat ulang otomatis tiap 30 detik (tidak perlu restart
 *   setelah mengubah tabel parameters/valves).
 * - Jika server menolak id tag tertentu, id itu ditampilkan di log.
 *
 * POST ke: {SIM_TARGET_URL}/api/dataReceiver/insert/{line}/{machine}
 * Jalankan: npm run sim
 */
import { Pool } from 'pg';

const BASE_URL = (process.env.SIM_TARGET_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 2000);
const RELOAD_MS = 30_000;
const API_KEY = process.env.DATA_RECEIVER_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Range = { lo: number; hi: number; digits: number };

// Ubah angka di sini kalau ingin rentang lain.
function rangeFor(tag: string): Range {
  const t = tag.toUpperCase();
  if (t.startsWith('TT')) return { lo: 20, hi: 95, digits: 1 };    // suhu °C
  if (t.startsWith('WM')) return { lo: 0, hi: 1000, digits: 1 };   // berat kg
  if (t.startsWith('PT')) return { lo: 0, hi: 3, digits: 2 };      // tekanan bar
  if (t.startsWith('CT')) return { lo: 800, hi: 1800, digits: 0 }; // konduktivitas µS/cm
  if (t.startsWith('AG') || /^P\d/.test(t)) return { lo: 0, hi: 50, digits: 1 }; // frekuensi Hz
  return { lo: 0, hi: 100, digits: 1 };
}

type SimParam = { tag: string; kepserver_tag: string; range: Range; value: number };
type SimValve = { tag: string; kepserver_tag: string; state: boolean };
type SimMachine = { code: string; line: string; params: SimParam[]; valves: SimValve[] };

async function loadMachines(): Promise<SimMachine[]> {
  const ms = await pool.query(`SELECT id, code, line_code FROM machines WHERE is_active AND id <> 2 ORDER BY id`);
  const out: SimMachine[] = [];

  for (const m of ms.rows) {
    const ps = await pool.query(
      `SELECT tag, kepserver_tag FROM parameters WHERE machine_id = $1 AND is_active ORDER BY id`,
      [m.id],
    );
    const vs = await pool.query(
      `SELECT tag, kepserver_tag FROM valves WHERE machine_id = $1 AND is_active ORDER BY id`,
      [m.id],
    );

    out.push({
      code: m.code,
      line: m.line_code,
      params: ps.rows.map((r) => {
        const range = rangeFor(r.tag);
        return {
          tag: r.tag,
          kepserver_tag: r.kepserver_tag,
          range,
          value: range.lo + Math.random() * (range.hi - range.lo), // nilai awal acak
        };
      }),
      valves: vs.rows.map((r) => ({ tag: r.tag, kepserver_tag: r.kepserver_tag, state: Math.random() < 0.5 })),
    });
  }
  return out;
}

// Muat ulang dari DB, tapi pertahankan nilai terakhir supaya grafik tidak melompat.
async function reload(old: SimMachine[]): Promise<SimMachine[]> {
  const fresh = await loadMachines();
  for (const m of fresh) {
    const prev = old.find((o) => o.line === m.line && o.code === m.code);
    if (!prev) continue;
    for (const p of m.params) {
      const o = prev.params.find((x) => x.kepserver_tag === p.kepserver_tag);
      if (o) p.value = o.value;
    }
    for (const v of m.valves) {
      const o = prev.valves.find((x) => x.kepserver_tag === v.kepserver_tag);
      if (o) v.state = o.state;
    }
  }
  return fresh;
}

const signature = (ms: SimMachine[]) =>
  ms.map((m) => `${m.line}/${m.code}:${m.params.map((p) => p.kepserver_tag).join(',')}|${m.valves.map((v) => v.kepserver_tag).join(',')}`).join(';');

function step(m: SimMachine) {
  for (const p of m.params) {
    const { lo, hi } = p.range;
    const delta = (Math.random() - 0.5) * (hi - lo) * 0.06; // geser maks. 3% dari rentang
    p.value = Math.min(hi, Math.max(lo, p.value + delta));
  }
  for (const v of m.valves) {
    if (Math.random() < 0.03) v.state = !v.state; // sesekali berubah on/off
  }
}

async function sendMachine(m: SimMachine): Promise<string | null> {
  step(m);
  const now = Date.now();
  const values = [
    ...m.params.map((p) => ({
      id: p.kepserver_tag,
      v: Number(p.value.toFixed(p.range.digits)),
      q: true,
      t: now,
    })),
    ...m.valves.map((v) => ({ id: v.kepserver_tag, v: v.state ? 1 : 0, q: true, t: now })),
  ];

  const url = `${BASE_URL}/api/dataReceiver/insert/${m.line}/${m.code}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
      body: JSON.stringify({ timestamp: now, values }),
    });
    if (!res.ok) return `${m.line}/${m.code}: HTTP ${res.status} ${await res.text()}`;

    const body = (await res.json().catch(() => null)) as { unknown?: string[] } | null;
    if (body?.unknown?.length) {
      return `${m.line}/${m.code}: id tidak dikenali server -> ${body.unknown.join(', ')}`;
    }
    return null;
  } catch (e) {
    return `${m.line}/${m.code}: ${(e as Error).message}`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let machines = await loadMachines();
  if (machines.length === 0) throw new Error('Tabel machines kosong.');

  console.log(`Simulator acak start -> ${BASE_URL} tiap ${INTERVAL_MS} ms`);
  for (const m of machines) {
    console.log(`  ${m.line}/${m.code}: ${m.params.length} parameter, ${m.valves.length} valve`);
    console.log(`     parameter: ${m.params.map((p) => p.kepserver_tag).join(', ') || '(kosong)'}`);
  }

  let lastLoad = Date.now();
  for (;;) {
    const started = Date.now();

    if (started - lastLoad > RELOAD_MS) {
      lastLoad = started;
      try {
        const fresh = await reload(machines);
        if (signature(fresh) !== signature(machines)) console.log('Daftar tag berubah di database, dimuat ulang.');
        machines = fresh;
      } catch (e) {
        console.error('Gagal memuat ulang daftar tag:', (e as Error).message);
      }
    }

    const errors = (await Promise.all(machines.map(sendMachine))).filter(Boolean);
    console.log(`[${new Date().toLocaleTimeString()}] ${errors.length ? 'ERROR ' + errors.join(' | ') : 'ok'}`);
    await sleep(Math.max(0, INTERVAL_MS - (Date.now() - started)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});