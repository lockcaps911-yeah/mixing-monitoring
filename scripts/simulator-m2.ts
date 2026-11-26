/**
 * Simulator khusus Line 4 / mixingL4 (parameter SMALLINT + BOOLEAN).
 *
 * Membaca tabel parameters dan tabel valves (machine_id = SIM_MACHINE_ID) lalu membuat nilai
 * berdasarkan kolom parameter_type dan data_type:
 *
 *   data_type   parameter_type                 perilaku
 *   ---------   -----------------------------  --------------------------------------------------
 *   SMALLINT    temperature/pressure/weight/   bilangan bulat, mengikuti siklus batch
 *               conductivity/frequency         (IDLE -> FILL -> HEAT -> MIX -> DISCHARGE)
 *   BOOLEAN     (tabel valves)                 buka/tutup mengikuti fase siklus
 *   BOOLEAN     machine_status (RUN)           1 saat pompa/agitator seharusnya jalan
 *   BOOLEAN     alarm_status (FLT, PLS)        0, sesekali 1 (gangguan acak singkat)
 *   BOOLEAN     alarm_status (BZL/BLZ buzzer)  1 selama ada gangguan atau E-Stop aktif
 *   BOOLEAN     safety_status (ES)             0, sangat jarang 1
 *
 * BOOLEAN dikirim hanya saat berubah + heartbeat berkala (meniru KEPServer "on data change"),
 * supaya tabel parameter_readings tidak membengkak.
 *
 * POST ke: {SIM_TARGET_URL}/api/dataReceiver/insert/{line}/{machine}
 * Jalankan: npm run sim:m2
 */
import { Pool } from 'pg';
import { isLine4MotorFrequencyTag, resolveKepserverTagId } from '../lib/kepserver';
import { line4FrequencyToRawValue } from '../lib/parameterCalibration';

const CONFIGURED_MACHINE_ID = process.env.SIM_MACHINE_ID ? Number(process.env.SIM_MACHINE_ID) : null;
const BASE_URL = (process.env.SIM_TARGET_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 2000);
const HEARTBEAT_MS = Number(process.env.SIM_BOOL_HEARTBEAT_MS ?? 6000); // kirim ulang BOOLEAN walau tidak berubah
const FAULT_CHANCE = Number(process.env.SIM_FAULT_CHANCE ?? 0.002);     // peluang gangguan per tag per kirim; 0 = tanpa gangguan
const RELOAD_MS = 30_000;
const API_KEY = process.env.DATA_RECEIVER_KEY;
const KEPWARE_TAG_PREFIX = process.env.KEPWARE_TAG_PREFIX_LINE4;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const kepserverTagFor = (tag: string, kepserverTag: string | null): string => {
  const resolvedTag = resolveKepserverTagId('line4', tag, { line4: KEPWARE_TAG_PREFIX });
  return isLine4MotorFrequencyTag(tag) ? resolvedTag : kepserverTag || resolvedTag;
};

/* ------------------------------------------------------------------ */
/* Pengaturan nilai SMALLINT (nilai mentah). SESUAIKAN dengan PLC.     */
/* PLC biasanya mengirim nilai berskala, mis. suhu 655 = 65,5 °C.      */
/* ------------------------------------------------------------------ */
const SCALE = {
  temperature: 1,   // kalau PLC mengirim x10, ubah jadi 10
  pressure: 100,    // bar x 100 (0..300 = 0..3,00 bar)
  weight: 1,        // kg
  conductivity: 1,  // µS/cm
  frequency: 1,     // Hz (ubah jadi 10 jika x10)
};
// Batas mentah bila min_value / max_value di database masih NULL
const DEFAULT_RAW: Record<string, [number, number]> = {
  weight: [0, 1000],
  temp_tank: [20, 95],
  temp_other: [20, 95],
  pressure: [0, 300],
  conductivity: [800, 1800],
  freq_pump: [0, 50],
  freq_agit: [0, 50],
  analog_generic: [0, 100],
};

