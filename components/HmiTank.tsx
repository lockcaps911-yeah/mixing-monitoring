'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LINE3_TANK_TAGS,
  line3HmiSensorTag,
  line3SensorDisplayName,
} from '@/lib/mimic/line3TankTags';

type Props = { line: string; machine: string; tank: 'T1' | 'T2' };
type LiveMessage = {
  line: string;
  machine: string;
  ts: string;
  values: Record<string, number>;
  valves: Record<string, boolean>;
  quality?: Record<string, 'GOOD' | 'BAD'>;
  timestamps?: Record<string, string>;
};
type LatestResponse = {
  parameters?: Array<{ tag: string; value: number | null; quality: string | null; recorded_at: string | null }>;
  valves?: Array<{ tag: string; state: boolean | null; updated_at: string | null }>;
};
type SvgValveState = 'on' | 'off' | 'unknown';

const SENSOR_COLUMNS = 3;
const SENSOR_CARD_WIDTH = 240;
const SENSOR_CARD_HEIGHT = 64;
const SENSOR_GAP = 8;

function timestampFrom(value: string | undefined | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function unitForSensor(tag: string): string {
  if (tag.includes('_CE')) return 'µS/cm';
  if (tag.includes('_WM')) return 'kg';
  if (tag.includes('_MS')) return 'rpm';
  if (tag.includes('_PT')) return 'bar';
  return '°C';
}

function formatSensorValue(tag: string, value: number): string {
  return value.toFixed(tag.includes('_PT') ? 2 : 1);
}

export default function HmiTank({ line, machine, tank }: Props) {
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [valves, setValves] = useState<Record<string, boolean>>({});
  const [svgReadyFor, setSvgReadyFor] = useState<typeof tank | null>(null);
  const svgRef = useRef<HTMLObjectElement>(null);
  const appliedTimestamps = useRef<Record<string, number>>({});
  const sensorTags: readonly string[] = LINE3_TANK_TAGS.sensors[tank];
  const valveTags: readonly string[] = LINE3_TANK_TAGS.valves[tank];
  const sensorRows = Math.ceil(sensorTags.length / SENSOR_COLUMNS);
  const sensorViewWidth = SENSOR_COLUMNS * SENSOR_CARD_WIDTH + (SENSOR_COLUMNS - 1) * SENSOR_GAP;
  const sensorViewHeight = sensorRows * SENSOR_CARD_HEIGHT + (sensorRows - 1) * SENSOR_GAP;

  const getValveState = useCallback((tag: string): SvgValveState => {
    if (valves[tag] === undefined) return 'unknown';
    return valves[tag] ? 'on' : 'off';
  }, [valves]);

  const syncSvgStates = useCallback(() => {
    const svg = svgRef.current?.contentDocument?.documentElement;
    if (!svg || svg.localName !== 'svg') return;

    svg.querySelectorAll<SVGTSpanElement>('tspan.v[data-val]').forEach((element) => {
      const hmiTag = element.dataset.val;
      if (!hmiTag) return;
      const sensorTag = line3HmiSensorTag(hmiTag, tank);
      const value = sensorTag ? values[sensorTag] : undefined;
      const text = sensorTag && value != null ? formatSensorValue(sensorTag, value) : '—';
      if (element.textContent !== text) element.textContent = text;
      element.setAttribute('aria-label', sensorTag ? `${line3SensorDisplayName(sensorTag)}: ${text}` : `${hmiTag}: tidak tersedia`);
    });

    svg.querySelectorAll<SVGGElement>('g.valve[data-tag]').forEach((element) => {
      const tag = element.dataset.tag;
      if (!tag) return;
      const state = getValveState(tag);
      element.dataset.state = state;
      element.setAttribute('aria-label', `${tag}: ${state.replace('-', ' ')}`);
    });
  }, [getValveState, tank, values]);

  const handleSvgLoad = useCallback(() => {
    syncSvgStates();
    setSvgReadyFor(tank);
  }, [syncSvgStates, tank]);

  useEffect(() => {
    const abortController = new AbortController();
    appliedTimestamps.current = {};

    const acceptTimestamp = (tag: string, timestamp: number | null): boolean => {
      const previous = appliedTimestamps.current[tag];
      if (timestamp === null) return previous === undefined;
      if (previous !== undefined && timestamp < previous) return false;
      appliedTimestamps.current[tag] = timestamp;
      return true;
    };

    fetch(`/api/latest/${line}/${machine}`, { cache: 'no-store', signal: abortController.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Latest data request failed (${response.status})`);
        return response.json();
      })
      .then((latest: LatestResponse) => {
        const parameterValues: Record<string, number | null> = {};
        const valveValues: Record<string, boolean> = {};
        for (const parameter of latest.parameters ?? []) {
          if (!sensorTags.includes(parameter.tag)) continue;
          if (parameter.quality === 'BAD' || parameter.value === null) continue;
          const timestamp = timestampFrom(parameter.recorded_at);
          if (!acceptTimestamp(parameter.tag, timestamp)) continue;
          parameterValues[parameter.tag] = parameter.value;
        }
        for (const valve of latest.valves ?? []) {
          if (!valveTags.includes(valve.tag) || valve.state === null) continue;
          const timestamp = timestampFrom(valve.updated_at);
          if (!acceptTimestamp(valve.tag, timestamp)) continue;
          valveValues[valve.tag] = valve.state;
        }
        setValues((current) => {
          if (Object.entries(parameterValues).every(([tag, value]) => current[tag] === value)) return current;
          return { ...current, ...parameterValues };
        });
        setValves((current) => {
          if (Object.entries(valveValues).every(([tag, state]) => current[tag] === state)) return current;
          return { ...current, ...valveValues };
        });
      })
      .catch((error: unknown) => {
        if (!abortController.signal.aborted) console.error('Failed to load latest HMI data', error);
      });
    const es = new EventSource(`/api/realtime/stream?machine=${encodeURIComponent(machine)}`);
    es.onmessage = (event) => {
      try {
        const message: LiveMessage = JSON.parse(event.data);
        if (message.line.toLowerCase() !== line.toLowerCase()) return;
        if (message.machine.toLowerCase() !== machine.toLowerCase()) return;
        const nextValues: Record<string, number | null> = {};
        const nextValves: Record<string, boolean> = {};
        for (const [tag, value] of Object.entries(message.values)) {
          if (!sensorTags.includes(tag) || message.quality?.[tag] === 'BAD' || !Number.isFinite(value)) continue;
          const timestamp = timestampFrom(message.timestamps?.[tag]) ?? timestampFrom(message.ts);
          if (acceptTimestamp(tag, timestamp)) nextValues[tag] = value;
        }
        for (const [tag, state] of Object.entries(message.valves)) {
          if (!valveTags.includes(tag)) continue;
          const timestamp = timestampFrom(message.timestamps?.[tag]) ?? timestampFrom(message.ts);
          if (!acceptTimestamp(tag, timestamp)) continue;
          nextValves[tag] = state;
        }
        for (const [tag, quality] of Object.entries(message.quality ?? {})) {
          if (!valveTags.includes(tag) || quality !== 'BAD') continue;
          const timestamp = timestampFrom(message.timestamps?.[tag]) ?? timestampFrom(message.ts);
          acceptTimestamp(tag, timestamp);
        }
        if (Object.keys(nextValues).length > 0) {
          setValues((current) => {
            if (Object.entries(nextValues).every(([tag, value]) => current[tag] === value)) return current;
            return { ...current, ...nextValues };
          });
        }
        if (Object.keys(nextValves).length > 0) {
          setValves((current) => {
            if (Object.entries(nextValves).every(([tag, state]) => current[tag] === state)) return current;
            return { ...current, ...nextValves };
          });
        }
      } catch (error) {
        console.error('Failed to parse realtime HMI message', error);
      }
    };
    return () => {
      abortController.abort();
      es.close();
    };
  }, [line, machine, sensorTags, valveTags]);

  useEffect(() => {
    syncSvgStates();
  }, [syncSvgStates]);

  return (
    <section aria-labelledby="hmi-tank-title">
      <h2 id="hmi-tank-title" style={{ margin: '0 0 8px' }}>{tank} Tank</h2>
      <div style={{ overflowX: 'auto', borderRadius: 6, background: '#02020a', position: 'relative' }}>
        <object
          ref={svgRef}
          type="image/svg+xml"
          data={`/hmi-${tank.toLowerCase()}-tank.svg`}
          width={2080}
          height={1070}
          aria-label={`Diagram HMI interaktif ${tank} Tank`}
          onLoad={handleSvgLoad}
          style={{ display: 'block', width: '100%', minWidth: 960, maxWidth: 1800, height: 'auto', visibility: svgReadyFor === tank ? 'visible' : 'hidden' }}
        >
          Diagram HMI {tank} Tank
        </object>
      </div>
      <svg
        id={`line3-${tank.toLowerCase()}-sensor-values`}
        role="group"
        aria-label={`${tank} Tank sensor readings`}
        viewBox={`0 0 ${sensorViewWidth} ${sensorViewHeight}`}
        style={{ display: 'block', width: '100%', height: 'auto', marginTop: 12 }}
      >
        {sensorTags.map((tag, index) => {
          const x = (index % SENSOR_COLUMNS) * (SENSOR_CARD_WIDTH + SENSOR_GAP);
          const y = Math.floor(index / SENSOR_COLUMNS) * (SENSOR_CARD_HEIGHT + SENSOR_GAP);
          const valueUnavailable = values[tag] == null;
          const state = valueUnavailable ? 'unknown' : 'good';
          const value = valueUnavailable ? '—' : formatSensorValue(tag, values[tag]!);
          return (
            <g key={tag} id={`sensor-${tag}`} data-tag={tag} data-state={state}>
              <rect
                x={x}
                y={y}
                width={SENSOR_CARD_WIDTH}
                height={SENSOR_CARD_HEIGHT}
                rx={4}
                fill="#fff"
                stroke="#d5d9de"
              />
              <text x={x + 10} y={y + 22} fill="#5b6168" fontSize={12}>{line3SensorDisplayName(tag)}</text>
              <text id={`sensor-value-${tag}`} data-value-for={tag} x={x + 10} y={y + 47} fill="#191c1e" fontSize={16} fontWeight={700}>
                {value}
              </text>
              <text x={x + SENSOR_CARD_WIDTH - 10} y={y + 47} textAnchor="end" fill="#5b6168" fontSize={12}>
                {unitForSensor(tag)}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 4, marginTop: 8 }}>
        {valveTags.map((tag) => {
          const state = getValveState(tag);
          const label = state === 'on' ? 'ON' : state === 'off' ? 'OFF' : 'UNKNOWN';
          const color = state === 'on' ? '#1f9d4d' : state === 'off' ? '#d32f2f' : '#9aa0a6';
          return <span key={tag} style={{ padding: '4px 6px', borderRadius: 4, color: '#fff', background: color, fontSize: 12 }}>{tag}: {label}</span>;
        })}
      </div>
    </section>
  );
}
