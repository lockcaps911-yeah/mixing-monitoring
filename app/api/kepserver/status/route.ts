import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { AUTH_ENABLED, authErrorResponse, requireAuthenticatedUser } from '@/lib/auth';
import { createKepReadUrl, hasGoodKepQuality } from '@/lib/kepserver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GATEWAY_URL = process.env.KEPWARE_REST_URL ?? 'http://127.0.0.1:39320/iotgateway/';
const GATEWAY_USER = process.env.KEPWARE_REST_USER ?? '';
const GATEWAY_PASSWORD = process.env.KEPWARE_REST_PASSWORD ?? '';
const REQUEST_TIMEOUT_MS = 5_000;
const LINE4_VALVE_TEST_TAGS = [
  'S7-1200PLC.MIXING_LINE4.PDV9001',
  'S7-1200PLC.MIXING_LINE4.PDV1044',
] as const;

type GatewayTagReadTest = {
  tagId: string;
  success: boolean;
  value: unknown;
  quality: unknown;
  error: string | null;
};

type GatewayStatus = {
  configured: boolean;
  url: string;
  reachable: boolean;
  error: string | null;
  readTest: {
    tagId: string;
    success: boolean;
    value: unknown;
    quality: unknown;
    error: string | null;
  } | null;
  valveReadTests: GatewayTagReadTest[] | null;
};

type DatabaseStatus = {
  connected: boolean;
  machines: { code: string; lineCode: string; parameterCount: number; valveCount: number }[];
  totalTags: number;
  error: string | null;
};

function authorizationHeader(): Record<string, string> {
  if (!GATEWAY_USER) return {};
  return { Authorization: `Basic ${Buffer.from(`${GATEWAY_USER}:${GATEWAY_PASSWORD}`).toString('base64')}` };
}