/* ---------------------------- Siklus proses ---------------------------- */
type Phase = { name: string; dur: number; temp: number; weight: number; agit: number; pump: number; press: number };
const PHASES: Phase[] = [
  { name: 'IDLE',      dur: 20, temp: 30, weight: 0,   agit: 0,  pump: 0,  press: 0.1 },
  { name: 'FILL',      dur: 40, temp: 30, weight: 800, agit: 15, pump: 0,  press: 0.2 },
  { name: 'HEAT',      dur: 60, temp: 85, weight: 800, agit: 30, pump: 0,  press: 1.5 },
  { name: 'MIX',       dur: 60, temp: 85, weight: 800, agit: 35, pump: 0,  press: 1.2 },
  { name: 'DISCHARGE', dur: 40, temp: 60, weight: 0,   agit: 20, pump: 40, press: 0.3 },
];
const CYCLE = PHASES.reduce((s, p) => s + p.dur, 0);
const OFFSET: Record<number, number> = { 0: 55, 1: 0, 2: 110 }; // tanki 2 bergeser setengah siklus

function phaseIdx(offsetSec: number): number {
  const t = (Date.now() / 1000 + offsetSec) % CYCLE;
  let acc = 0;
  for (let i = 0; i < PHASES.length; i++) {
    acc += PHASES[i].dur;
    if (t < acc) return i;
  }
  return 0;
}

/* ---------------------------- Klasifikasi tag ---------------------------- */
type Role =
  | 'weight' | 'temp_tank' | 'temp_other' | 'pressure' | 'conductivity'
  | 'freq_pump' | 'freq_agit' | 'analog_generic'
  | 'valve' | 'estop' | 'fault' | 'buzzer' | 'run_pump' | 'run_agit' | 'bool_generic';

const BOOL_TYPES = ['valve', 'alarm_status', 'safety_status', 'machine_status'];

// Tanki mana yang dimiliki sebuah tag: 1, 2, atau 0 (bersama: filter, buffer tank, dst.)
function tankOf(tag: string): 0 | 1 | 2 {
  const g = tag.toUpperCase();
  const m = /^(?:P|LMS|LMX|WM|PT|CT)100([12])/.exec(g);
  if (m) return Number(m[1]) as 1 | 2;
  const tt = /^TT10(\d\d)$/.exec(g);
  if (tt) {
    const n = Number(tt[1]);
    if (n <= 4 || n === 11) return 1;
    if (n >= 5 && n <= 8) return 2;
  }
  return 0;
}

function classify(tag: string, ptype: string, isBool: boolean): Role {
  const g = tag.toUpperCase();
  if (isBool) {
    if (ptype.includes('valve')) return 'valve';
    if (ptype.includes('safety')) return 'estop';
    if (g.startsWith('BZL') || g.startsWith('BLZ')) return 'buzzer';
    if (ptype.includes('alarm')) return 'fault';
    if (ptype.includes('machine')) return g.startsWith('P') ? 'run_pump' : 'run_agit';
    return 'bool_generic';
  }
  if (ptype.includes('weight')) return 'weight';
  if (ptype.includes('press')) return 'pressure';
  if (ptype.includes('cond')) return 'conductivity';
  if (ptype.includes('freq')) return g.startsWith('P') ? 'freq_pump' : 'freq_agit';
  if (ptype.includes('temp')) return g === 'TT1001' || g === 'TT1005' ? 'temp_tank' : 'temp_other';
  return 'analog_generic';
}

const scaleOf = (role: Role): number =>
  role === 'pressure' ? SCALE.pressure
  : role === 'weight' ? SCALE.weight
  : role === 'conductivity' ? SCALE.conductivity
  : role === 'freq_pump' || role === 'freq_agit' ? SCALE.frequency
  : role === 'temp_tank' || role === 'temp_other' ? SCALE.temperature
  : 1;

const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

/* ------------------------------ Model data ------------------------------ */
type Row = {
  tag: string;
  kepserver_tag: string | null;
  parameter_type: string | null;
  data_type: string | null;
  min_value: number | null;
  max_value: number | null;
};

type SimParam = {
  tag: string;
  kepserver_tag: string;
  role: Role;
  isBool: boolean;
  tank: 0 | 1 | 2;
  scale: number;
  lo: number; // batas mentah
  hi: number;
  h: number;
  slot: number;      // fase tempat valve ini terbuka
  valveOff: number;  // offset fase yang dipakai valve ini
  value: number;     // analog: satuan teknik (float) | boolean: 0/1
  faultLeft: number;
  wasActive: boolean;
  lastSent: number | null;
  lastSentAt: number;
};

