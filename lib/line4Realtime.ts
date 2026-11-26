import { EventEmitter } from 'node:events';
import { Client } from 'pg';
import type { RealtimeMessage } from '@/lib/realtime';

const CHANNEL = 'line4_realtime';
const MAX_NOTIFICATION_BYTES = 7000;

type ListenerState = {
  events: EventEmitter;
  client: Client | null;
  connecting: Promise<void> | null;
};

const g = globalThis as unknown as { line4Realtime?: ListenerState };
const state = g.line4Realtime ?? {
  events: new EventEmitter(),
  client: null,
  connecting: null,
};
g.line4Realtime = state;
state.events.setMaxListeners(200);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRealtimeMessage(value: unknown): value is RealtimeMessage {
  return isRecord(value) &&
    typeof value.line === 'string' &&
    value.line.toLowerCase() === 'line4' &&
    typeof value.machine === 'string' &&
    typeof value.ts === 'string' &&
    isRecord(value.values) &&
    isRecord(value.quality) &&
    isRecord(value.timestamps) &&
    isRecord(value.valves);
}

function emptyMessage(message: RealtimeMessage): RealtimeMessage {
  return {
    line: message.line,
    machine: message.machine,
    ts: message.ts,
    values: {},
    quality: {},
    timestamps: {},
    valves: {},
  };
}

export function splitLine4RealtimeMessage(message: RealtimeMessage): RealtimeMessage[] {
  const tags = new Set([
    ...Object.keys(message.values),
    ...Object.keys(message.quality),
    ...Object.keys(message.timestamps),
    ...Object.keys(message.valves),
  ]);
  const chunks: RealtimeMessage[] = [];
  let chunk = emptyMessage(message);

  const addTag = (target: RealtimeMessage, tag: string) => {
    if (Object.hasOwn(message.values, tag)) target.values[tag] = message.values[tag];
    if (Object.hasOwn(message.quality, tag)) target.quality[tag] = message.quality[tag];
    if (Object.hasOwn(message.timestamps, tag)) target.timestamps[tag] = message.timestamps[tag];
    if (Object.hasOwn(message.valves, tag)) target.valves[tag] = message.valves[tag];
  };

  for (const tag of tags) {
    addTag(chunk, tag);
    if (Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= MAX_NOTIFICATION_BYTES) continue;

    delete chunk.values[tag];
    delete chunk.quality[tag];
    delete chunk.timestamps[tag];
    delete chunk.valves[tag];
    if (Object.keys(chunk.values).length + Object.keys(chunk.quality).length +
      Object.keys(chunk.timestamps).length + Object.keys(chunk.valves).length === 0) {
      throw new Error(`Realtime tag "${tag}" exceeds the PostgreSQL notification size limit.`);
    }

    chunks.push(chunk);
    chunk = emptyMessage(message);
    addTag(chunk, tag);
    if (Buffer.byteLength(JSON.stringify(chunk), 'utf8') > MAX_NOTIFICATION_BYTES) {
      throw new Error(`Realtime tag "${tag}" exceeds the PostgreSQL notification size limit.`);
    }
  }

  if (tags.size > 0) chunks.push(chunk);
  return chunks;
}

export async function notifyLine4Realtime(
  client: Pick<Client, 'query'>,
  message: RealtimeMessage,
): Promise<void> {
  for (const chunk of splitLine4RealtimeMessage(message)) {
    await client.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(chunk)]);
  }
}

async function ensureListener(): Promise<void> {
  if (state.connecting) return state.connecting;
  if (state.client) return;

  const connecting = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    state.client = client;
    client.on('notification', (notification) => {
      if (notification.channel !== CHANNEL || !notification.payload) return;
      try {
        const message: unknown = JSON.parse(notification.payload);
        if (!isRealtimeMessage(message)) {
          throw new Error('Invalid Line 4 PostgreSQL realtime notification.');
        }
        state.events.emit('reading', message);
      } catch (error) {
        console.error('Failed to process Line 4 PostgreSQL realtime notification', error);
      }
    });
    client.on('error', (error: Error) => {
      if (state.client !== client) return;
      state.client = null;
      console.error('Line 4 PostgreSQL realtime listener failed', error);
      state.events.emit('listener-error', error);
      void client.end().catch(() => undefined);
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      if (state.client === client) state.client = null;
      await client.end().catch(() => undefined);
      throw error;
    }
  })();
  state.connecting = connecting;

  try {
    await connecting;
  } finally {
    if (state.connecting === connecting) state.connecting = null;
  }
}

export async function subscribeLine4Realtime(
  onReading: (message: RealtimeMessage) => void,
  onError: (error: Error) => void,
): Promise<() => void> {
  state.events.on('reading', onReading);
  state.events.on('listener-error', onError);
  try {
    await ensureListener();
  } catch (error) {
    state.events.off('reading', onReading);
    state.events.off('listener-error', onError);
    throw error;
  }

  return () => {
    state.events.off('reading', onReading);
    state.events.off('listener-error', onError);
  };
}
