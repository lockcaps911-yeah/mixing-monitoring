/**
 * Polls KEPServerEX IoT Gateway's REST Server and forwards configured line
 * values to the application's existing data receiver.
 *
 * Run all active lines with: npm run kepserver
 * Run only Line 3 with: npm run kepserver:line3
 * Run only Line 4 with: npm run kepserver:line4
 */
import { Pool } from 'pg';
import {
  createKepReadUrl,
  isLine4MotorFrequencyTag,
  parseKepReadResults,
  resolveKepserverTagId,
} from '../lib/kepserver';

const GATEWAY_URL = process.env.KEPWARE_REST_URL ?? 'http://127.0.0.1:39320/iotgateway/';
const GATEWAY_USER = process.env.KEPWARE_REST_USER ?? '';
const GATEWAY_PASSWORD = process.env.KEPWARE_REST_PASSWORD ?? '';
const APP_URL = (process.env.SIM_TARGET_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const API_KEY = process.env.DATA_RECEIVER_KEY;
const INTERVAL_MS = Number(process.env.KEP_INTERVAL_MS ?? process.env.OPC_INTERVAL_MS ?? 1500);
const LINE4_INTERVAL_MS = Number(process.env.KEP_INTERVAL_LINE4_MS ?? 500);
const RELOAD_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TAGS_PER_READ = 40;
const MAX_GATEWAY_RETRY_MS = 60_000;
const LOG_TAG_VALUES = process.env.KEP_LOG_VALUES !== '0';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type TagItem = {
  id: string;
  kind: 'parameter' | 'valve';
};

type MachineConfig = {
  code: string;
  lineCode: string;
  tags: TagItem[];
};

type ReceiverValue = { id: string; v: unknown; q: boolean; t: number };
type GatewayRead = {
  values: ReceiverValue[];
  good: number;
  bad: number;
  failed: number;
  details: string[];
};

function validateConfig(): { lineFilter: string[] | null; intervalMs: number } {
  const args = process.argv.slice(2);
  const lineCodes = args.map((arg) => {
    const match = /^--line=(line3|line4)$/i.exec(arg);
    if (!match) throw new Error(`Unsupported argument "${arg}". Use --line=line3 or --line=line4.`);
    return match[1].toLowerCase();
  });
  if (new Set(lineCodes).size !== lineCodes.length) {
    throw new Error('Specify each --line option only once.');
  }
  const lineFilter = lineCodes.length > 0 ? lineCodes : null;
  const line4Only = lineFilter?.length === 1 && lineFilter[0] === 'line4';
  const intervalMs = line4Only ? LINE4_INTERVAL_MS : INTERVAL_MS;

  let gateway: URL;
  try {
    gateway = new URL(GATEWAY_URL);
  } catch {
    throw new Error('KEPWARE_REST_URL must be an absolute HTTP(S) URL.');
  }
  if (gateway.protocol !== 'http:' && gateway.protocol !== 'https:') {
    throw new Error('KEPWARE_REST_URL must use HTTP or HTTPS.');
  }
  if ((GATEWAY_USER && !GATEWAY_PASSWORD) || (!GATEWAY_USER && GATEWAY_PASSWORD)) {
    throw new Error('Set both KEPWARE_REST_USER and KEPWARE_REST_PASSWORD, or leave both empty.');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 250) {
    throw new Error(
      `${line4Only ? 'KEP_INTERVAL_LINE4_MS' : 'KEP_INTERVAL_MS'} must be a number of at least 250 milliseconds.`,
    );
  }
  return { lineFilter, intervalMs };
}

async function loadMachineConfigs(lineFilter: readonly string[] | null): Promise<MachineConfig[]> {
  const machines = await pool.query<{ id: string; code: string; line_code: string }>(
    `SELECT id, code, line_code
       FROM machines
      WHERE is_active
      ${lineFilter ? 'AND lower(line_code) = ANY($1::text[])' : ''}
      ORDER BY id`,
    lineFilter ? [lineFilter] : [],
  );

  const configs = await Promise.all(machines.rows.map(async (machine) => {
    const [parameters, valves] = await Promise.all([
      pool.query<{ tag: string; kepserver_tag: string | null }>(
        `SELECT tag, kepserver_tag FROM parameters
          WHERE machine_id = $1 AND is_active ORDER BY id`,
        [machine.id],
      ),
      pool.query<{ tag: string; kepserver_tag: string | null }>(
        `SELECT tag, kepserver_tag FROM valves
          WHERE machine_id = $1 AND is_active ORDER BY id`,
        [machine.id],
      ),
    ]);

    const lineCode = machine.line_code.toLowerCase();
    const prefixOverrides: Record<string, string | undefined> = {
      [lineCode]: process.env[`KEPWARE_TAG_PREFIX_${machine.line_code.toUpperCase()}`],
      ...(lineCode === 'line3'
        ? { line3db: process.env.KEPWARE_TAG_PREFIX_LINE3DB }
        : {}),
    };
    const hasMissingIdPrefix = parameters.rows.some((row) => !row.kepserver_tag) ||
      valves.rows.some((row) => !row.kepserver_tag);
    const hasDefaultPrefix = lineCode === 'line3' || lineCode === 'line4';
    if (
      hasMissingIdPrefix &&
      !hasDefaultPrefix &&
      !prefixOverrides[lineCode]
    ) {
      console.warn(
        `[DB] ${machine.line_code}/${machine.code} has tags without kepserver_tag; ` +
        `set KEPWARE_TAG_PREFIX_${machine.line_code.toUpperCase()} or populate the verified REST item IDs.`,
      );
    }
    const tags = [
      ...parameters.rows.map((row) => ({
        id: lineCode === 'line4' && isLine4MotorFrequencyTag(row.tag)
          ? resolveKepserverTagId(machine.line_code, row.tag, prefixOverrides)
          : row.kepserver_tag || resolveKepserverTagId(machine.line_code, row.tag, prefixOverrides),
        kind: 'parameter' as const,
      })),
      ...valves.rows.map((row) => ({
        id: row.kepserver_tag || resolveKepserverTagId(machine.line_code, row.tag, prefixOverrides),
        kind: 'valve' as const,
      })),
    ].filter((tag, index, all) => all.findIndex((candidate) => candidate.id === tag.id) === index);

    return { code: machine.code, lineCode: machine.line_code, tags };
  }));

  if (configs.length === 0) {
    throw new Error('No active production-line machines are configured in the database.');
  }
  return configs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeGatewayError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = isRecord(error) && 'cause' in error ? error.cause : undefined;
  if (isRecord(cause) && cause.code === 'ECONNREFUSED') {
    const gateway = new URL(GATEWAY_URL);
    const port = gateway.port || (gateway.protocol === 'https:' ? '443' : '80');
    return (
      `Connection refused by ${gateway.host}. The KEPServerEX IoT Gateway REST Server agent is not ` +
      `listening. In KEPServerEX Configuration, enable and apply the IoT Gateway REST Server agent ` +
      `on port ${port}. For KEPServer and this bridge on the same PC, use ` +
      `http://127.0.0.1:${port}/iotgateway/ in KEPWARE_REST_URL.`
    );
  }
  return error.message;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function authorizationHeader(): string | undefined {
  if (!GATEWAY_USER) return undefined;
  return `Basic ${Buffer.from(`${GATEWAY_USER}:${GATEWAY_PASSWORD}`).toString('base64')}`;
}

async function readGateway(tags: TagItem[], includeBadValveReadings = false): Promise<GatewayRead> {
  const url = createKepReadUrl(GATEWAY_URL, tags.map((tag) => tag.id));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const authorization = authorizationHeader();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Gateway returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Gateway response was not valid JSON.');
  }
  if (!isRecord(payload) || !Array.isArray(payload.readResults)) {
    throw new Error('Gateway response did not contain a readResults array.');
  }

  const parsed = parseKepReadResults(
    tags.map((tag) => tag.id),
    payload.readResults,
    toTimestamp,
  );
  const tagKinds = new Map(tags.map((tag) => [tag.id, tag.kind]));
  const values = parsed.readings
    .filter((reading) =>
      reading.quality || tagKinds.get(reading.id) !== 'valve' || includeBadValveReadings,
    )
    .map((reading) => ({
      id: reading.id,
      v: reading.value,
      q: reading.quality,
      t: reading.timestamp,
    }));
  const good = parsed.readings.filter((reading) => reading.quality).length;
  const bad = parsed.readings.length - good;
  return {
    values,
    good,
    bad,
    failed: parsed.failed,
    details: parsed.readings.map((reading) =>
      `${reading.id}=${JSON.stringify(reading.value)} [${reading.quality ? 'GOOD' : 'BAD'}${reading.reason ? `: ${reading.reason}` : ''}]`,
    ),
  };
}

async function sendToReceiver(machine: MachineConfig, values: ReceiverValue[]): Promise<string> {
  if (values.length === 0) return 'SKIP (tidak ada nilai yang bisa dikirim)';
  const url = `${APP_URL}/api/dataReceiver/insert/${encodeURIComponent(machine.lineCode)}/${encodeURIComponent(machine.code)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      body: JSON.stringify({ timestamp: Date.now(), values }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Receiver returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return `HTTP ${response.status}, ${values.length} nilai terkirim`;
}

async function preflightCheck(): Promise<boolean> {
  const gatewayBase = GATEWAY_URL.endsWith('/') ? GATEWAY_URL : `${GATEWAY_URL}/`;
  console.log('\n[Preflight] Menguji koneksi ke KEPServerEX IoT Gateway...');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const authorization = authorizationHeader();
    const response = await fetch(`${gatewayBase}browse`, {
      headers: {
        Accept: 'application/json',
        ...(authorization ? { Authorization: authorization } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.status === 401 || response.status === 403) {
      console.error('[Preflight] ❌ Gateway menolak akses (HTTP ' + response.status + ').');
      console.error('[Preflight]    Set KEPWARE_REST_USER dan KEPWARE_REST_PASSWORD di .env.local');
      return false;
    }
    console.log('[Preflight] ✅ Gateway merespons (HTTP ' + response.status + ').');
    return true;
  } catch (error) {
    console.error('[Preflight] ❌ Tidak bisa terhubung ke Gateway:', describeGatewayError(error));
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  REST Server agent belum aktif di KEPServerEX.              ║');
    console.error('║                                                              ║');
    console.error('║  Langkah:                                                    ║');
    console.error('║  1. Buka KEPServerEX Configuration                           ║');
    console.error('║  2. IoT Gateway → REST Server → New Agent                   ║');
    console.error('║  3. Set Port=39320, Enabled=Yes                              ║');
    console.error('║  4. Tambahkan IoT Items dari channel/device PLC yang sesuai  ║');
    console.error('║  5. Save konfigurasi                                         ║');
    console.error('║                                                              ║');
    console.error('║  Verifikasi dari PowerShell:                                 ║');
    console.error('║  Get-NetTCPConnection -State Listen -LocalPort 39320         ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('[Preflight] Bridge akan tetap mencoba polling, tapi data tidak akan mengalir');
    console.error('[Preflight] sampai REST Server agent aktif.\n');
    return false;
  }
}

async function main() {
  const { lineFilter, intervalMs } = validateConfig();
  console.log('KEPServerEX IoT Gateway REST bridge');
  console.log(`[Gateway]  ${GATEWAY_URL}`);
  console.log(`[Receiver] ${APP_URL}`);
  console.log(`[Interval] ${intervalMs}ms`);
  console.log(`[Lines] ${lineFilter?.join(', ') ?? 'all active lines'}`);

  let machines = await loadMachineConfigs(lineFilter);
  let totalTags = machines.reduce((sum, machine) => sum + machine.tags.length, 0);
  console.log(`[DB] Loaded ${machines.length} active machines across ${new Set(machines.map((machine) => machine.lineCode.toLowerCase())).size} lines and ${totalTags} tags.`);

  const gatewayReady = await preflightCheck();

  let lastReload = Date.now();
  let stopping = false;
  const gatewayFailureCounts = new Map<string, number>();
  const nextGatewayAttempts = new Map<string, number>();
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });

  while (!stopping) {
    const cycleStarted = Date.now();
    if (cycleStarted - lastReload >= RELOAD_MS) {
      try {
        machines = await loadMachineConfigs(lineFilter);
        totalTags = machines.reduce((sum, machine) => sum + machine.tags.length, 0);
        console.log(`[DB] Reloaded ${machines.length} machines and ${totalTags} tags.`);
        lastReload = cycleStarted;
      } catch (error) {
        lastReload = cycleStarted;
        console.error('[DB] Failed to reload machine tags:', error);
      }
    }

    for (const machine of machines) {
      const machineKey = `${machine.lineCode}/${machine.code}`;
      const nextGatewayAttempt = nextGatewayAttempts.get(machineKey) ?? 0;
      if (Date.now() < nextGatewayAttempt) {
        console.info(
          `[Cycle] ${machineKey}: pembacaan dilewati; retry KepServer dalam ${Math.ceil((nextGatewayAttempt - Date.now()) / 1000)} dtk; receiver=SKIP`,
        );
        continue;
      }

      const values: ReceiverValue[] = [];
      const details: string[] = [];
      let good = 0;
      let bad = 0;
      let failed = 0;
      let gatewayReadFailed = false;
      for (let start = 0; start < machine.tags.length; start += MAX_TAGS_PER_READ) {
        const batch = machine.tags.slice(start, start + MAX_TAGS_PER_READ);
        try {
          const batchRead = await readGateway(
            batch,
            ['line3', 'line4'].includes(machine.lineCode.toLowerCase()),
          );
          values.push(...batchRead.values);
          good += batchRead.good;
          bad += batchRead.bad;
          failed += batchRead.failed;
          details.push(...batchRead.details);
        } catch (error) {
          failed += machine.tags.length - start;
          const gatewayFailureCount = (gatewayFailureCounts.get(machineKey) ?? 0) + 1;
          gatewayFailureCounts.set(machineKey, gatewayFailureCount);
          const retryDelay = machine.lineCode.toLowerCase() === 'line4'
            ? LINE4_INTERVAL_MS
            : Math.min(
                MAX_GATEWAY_RETRY_MS,
                2 ** Math.min(gatewayFailureCount, 6) * 1000,
              );
          nextGatewayAttempts.set(machineKey, Date.now() + retryDelay);
          gatewayReadFailed = true;
          console.error(
            `[Gateway] Failed reading ${machineKey}:`,
            describeGatewayError(error),
          );
          const retryStatus = machine.lineCode.toLowerCase() === 'line4'
            ? `${retryDelay} ms`
            : `${Math.round(retryDelay / 1000)} seconds`;
          console.error(`[Gateway] Retrying in ${retryStatus}.`);
          break;
        }
      }

      console.info(
        `[Read] ${machine.lineCode}/${machine.code}: ${good + bad}/${machine.tags.length} tag bernilai; GOOD=${good}, BAD(cache)=${bad}, gagal/kosong=${failed}`,
      );
      if (LOG_TAG_VALUES && details.length > 0) {
        console.info(`[Values] ${machine.lineCode}/${machine.code}: ${details.join(' | ')}`);
      }

      if (!gatewayReadFailed && (gatewayFailureCounts.get(machineKey) ?? 0) > 0) {
        gatewayFailureCounts.delete(machineKey);
        nextGatewayAttempts.delete(machineKey);
        if (!gatewayReady) {
          console.info('[Gateway] ✅ REST Server terdeteksi! Data mulai mengalir.');
        } else {
          console.info('[Gateway] Connection restored; readings are flowing again.');
        }
      }

      try {
        const receiverStatus = await sendToReceiver(machine, values);
        console.info(`[Receiver] ${machine.lineCode}/${machine.code}: ${receiverStatus}`);
      } catch (error) {
        console.error(
          `[Receiver] ${machine.lineCode}/${machine.code}: GAGAL mengirim ${values.length} nilai:`,
          error,
        );
      }
    }

    const delay = Math.max(0, intervalMs - (Date.now() - cycleStarted));
    if (delay > 0 && !stopping) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  await pool.end();
  console.log('KEPServerEX bridge stopped.');
}

main().catch(async (error: unknown) => {
  console.error('[FATAL]', error);
  await pool.end();
  process.exitCode = 1;
});
