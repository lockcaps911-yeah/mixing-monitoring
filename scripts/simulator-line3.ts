/**
 * Simulator khusus Line 3 untuk uji dashboard sebelum KEPServerEX terhubung.
 * Tag dibaca dari konfigurasi aktif Line 3; nilai yang dihasilkan adalah data
 * demo, bukan pembacaan atau urutan proses PLC yang sudah diverifikasi.
 *
 * Jalankan: npm run sim
 */
import { Pool } from 'pg';
import { LINE3_TANK_TAGS } from '../lib/mimic/line3TankTags';

const BASE_URL = (process.env.SIM_TARGET_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 2000);
const API_KEY = process.env.DATA_RECEIVER_KEY;
const RELOAD_MS = 30_000;
const SIMULATED_ALARM_TAGS = [
  'T1_Steam_Press_High',
  'T2_Steam_Press_High',
  'T1_Press_High_Limit',
  'T2_Press_High_Limit',
  'T1_Press_High_Alarm',
  'T2_Press_High_Alarm',
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type MachineRow = { id: number; code: string; line_code: string };
type ParameterRow = {
  tag: string;
  kepserver_tag: string | null;
  parameter_type: string | null;
  data_type: string | null;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
};
type ValveRow = { tag: string; kepserver_tag: string | null };
type Range = { min: number; max: number; digits: number };
type SimParameter = ParameterRow & { kepserver_tag: string; range: Range; value: number };
type SimValve = { tag: string; kepserver_tag: string; state: boolean };
type SimMachine = { id: number; code: string; line: string; params: SimParameter[]; valves: SimValve[] };
type ProcessPhase = {
  name: string;
  duration: number;
  temperature: number;
  weight: number;
  conductivity: number;
  pressure: number;
  agitatorRpm: number;
};

const SENSOR_TAGS = [...LINE3_TANK_TAGS.sensors.T1, ...LINE3_TANK_TAGS.sensors.T2];
const VALVE_TAGS = [...LINE3_TANK_TAGS.valves.T1, ...LINE3_TANK_TAGS.valves.T2];
const PARAMETER_TAGS = [...SENSOR_TAGS, ...SIMULATED_ALARM_TAGS];
const PHASES: ProcessPhase[] = [
  { name: 'IDLE', duration: 20, temperature: 30, weight: 0, conductivity: 900, pressure: 0.1, agitatorRpm: 0 },
  { name: 'FILL', duration: 40, temperature: 30, weight: 800, conductivity: 1000, pressure: 0.2, agitatorRpm: 0 },
  { name: 'HEAT', duration: 60, temperature: 80, weight: 800, conductivity: 1100, pressure: 1.3, agitatorRpm: 600 },
  { name: 'MIX', duration: 60, temperature: 80, weight: 800, conductivity: 1450, pressure: 1.1, agitatorRpm: 900 },
  { name: 'DISCHARGE', duration: 40, temperature: 60, weight: 0, conductivity: 1350, pressure: 0.3, agitatorRpm: 300 },
];
const CYCLE_SECONDS = PHASES.reduce((total, phase) => total + phase.duration, 0);

function defaultRange(parameter: ParameterRow): Range {
  const type = (parameter.parameter_type ?? '').toLowerCase();
  const tag = parameter.tag.toUpperCase();
  if (type.includes('temperature') || tag.includes('_TT')) return { min: 20, max: 95, digits: 1 };
  if (type.includes('weight') || tag.includes('_WM')) return { min: 0, max: 1000, digits: 1 };
  if (type.includes('pressure') || tag.includes('_PT')) return { min: 0, max: 3, digits: 2 };
  if (type.includes('conductivity') || tag.includes('_CE')) return { min: 800, max: 1800, digits: 1 };
  if (type.includes('frequency') || tag.includes('_MS')) {
    return parameter.unit?.trim().toLowerCase() === 'rpm'
      ? { min: 0, max: 1800, digits: 1 }
      : { min: 0, max: 50, digits: 1 };
  }
  throw new Error(`Jenis sensor Line 3 tidak dikenali untuk ${parameter.tag}.`);
}

function rangeFor(parameter: ParameterRow): Range {
  const fallback = defaultRange(parameter);
  const min = parameter.min_value;
  const max = parameter.max_value;
  if (min === null || max === null) return fallback;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
    throw new Error(`Rentang database tidak valid untuk ${parameter.tag}: ${min}..${max}.`);
  }
  return { ...fallback, min, max };
}