function build(r: Row, prev?: SimParam): SimParam {
  const ptype = (r.parameter_type ?? '').toLowerCase();
  const isFrequency = isLine4MotorFrequencyTag(r.tag) || ptype.includes('freq');
  const isBool = !isFrequency && (/^bool/i.test(r.data_type ?? '') || BOOL_TYPES.includes(ptype));
  const role = isFrequency
    ? r.tag.toUpperCase().startsWith('P') ? 'freq_pump' : 'freq_agit'
    : classify(r.tag, ptype, isBool);
  const [dlo, dhi] = DEFAULT_RAW[role] ?? [0, 1];
  const h = hash(r.tag);
  return {
    tag: r.tag,
    kepserver_tag: kepserverTagFor(r.tag, r.kepserver_tag),
    role,
    isBool,
    tank: tankOf(r.tag),
    scale: scaleOf(role),
    lo: r.min_value ?? dlo,
    hi: r.max_value ?? dhi,
    h,
    slot: h % PHASES.length,
    valveOff: (Math.floor(h / PHASES.length) % 2) * 110,
    value: prev?.value ?? NaN,
    faultLeft: prev?.faultLeft ?? 0,
    wasActive: prev?.wasActive ?? false,
    lastSent: prev?.lastSent ?? null,
    lastSentAt: prev?.lastSentAt ?? 0,
  };
}

let warnedLegacyValves = false;

async function loadParams(machineId: string, prev: SimParam[]): Promise<SimParam[]> {
  const [ps, vs] = await Promise.all([
    pool.query<Row>(
      `SELECT tag, kepserver_tag, parameter_type, data_type, min_value, max_value
         FROM parameters WHERE machine_id = $1 AND is_active ORDER BY id`,
      [machineId],
    ),
    // Valve ada di tabel sendiri
    pool.query<{ tag: string; kepserver_tag: string | null }>(
      `SELECT tag, kepserver_tag FROM valves WHERE machine_id = $1 AND is_active ORDER BY id`,
      [machineId],
    ),
  ]);

  // Sisa baris valve di tabel parameters (dari INSERT lama) diabaikan
  const isValveType = (r: Row) => (r.parameter_type ?? '').toLowerCase().includes('valve');
  const legacy = ps.rows.filter(isValveType).length;
  if (legacy > 0 && !warnedLegacyValves) {
    warnedLegacyValves = true;
    console.log(`  ! ${legacy} baris bertipe 'valve' di tabel parameters diabaikan (valve dibaca dari tabel valves). Sebaiknya dibersihkan.`);
  }

  const rows: Row[] = [
    ...ps.rows.filter((r) => !isValveType(r)),
    ...vs.rows.map((v) => ({
      tag: v.tag,
      kepserver_tag: kepserverTagFor(v.tag, v.kepserver_tag),
      parameter_type: 'valve',
      data_type: 'BOOLEAN',
      min_value: null,
      max_value: null,
    })),
  ];

  const old = new Map(prev.map((p) => [p.kepserver_tag, p]));
  return rows.map((r) => {
    const kepserverTag = kepserverTagFor(r.tag, r.kepserver_tag);
    return build({ ...r, kepserver_tag: kepserverTag }, old.get(kepserverTag));
  });
}

/* ------------------------------ Pembangkit nilai ------------------------------ */
function analogTarget(p: SimParam, ph: Phase) {
  switch (p.role) {
    case 'weight':       return { t: ph.weight, alpha: 0.06, noise: 1.5 };
    case 'temp_tank':    return { t: ph.temp, alpha: 0.04, noise: 0.3 };
    case 'temp_other':   return { t: Math.max(25, ph.temp - 4 - (p.h % 5) * 3), alpha: 0.03, noise: 0.3 };
    case 'pressure':     return { t: p.tank ? ph.press : 0.5, alpha: 0.08, noise: 0.02 };
    case 'conductivity': return { t: 1200 + (ph.name === 'MIX' ? 250 : 0) + (p.h % 3) * 40, alpha: 0.03, noise: 6 };
    case 'freq_pump':    return { t: ph.pump, alpha: 0.15, noise: 0.15 };
    case 'freq_agit':    return { t: ph.agit, alpha: 0.15, noise: 0.15 };
    default: {
      const span = (p.hi - p.lo) / p.scale;
      return { t: (p.lo / p.scale) + span / 2, alpha: 0.05, noise: span * 0.01 };
    }
  }
}

