'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ProcessMimic from '@/components/ProcessMimic';
import FilterLineHmi from '@/components/FilterLineHmi';
import { fillingRoom } from '@/lib/mimic/fillingRoom';
import type { MimicConfig } from '@/lib/mimic/types';

type Msg = {
  line: string;
  machine: string;
  ts: string;
  values: Record<string, number>;
  valves: Record<string, boolean>;
  quality?: Record<string, 'GOOD' | 'BAD'>;
  timestamps?: Record<string, string>;
};
type LatestData = {
  calibration?: string;
  parameters?: Array<{
    tag: string;
    value: number | null;
    quality: string | null;
    recorded_at: string | null;
  }>;
  valves?: Array<{
    tag: string;
    state: boolean | null;
    updated_at: string | null;
  }>;
};
const STALE_MS = 10_000;

function timestampFrom(value: string | undefined | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export default function MimicLive({ line, machine, config = fillingRoom }: { line: string; machine: string; config?: MimicConfig }) {
  const valveTags = useMemo(() => new Set(config.valves.map((v) => v.tag)), [config]);
  const watchedTags = useMemo(() => {
    const tags = new Set<string>();
    for (const i of config.instruments) {
      tags.add(i.tag);
      if (i.runTag) tags.add(i.runTag);
      if (i.setTag) tags.add(i.setTag);
    }
    for (const p of config.pumps ?? []) tags.add(p.runTag);
    for (const a of config.agitators ?? []) tags.add(a.runTag);
    return tags;
  }, [config]);

  const [valves, setValves] = useState<Record<string, boolean | null>>({});
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [lastTs, setLastTs] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationUnavailable, setCalibrationUnavailable] = useState(false);
  const appliedTimestamps = useRef<Record<string, number>>({});

  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    appliedTimestamps.current = {};

    const acceptTimestamp = (tag: string, timestamp: number | null): boolean => {
      const previous = appliedTimestamps.current[tag];
      if (timestamp === null) return previous === undefined;
      if (previous !== undefined && timestamp < previous) return false;
      appliedTimestamps.current[tag] = timestamp;
      return true;
    };

    // 1) kondisi terakhir dari database
    fetch(`/api/latest/${line}/${machine}`, { cache: 'no-store', signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Gagal membaca data terakhir (HTTP ${r.status})`);
        return r.json() as Promise<LatestData>;
      })
      .then((data) => {
        if (!alive) return;
        setCalibrationUnavailable(data.calibration === 'unavailable-raw-values');
        const nextValves: Record<string, boolean | null> = {};
        const nextValues: Record<string, number | null> = {};
        let latestTimestamp = 0;
        for (const valve of data.valves ?? []) {
          if (!valveTags.has(valve.tag)) continue;
          const timestamp = timestampFrom(valve.updated_at);
          if (!acceptTimestamp(valve.tag, timestamp)) continue;
          nextValves[valve.tag] = valve.state;
          if (timestamp !== null) latestTimestamp = Math.max(latestTimestamp, timestamp);
        }
        for (const parameter of data.parameters ?? []) {
          if (!watchedTags.has(parameter.tag)) continue;
          const timestamp = timestampFrom(parameter.recorded_at);
          if (!acceptTimestamp(parameter.tag, timestamp)) continue;
          nextValues[parameter.tag] = parameter.quality === 'BAD' || parameter.value == null
            ? null
            : parameter.value;
          if (timestamp !== null) latestTimestamp = Math.max(latestTimestamp, timestamp);
        }
        setValves((current) => ({ ...current, ...nextValves }));
        setValues((current) => ({ ...current, ...nextValues }));
        if (latestTimestamp) setLastTs((previous) => Math.max(previous ?? 0, latestTimestamp));
      })
      .catch((cause: unknown) => {
        if (alive && !(cause instanceof DOMException && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'Gagal membaca data monitoring');
        }
      });

    // 2) pembaruan realtime
    const lineFilter = line.toLowerCase() === 'line4' ? '&line=line4' : '';
    const es = new EventSource(`/api/realtime/stream?machine=${encodeURIComponent(machine)}${lineFilter}`);
    es.onopen = () => {
      setConnected(true);
      if (alive) setError(null);
    };
    es.onerror = () => {
      setConnected(false);
      if (alive) setError('Koneksi realtime terputus');
    };
    es.onmessage = (e) => {
      try {
        const message: Msg = JSON.parse(e.data);
        if (
          message.line.toLowerCase() !== line.toLowerCase() ||
          message.machine.toLowerCase() !== machine.toLowerCase()
        ) return;
        const fallbackTimestamp = timestampFrom(message.ts);
        const tags = new Set([
          ...Object.keys(message.values),
          ...Object.keys(message.valves),
          ...Object.keys(message.quality ?? {}),
        ]);
        const nextTimestamps: number[] = [];
        const nextValves: Record<string, boolean | null> = {};
        const nextValues: Record<string, number | null> = {};
        const isLine4 = line.toLowerCase() === 'line4';
        let receivedGoodData = false;
        for (const tag of tags) {
          if (!valveTags.has(tag) && !watchedTags.has(tag)) continue;
          const timestamp = timestampFrom(message.timestamps?.[tag]) ?? fallbackTimestamp;
          if (!isLine4 && !acceptTimestamp(tag, timestamp)) continue;
          if (timestamp !== null) nextTimestamps.push(timestamp);
          if (message.quality?.[tag] === 'BAD') {
            if (valveTags.has(tag)) nextValves[tag] = null;
            if (watchedTags.has(tag)) nextValues[tag] = null;
          } else if (valveTags.has(tag) && Object.hasOwn(message.valves, tag)) {
            nextValves[tag] = message.valves[tag];
            receivedGoodData = typeof message.valves[tag] === 'boolean' || receivedGoodData;
          } else if (watchedTags.has(tag) && Object.hasOwn(message.values, tag)) {
            const value = Number.isFinite(message.values[tag]) ? message.values[tag] : null;
            nextValues[tag] = value;
            receivedGoodData = value !== null || receivedGoodData;
          }
        }
        if (isLine4) {
          if (receivedGoodData) setLastTs(Date.now());
        } else if (nextTimestamps.length) {
          setLastTs((previous) => Math.max(previous ?? 0, ...nextTimestamps));
        }
        setValves((current) => ({ ...current, ...nextValves }));
        setValues((current) => ({ ...current, ...nextValues }));
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Pesan realtime tidak valid');
      }
    };
    return () => {
      alive = false;
      controller.abort();
      es.close();
    };
  }, [line, machine, valveTags, watchedTags]);

  const stale = now !== null && (lastTs === null || now - lastTs > STALE_MS);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{config.title}</h2>
        <span style={{ fontSize: 14, color: connected ? '#1f7a3d' : '#b3372a' }}>
          {connected ? 'Realtime terhubung' : 'Realtime terputus'}
        </span>
        {calibrationUnavailable && (
          <span role="status" style={{ fontSize: 14, color: '#9a6700' }}>
            Kalibrasi CSV Line 4 tidak tersedia; tag tanpa skala atau kalibrasi yang didukung tetap ditampilkan raw.
          </span>
        )}
        {stale && <span style={{ fontSize: 14, color: '#9a6700' }}>Menampilkan nilai terakhir tersimpan</span>}
        {error && <span style={{ fontSize: 14, color: '#b4232a' }}>{error}</span>}
      </div>
      {config.title === 'Filter Line' ? (
        <FilterLineHmi valveStates={valves} sensorValues={values} stale={stale} />
      ) : (
        <ProcessMimic config={config} valves={valves} values={values} stale={stale} />
      )}
    </div>
  );
}