function assertTags(label: string, expected: string[], actual: string[]): void {
  const actualSet = new Set(actual);
  const missing = expected.filter((tag) => !actualSet.has(tag));
  if (missing.length > 0) {
    throw new Error(`${label} Line 3 belum lengkap/nonaktif di database: ${missing.join(', ')}`);
  }
  if (actualSet.size !== actual.length) throw new Error(`${label} Line 3 memiliki tag duplikat di database.`);
}

async function loadMachine(previous: SimMachine | null = null): Promise<SimMachine> {
  const machineResult = await pool.query<MachineRow>(
    `SELECT id, code, line_code
       FROM machines
      WHERE is_active AND lower(line_code) = 'line3' AND lower(code) = 'mixingl3'`,
  );
  if (machineResult.rowCount !== 1) {
    throw new Error('Mesin aktif line3/mixingL3 tidak ditemukan atau tidak unik; periksa migrasi Line 3.');
  }
  const machine = machineResult.rows[0];
  const [parameterResult, valveResult] = await Promise.all([
    pool.query<ParameterRow>(
      `SELECT tag, kepserver_tag, parameter_type, data_type, unit, min_value, max_value
         FROM parameters
        WHERE machine_id = $1 AND is_active AND tag = ANY($2::text[])
        ORDER BY id`,
      [machine.id, PARAMETER_TAGS],
    ),
    pool.query<ValveRow>(
      `SELECT tag, kepserver_tag
         FROM valves
        WHERE machine_id = $1 AND is_active AND tag = ANY($2::text[])
        ORDER BY id`,
      [machine.id, VALVE_TAGS],
    ),
  ]);
  assertTags('Parameter/sensor', PARAMETER_TAGS, parameterResult.rows.map((row) => row.tag));
  assertTags('Valve', VALVE_TAGS, valveResult.rows.map((row) => row.tag));

  const parameters = parameterResult.rows.map((row): SimParameter => {
    if (!row.kepserver_tag?.trim()) throw new Error(`kepserver_tag kosong untuk ${row.tag}.`);
    const isAlarm = SIMULATED_ALARM_TAGS.includes(row.tag);
    if (isAlarm !== /^bool/i.test(row.data_type ?? '')) {
      throw new Error(`data_type ${row.tag} tidak sesuai dengan tipe tag Line 3 yang diharapkan.`);
    }
    const range = isAlarm ? { min: 0, max: 1, digits: 0 } : rangeFor(row);
    const priorValue = previous?.params.find((item) => item.tag === row.tag)?.value;
    return {
      ...row,
      kepserver_tag: row.kepserver_tag,
      range,
      value: priorValue ?? (range.min + range.max) / 2,
    };
  });
  const valves = valveResult.rows.map((row): SimValve => {
    if (!row.kepserver_tag?.trim()) throw new Error(`kepserver_tag kosong untuk ${row.tag}.`);
    return {
      tag: row.tag,
      kepserver_tag: row.kepserver_tag,
      state: previous?.valves.find((valve) => valve.tag === row.tag)?.state ?? false,
    };
  });
  const kepserverIds = [...parameters, ...valves].map((item) => item.kepserver_tag);
  if (new Set(kepserverIds).size !== kepserverIds.length) {
    throw new Error('Ada kepserver_tag duplikat pada konfigurasi Line 3.');
  }

  return { id: machine.id, code: machine.code, line: machine.line_code, params: parameters, valves };
}

function phaseAt(seconds: number, tank: 1 | 2): ProcessPhase {
  const elapsed = (seconds + (tank === 2 ? 110 : 0)) % CYCLE_SECONDS;
  let end = 0;
  for (const phase of PHASES) {
    end += phase.duration;
    if (elapsed < end) return phase;
  }
  return PHASES[0];
}

function phaseIndex(phase: ProcessPhase): number {
  return PHASES.indexOf(phase);
}

function targetFor(parameter: SimParameter, phase: ProcessPhase): number {
  const tag = parameter.tag.toUpperCase();
  if (SIMULATED_ALARM_TAGS.includes(parameter.tag)) return 0;
  if (tag.includes('_CE')) return phase.conductivity;
  if (tag.includes('_WM')) return phase.weight;
  if (tag.includes('_MS')) return phase.agitatorRpm;
  if (tag.includes('_PT')) return phase.pressure;
  if (tag.includes('_TT')) {
    const sensorIndex = Number(tag.slice(-2));
    return phase.temperature - Math.max(0, sensorIndex - 1) * 2;
  }
  return (parameter.range.min + parameter.range.max) / 2;
}