function stepAll(params: SimParam[]): void {
  // 1) E-Stop dan gangguan dulu, supaya buzzer bisa mengikuti
  let anyAlarm = false;
  for (const p of params) {
    if (p.role !== 'estop' && p.role !== 'fault') continue;
    if (p.faultLeft > 0) {
      p.faultLeft--;
    } else {
      const chance = p.role === 'estop' ? FAULT_CHANCE / 10 : FAULT_CHANCE;
      if (Math.random() < chance) p.faultLeft = 5 + Math.floor(Math.random() * 10);
    }
    p.value = p.faultLeft > 0 ? 1 : 0;
    if (p.value) anyAlarm = true;
    if (p.value && !p.wasActive) console.log(`  ! ${p.role === 'estop' ? 'E-STOP' : 'Gangguan'} aktif: ${p.tag}`);
    p.wasActive = p.value === 1;
  }

  // 2) sisanya
  for (const p of params) {
    if (p.role === 'estop' || p.role === 'fault') continue;
    const phase = PHASES[phaseIdx(OFFSET[p.tank])];

    switch (p.role) {
      case 'valve':
        p.value = phaseIdx(p.valveOff) === p.slot ? 1 : 0;
        break;
      case 'run_pump':
        p.value = phase.pump > 0 ? 1 : 0;
        break;
      case 'run_agit':
        p.value = phase.agit > 0 ? 1 : 0;
        break;
      case 'buzzer':
        p.value = anyAlarm ? 1 : 0;
        break;
      case 'bool_generic':
        if (Number.isNaN(p.value)) p.value = 0;
        if (Math.random() < 0.02) p.value = p.value ? 0 : 1;
        break;
      default: {
        const { t, alpha, noise } = analogTarget(p, phase);
        if (Number.isNaN(p.value)) p.value = t;
        p.value += (t - p.value) * alpha + (Math.random() - 0.5) * 2 * noise;
        if (t === 0 && p.value < noise * 3) p.value = 0;
        if (p.value < 0) p.value = 0;
      }
    }
  }
}

const rawOf = (p: SimParam): number =>
  p.isBool
    ? (p.value ? 1 : 0)
    : p.role === 'freq_pump' || p.role === 'freq_agit'
      ? line4FrequencyToRawValue(p.value)
      : Math.min(p.hi, Math.max(p.lo, Math.round(p.value * p.scale)));

