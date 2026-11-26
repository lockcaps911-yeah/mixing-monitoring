'use client';

import { useEffect, useMemo, useState } from 'react';
import ProcessMimic from '@/components/ProcessMimic';
import { fillingRoom } from '@/lib/mimic/fillingRoom';

const STALE_MS = 10_000;
const SENSOR_TAGS = fillingRoom.instruments.map((instrument) => instrument.tag);
const VALVE_TAGS = fillingRoom.valves.map((valve) => valve.tag);

type Reading<T> = {
  value: T | null;
  timestamp: number | null;
  good: boolean;
};

type LatestResponse = {
  calibration?: string;
  parameters?: { tag?: unknown; value?: unknown; quality?: unknown; recorded_at?: unknown }[];
  valves?: { tag?: unknown; state?: unknown; updated_at?: unknown }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isFresh<T>(reading: Reading<T> | undefined, now: number): reading is Reading<T> & { value: T } {
  return Boolean(
    reading?.good &&
    reading.value !== null &&
    reading.timestamp !== null &&
    now >= reading.timestamp &&
    now - reading.timestamp <= STALE_MS,
  );
}

export default function Line4FillingRoomLive() {
  const [parameters, setParameters] = useState<Record<string, Reading<number>>>({});
  const [valves, setValves] = useState<Record<string, Reading<boolean>>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationUnavailable, setCalibrationUnavailable] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const watchedSensorTags = useMemo(() => new Set(SENSOR_TAGS), []);
  const watchedValveTags = useMemo(() => new Set(VALVE_TAGS), []);

  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const eventSource = new EventSource(
      `/api/realtime/stream?machine=${encodeURIComponent('mixingL4')}&line=line4`,
    );

    void (async () => {
      try {
        const response = await fetch('/api/latest/line4/mixingL4', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Gagal membaca data terakhir (HTTP ${response.status})`);
        const data = await response.json() as LatestResponse;
        if (!alive) return;
        setCalibrationUnavailable(data.calibration === 'unavailable-raw-values');

        const nextParameters: Record<string, Reading<number>> = {};
        for (const item of data.parameters ?? []) {
          if (typeof item.tag !== 'string' || !watchedSensorTags.has(item.tag)) continue;
          const value = finiteNumber(item.value);
          const good = String(item.quality ?? '').toUpperCase() === 'GOOD' && value !== null;
          nextParameters[item.tag] = {
            value: good ? value : null,
            timestamp: timestamp(item.recorded_at),
            good,
          };
        }

        const nextValves: Record<string, Reading<boolean>> = {};
        for (const item of data.valves ?? []) {
          if (typeof item.tag !== 'string' || !watchedValveTags.has(item.tag)) continue;
          const value = typeof item.state === 'boolean' ? item.state : null;
          const good = value !== null;
          nextValves[item.tag] = {
            value,
            timestamp: timestamp(item.updated_at),
            good,
          };
        }

        setParameters((current) => ({ ...nextParameters, ...current }));
        setValves((current) => ({ ...nextValves, ...current }));
        setError(null);
      } catch (cause) {
        if (!alive || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setError(cause instanceof Error ? cause.message : 'Gagal membaca data Filling Room Line 4');
      }
    })();

    eventSource.onopen = () => {
      if (alive) setConnected(true);
    };
    eventSource.onerror = () => {
      if (alive) {
        setConnected(false);
        setError('Koneksi realtime terputus; browser akan mencoba tersambung kembali.');
      }
    };
    eventSource.onmessage = (event) => {
      try {
        const payload: unknown = JSON.parse(event.data);
        if (!isRecord(payload)) throw new Error('Payload realtime tidak valid.');
        if (
          typeof payload.line !== 'string' ||
          payload.line.toLowerCase() !== 'line4' ||
          typeof payload.machine !== 'string' ||
          payload.machine.toLowerCase() !== 'mixingl4'
        ) return;

        const messageValues = isRecord(payload.values) ? payload.values : {};
        const messageValves = isRecord(payload.valves) ? payload.valves : {};
        const quality = isRecord(payload.quality) ? payload.quality : {};
        const timestamps = isRecord(payload.timestamps) ? payload.timestamps : {};
        const fallbackTimestamp = timestamp(payload.ts);
        const receivedAt = Date.now();

        setParameters((current) => {
          const next = { ...current };
          for (const tag of watchedSensorTags) {
            if (!Object.hasOwn(messageValues, tag) && !Object.hasOwn(quality, tag)) continue;
            const value = finiteNumber(messageValues[tag]);
            const good = String(quality[tag] ?? '').toUpperCase() !== 'BAD' && value !== null;
            next[tag] = {
              value: good ? value : null,
              timestamp: good
                ? receivedAt
                : timestamp(timestamps[tag]) ?? fallbackTimestamp,
              good,
            };
          }
          return next;
        });

        setValves((current) => {
          const next = { ...current };
          for (const tag of watchedValveTags) {
            if (!Object.hasOwn(messageValves, tag) && !Object.hasOwn(quality, tag)) continue;
            const good = String(quality[tag] ?? '').toUpperCase() !== 'BAD' &&
              typeof messageValves[tag] === 'boolean';
            next[tag] = {
              value: good && typeof messageValves[tag] === 'boolean' ? messageValves[tag] : null,
              timestamp: good
                ? receivedAt
                : timestamp(timestamps[tag]) ?? fallbackTimestamp,
              good,
            };
          }
          return next;
        });
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Payload realtime Filling Room tidak valid.');
      }
    };

    return () => {
      alive = false;
      controller.abort();
      eventSource.close();
    };
  }, [watchedSensorTags, watchedValveTags]);

  const displayValues: Record<string, number | null> = {};
  const displayValves: Record<string, boolean | null> = {};
  const unavailableTags: string[] = [];

  for (const tag of SENSOR_TAGS) {
    const reading = parameters[tag];
    const fresh = now !== null && isFresh(reading, now);
    displayValues[tag] = fresh ? reading.value : null;
    if (!fresh) unavailableTags.push(tag);
  }
  for (const tag of VALVE_TAGS) {
    const reading = valves[tag];
    const fresh = now !== null && isFresh(reading, now);
    displayValves[tag] = fresh ? reading.value : null;
    if (!fresh) unavailableTags.push(tag);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{fillingRoom.title}</h2>
        <span style={{ fontSize: 14, color: connected ? '#1f7a3d' : '#b3372a' }}>
          {connected ? 'SSE tersambung' : 'SSE terputus'}
        </span>
        {calibrationUnavailable && (
          <span role="status" style={{ fontSize: 14, color: '#9a6700' }}>
            Kalibrasi CSV Line 4 tidak tersedia; tag tanpa skala atau kalibrasi yang didukung tetap ditampilkan raw.
          </span>
        )}
        {unavailableTags.length > 0 && (
          <span role="status" style={{ fontSize: 14, color: '#9a6700' }}>
            Data GOOD/fresh tidak tersedia: {unavailableTags.join(', ')}
          </span>
        )}
        {error && <span role="alert" style={{ fontSize: 14, color: '#b4232a' }}>{error}</span>}
      </div>
      <ProcessMimic
        config={fillingRoom}
        valves={displayValves}
        values={displayValues}
        valveLabels={{ on: 'ON', off: 'OFF', unknown: 'Tidak ada data' }}
      />
    </div>
  );
}