function hashTag(tag: string): number {
  let hash = 0;
  for (const character of tag) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function step(machine: SimMachine): string[] {
  const nowSeconds = Date.now() / 1000;
  const phases = new Map<number, ProcessPhase>();
  const phaseNames: string[] = [];

  for (const tank of [1, 2] as const) {
    const phase = phaseAt(nowSeconds, tank);
    phases.set(tank, phase);
    phaseNames.push(`T${tank}=${phase.name}`);
  }

  for (const parameter of machine.params) {
    if (SIMULATED_ALARM_TAGS.includes(parameter.tag)) {
      parameter.value = 0;
      continue;
    }
    const tank: 1 | 2 = /(?:CE|WM|MS|PT|TT)2_/.test(parameter.tag) ? 2 : 1;
    const target = targetFor(parameter, phases.get(tank)!);
    const span = parameter.range.max - parameter.range.min;
    const noise = span * 0.002;
    parameter.value += (target - parameter.value) * 0.08 + (Math.random() - 0.5) * 2 * noise;
    parameter.value = Math.min(parameter.range.max, Math.max(parameter.range.min, parameter.value));
  }

  for (const valve of machine.valves) {
    const tank: 1 | 2 = valve.tag.startsWith('PBV 2-') || valve.tag.startsWith('DKV 2-') ? 2 : 1;
    const phase = phases.get(tank)!;
    const onPhase = (hashTag(valve.tag) % (PHASES.length - 1)) + 1;
    valve.state = phaseIndex(phase) === onPhase;
  }
  return phaseNames;
}

async function sendMachine(machine: SimMachine): Promise<string | null> {
  const phases = step(machine);
  const now = Date.now();
  const values = [
    ...machine.params.map((parameter) => ({
      id: parameter.kepserver_tag,
      v: Number(parameter.value.toFixed(parameter.range.digits)),
      q: true,
      t: now,
    })),
    ...machine.valves.map((valve) => ({
      id: valve.kepserver_tag,
      v: valve.state ? 1 : 0,
      q: true,
      t: now,
    })),
  ];
  const url = `${BASE_URL}/api/dataReceiver/insert/${encodeURIComponent(machine.line)}/${encodeURIComponent(machine.code)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      body: JSON.stringify({ timestamp: now, values }),
    });
    if (!response.ok) return `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`;

    const body = await response.json() as { unknown?: string[]; parameters?: number; valves?: number };
    if (body.unknown?.length) return `ID tidak dikenali server: ${body.unknown.join(', ')}`;
    if (body.parameters !== machine.params.length || body.valves !== machine.valves.length) {
      return `Jumlah tersimpan tidak cocok: parameter=${body.parameters ?? 0}/${machine.params.length}, ` +
        `valve=${body.valves ?? 0}/${machine.valves.length}`;
    }
    console.log(`[${new Date().toLocaleTimeString()}] ${phases.join(' ')} | ${values.length} nilai terkirim`);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Simulator Line 3 hanya boleh dijalankan di lingkungan development/test.');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diatur di .env.local.');
  if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS < 250) {
    throw new Error('SIM_INTERVAL_MS harus berupa angka minimal 250 ms.');
  }

  let machine = await loadMachine();
  console.log(`Simulator Line 3 (DATA DEMO) -> ${BASE_URL} tiap ${INTERVAL_MS} ms`);
  console.log(`  ${machine.line}/${machine.code}: ${SENSOR_TAGS.length} sensor, ` +
    `${SIMULATED_ALARM_TAGS.length} alarm/proteksi, ${machine.valves.length} valve`);
  console.log('  Nilai simulasi bukan pembacaan PLC aktual atau urutan valve terverifikasi.');

  let lastReload = Date.now();
  for (;;) {
    const started = Date.now();
    if (started - lastReload >= RELOAD_MS) {
      lastReload = started;
      try {
        machine = await loadMachine(machine);
      } catch (error) {
        console.error('Gagal memuat ulang konfigurasi tag Line 3:', error);
      }
    }
    const error = await sendMachine(machine);
    if (error) console.error(`[${new Date().toLocaleTimeString()}] ERROR ${error}`);
    await sleep(Math.max(0, INTERVAL_MS - (Date.now() - started)));
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