async function checkGateway(): Promise<GatewayStatus> {
  const status: GatewayStatus = {
    configured: !!process.env.KEPWARE_REST_URL,
    url: GATEWAY_URL,
    reachable: false,
    error: null,
    readTest: null,
    valveReadTests: null,
  };

  // 1. Cek apakah gateway endpoint bisa dijangkau
  const gatewayBase = GATEWAY_URL.endsWith('/') ? GATEWAY_URL : `${GATEWAY_URL}/`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${gatewayBase}browse`, {
        headers: { Accept: 'application/json', ...authorizationHeader() },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        status.reachable = true;
      } else {
        // Beberapa versi KEPServerEX tidak punya /browse, coba /read tanpa parameter
        status.reachable = true;
        status.error = `Gateway responded with HTTP ${response.status} on /browse (may be normal)`;
      }
    } catch (fetchError) {
      clearTimeout(timeout);
      throw fetchError;
    }
  } catch (error) {
    const cause = error instanceof Error && 'cause' in error
      ? (error as { cause?: { code?: string } }).cause
      : undefined;
    if (cause?.code === 'ECONNREFUSED') {
      status.error =
        `Connection refused. IoT Gateway REST Server agent tidak aktif di ${GATEWAY_URL}. ` +
        `Aktifkan REST Server agent di KEPServerEX Configuration → IoT Gateway → REST Server.`;
    } else if (error instanceof DOMException && error.name === 'AbortError') {
      status.error = `Timeout setelah ${REQUEST_TIMEOUT_MS}ms. Gateway mungkin overloaded atau URL salah.`;
    } else {
      status.error = error instanceof Error ? error.message : String(error);
    }
    return status;
  }

  // 2. Test read satu tag dari database
  try {
    const tagRow = await pool.query<{ kepserver_tag: string | null; tag: string }>(
      `SELECT p.kepserver_tag, p.tag
         FROM parameters p
         JOIN machines m ON m.id = p.machine_id
        WHERE m.is_active AND p.is_active
          AND lower(m.line_code) = 'line4' AND lower(m.code) = 'mixingl4'
          AND p.kepserver_tag IS NOT NULL AND p.kepserver_tag <> ''
        ORDER BY p.id
        LIMIT 1`,
    );
    const testTag = tagRow.rows[0];
    if (testTag) {
      const tagId = testTag.kepserver_tag || `S7-1200PLC.MIXING_LINE4.${testTag.tag}`;
      const readUrl = createKepReadUrl(GATEWAY_URL, [tagId]);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(readUrl, {
          headers: { Accept: 'application/json', ...authorizationHeader() },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const text = await response.text();
        if (response.ok) {
          const data = JSON.parse(text) as {
            readResults?: { id?: string; v?: unknown; s?: unknown; r?: unknown }[];
          };
          const result = data.readResults?.[0];
          const success = !!result && hasGoodKepQuality(result);
          status.readTest = {
            tagId,
            success,
            value: result?.v ?? null,
            quality: result?.s ?? null,
            error: success
              ? null
              : typeof result?.r === 'string'
                ? result.r
                : 'Gateway returned a non-good quality result.',
          };
        } else {
          status.readTest = {
            tagId,
            success: false,
            value: null,
            quality: null,
            error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
          };
        }
      } catch (readError) {
        clearTimeout(timeout);
        status.readTest = {
          tagId,
          success: false,
          value: null,
          quality: null,
          error: readError instanceof Error ? readError.message : String(readError),
        };
      }
    }
  } catch {
    // Tidak ada tag di database untuk test, skip
  }

  try {
    const readUrl = createKepReadUrl(GATEWAY_URL, LINE4_VALVE_TEST_TAGS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(readUrl, {
        headers: { Accept: 'application/json', ...authorizationHeader() },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);

      const data = JSON.parse(text) as {
        readResults?: { id?: string; v?: unknown; s?: unknown; r?: unknown }[];
      };
      if (!Array.isArray(data.readResults)) {
        throw new Error('Gateway response did not contain a readResults array.');
      }

      status.valveReadTests = LINE4_VALVE_TEST_TAGS.map((tagId) => {
        const result = data.readResults?.find((item) => item.id === tagId);
        const hasValue = result?.v !== null && result?.v !== undefined &&
          !(typeof result.v === 'string' && result.v.trim() === '');
        const success = !!result && hasValue && hasGoodKepQuality(result);
        return {
          tagId,
          success,
          value: hasValue ? result?.v : null,
          quality: result?.s ?? (result?.r === 0 ? true : result?.r ?? null),
          error: success
            ? null
            : !result
              ? 'Gateway tidak mengembalikan tag ini.'
              : !hasValue
                ? 'Tag tidak memiliki nilai yang dapat dibaca.'
                : typeof result.r === 'string'
                  ? result.r
                  : 'Gateway returned a non-good quality result.',
        };
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.valveReadTests = LINE4_VALVE_TEST_TAGS.map((tagId) => ({
      tagId,
      success: false,
      value: null,
      quality: null,
      error: message,
    }));
  }

  return status;
}

async function checkDatabase(): Promise<DatabaseStatus> {
  const status: DatabaseStatus = {
    connected: false,
    machines: [],
    totalTags: 0,
    error: null,
  };

  try {
    const machines = await pool.query<{ id: string; code: string; line_code: string }>(
      `SELECT id, code, line_code FROM machines WHERE is_active ORDER BY id`,
    );

    status.connected = true;

    for (const machine of machines.rows) {
      const [params, valves] = await Promise.all([
        pool.query<{ count: string }>(
          `SELECT count(*) FROM parameters WHERE machine_id = $1 AND is_active`,
          [machine.id],
        ),
        pool.query<{ count: string }>(
          `SELECT count(*) FROM valves WHERE machine_id = $1 AND is_active`,
          [machine.id],
        ),
      ]);
      const paramCount = parseInt(params.rows[0].count, 10);
      const valveCount = parseInt(valves.rows[0].count, 10);
      status.machines.push({
        code: machine.code,
        lineCode: machine.line_code,
        parameterCount: paramCount,
        valveCount: valveCount,
      });
      status.totalTags += paramCount + valveCount;
    }
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
  }

  return status;
}

export async function GET() {
  // Proteksi: hanya admin/authenticated user yang bisa akses diagnostik
  if (AUTH_ENABLED) {
    try {
      const user = await requireAuthenticatedUser();
      if (user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Administrator access required' }, { status: 403 });
      }
    } catch (error) {
      return authErrorResponse(error);
    }
  }

  const [gateway, database] = await Promise.all([
    checkGateway(),
    checkDatabase(),
  ]);

  const allOk =
    gateway.reachable &&
    gateway.readTest?.success === true &&
    gateway.valveReadTests?.length === LINE4_VALVE_TEST_TAGS.length &&
    gateway.valveReadTests.every((test) => test.success) &&
    database.connected &&
    database.totalTags > 0;

  return NextResponse.json({
    ok: allOk,
    timestamp: new Date().toISOString(),
    gateway,
    database,
    bridge: {
      command: 'npm run kepserver',
      intervalMs: Number(process.env.KEP_INTERVAL_MS ?? process.env.OPC_INTERVAL_MS ?? 1500),
      receiverUrl: (process.env.SIM_TARGET_URL ?? process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
      receiverKeySet: !!process.env.DATA_RECEIVER_KEY,
    },
    recommendations: buildRecommendations(gateway, database),
  });
}

function buildRecommendations(gateway: GatewayStatus, database: DatabaseStatus): string[] {
  const tips: string[] = [];

  if (!gateway.reachable) {
    tips.push('Aktifkan IoT Gateway REST Server agent di KEPServerEX Configuration (port 39320).');
    tips.push('Jalankan di PowerShell: Get-NetTCPConnection -State Listen -LocalPort 39320');
  } else if (gateway.readTest && !gateway.readTest.success) {
    if (gateway.readTest.quality === false) {
      tips.push(
        `Tag "${gateway.readTest.tagId}" terbaca dengan kualitas buruk. Periksa koneksi channel/device dan kualitas data PLC di KEPServerEX.`,
      );
    } else {
      tips.push(`Test read tag "${gateway.readTest.tagId}" gagal. Pastikan tag ditambahkan sebagai IoT Item di REST Server agent.`);
    }
  }

  for (const test of gateway.valveReadTests ?? []) {
    if (!test.success) {
      tips.push(`Tag valve "${test.tagId}" belum terbaca GOOD dari PLC: ${test.error ?? 'periksa kualitas tag.'}`);
    }
  }

  if (!database.connected) {
    tips.push('Database PostgreSQL tidak bisa diakses. Periksa DATABASE_URL di .env.local.');
  } else if (database.totalTags === 0) {
    tips.push('Belum ada tag aktif di database. Jalankan: npm run import:kepserver-tags');
  }

  if (!gateway.configured) {
    tips.push('Tambahkan KEPWARE_REST_URL=http://127.0.0.1:39320/iotgateway/ di .env.local');
  }

  if (
    tips.length === 0 &&
    gateway.reachable &&
    gateway.readTest?.success &&
    gateway.valveReadTests?.every((test) => test.success)
  ) {
    tips.push('✅ Semua siap! Jalankan bridge: npm run kepserver');
  }

  return tips;
}