/* ------------------------------ Pengiriman ------------------------------ */
async function send(machine: { code: string; line: string }, params: SimParam[]) {
  stepAll(params);
  const now = Date.now();

  const pending: { p: SimParam; raw: number }[] = [];
  const values: { id: string; v: number; q: boolean; t: number }[] = [];
  for (const p of params) {
    const raw = rawOf(p);
    if (p.isBool && p.lastSent === raw && now - p.lastSentAt < HEARTBEAT_MS) continue; // tidak berubah
    pending.push({ p, raw });
    values.push({ id: p.kepserver_tag, v: raw, q: true, t: now });
  }
  if (values.length === 0) return { sent: 0, analog: 0, error: null as string | null };

  const url = `${BASE_URL}/api/dataReceiver/insert/${machine.line}/${machine.code}`;
  const analog = pending.filter((x) => !x.p.isBool).length;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}) },
      body: JSON.stringify({ timestamp: now, values }),
    });
    if (!res.ok) return { sent: 0, analog: 0, error: `HTTP ${res.status} ${await res.text()}` };

    const body = (await res.json().catch(() => null)) as { unknown?: string[] } | null;
    for (const x of pending) {
      x.p.lastSent = x.raw;
      x.p.lastSentAt = now;
    }
    if (body?.unknown?.length) {
      return { sent: values.length, analog, error: `id tidak dikenali server -> ${body.unknown.slice(0, 5).join(', ')}` };
    }
    return { sent: values.length, analog, error: null };
  } catch (e) {
    return { sent: 0, analog: 0, error: (e as Error).message };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Kode & line mesin dibaca ulang berkala, supaya perubahan machines.code / line_code
// tidak membuat simulator terus mengirim ke alamat lama (404).
async function loadMachine(): Promise<{ id: string; code: string; line: string }> {
  if (CONFIGURED_MACHINE_ID !== null && (!Number.isSafeInteger(CONFIGURED_MACHINE_ID) || CONFIGURED_MACHINE_ID <= 0)) {
    throw new Error('SIM_MACHINE_ID harus berupa ID mesin bilangan bulat positif.');
  }
  const m = await pool.query<{ id: string; code: string; line_code: string }>(
    `SELECT id::text AS id, code, line_code FROM machines
      WHERE ${CONFIGURED_MACHINE_ID === null
        ? "lower(line_code) = 'line4' AND lower(code) = 'mixingl4'"
        : 'id = $1'} AND is_active`,
    CONFIGURED_MACHINE_ID === null ? [] : [CONFIGURED_MACHINE_ID],
  );
  const machine = m.rows[0];
  if (!machine) {
    throw new Error(CONFIGURED_MACHINE_ID === null
      ? 'Mesin aktif line4/mixingL4 tidak ditemukan.'
      : `machine_id ${CONFIGURED_MACHINE_ID} tidak ditemukan atau tidak aktif.`);
  }
  if (machine.line_code.toLowerCase() !== 'line4' || machine.code.toLowerCase() !== 'mixingl4') {
    throw new Error(`SIM_MACHINE_ID harus menunjuk line4/mixingL4, bukan ${machine.line_code}/${machine.code}.`);
  }
  return { id: machine.id, code: machine.code, line: machine.line_code };
}

async function main() {
  let machine = await loadMachine();

  let params = await loadParams(machine.id, []);
  if (params.length === 0) throw new Error(`Tidak ada parameter aktif untuk ${machine.line}/${machine.code}`);

  const summary = new Map<string, number>();
  for (const p of params) summary.set(p.role, (summary.get(p.role) ?? 0) + 1);
  console.log(`Simulator machine_id=${machine.id} (${machine.line}/${machine.code}) -> ${BASE_URL} tiap ${INTERVAL_MS} ms`);
  console.log(`  ${params.length} tag: ${[...summary].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  BOOLEAN dikirim saat berubah + heartbeat ${HEARTBEAT_MS} ms; peluang gangguan ${FAULT_CHANCE}`);

  let lastLoad = Date.now();
  for (;;) {
    const started = Date.now();

    if (started - lastLoad > RELOAD_MS) {
      lastLoad = started;
      try {
        const m2 = await loadMachine();
        if (m2.id !== machine.id || m2.code !== machine.code || m2.line !== machine.line) {
          console.log(`Mesin berubah: ${machine.line}/${machine.code} -> ${m2.line}/${m2.code}`);
          machine = m2;
        }
        const fresh = await loadParams(machine.id, params);
        if (fresh.length !== params.length) console.log(`Daftar tag berubah (${params.length} -> ${fresh.length}), dimuat ulang.`);
        params = fresh;
      } catch (e) {
        console.error('Gagal memuat ulang daftar tag:', (e as Error).message);
      }
    }

    const r = await send(machine, params);
    if (r.error?.startsWith('HTTP 404')) lastLoad = 0; // mesin tidak ditemukan -> baca ulang kode mesin di siklus berikutnya
    const t1 = PHASES[phaseIdx(OFFSET[1])].name;
    const t2 = PHASES[phaseIdx(OFFSET[2])].name;
    console.log(
      `[${new Date().toLocaleTimeString()}] T1=${t1} T2=${t2} | kirim ${r.sent} nilai (${r.analog} analog, ${r.sent - r.analog} boolean) | ${r.error ? 'ERROR ' + r.error : 'ok'}`,
    );
    await sleep(Math.max(0, INTERVAL_MS - (Date.now() - started)));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});