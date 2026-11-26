'use client';

import { useEffect, useState } from 'react';
import { line3SensorDisplayName } from '@/lib/mimic/line3TankTags';

type Msg = {
  line: string;
  machine: string;
  ts: string;
  values: Record<string, number>;
  valves: Record<string, boolean>;
};

export default function Live() {
  const [data, setData] = useState<Record<string, Msg>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/realtime/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      setData({});
    };
    es.onmessage = (e) => {
      const m: Msg = JSON.parse(e.data);
      setData((prev) => ({ ...prev, [`${m.line}/${m.machine}`]: m }));
    };
    return () => es.close();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: 'monospace' }}>
      <h1>Live (debug) – {connected ? '🟢 terhubung' : '🔴 terputus'}</h1>
      {Object.entries(data).map(([key, m]) => (
        <section key={key} style={{ marginBottom: 16 }}>
          <h3>{key} – {new Date(m.ts).toLocaleTimeString()}</h3>
          <pre>{JSON.stringify({
            values: Object.fromEntries(Object.entries(m.values).map(([tag, value]) => [
              m.line.toLowerCase() === 'line3' ? line3SensorDisplayName(tag) : tag,
              value,
            ])),
            valves: m.valves,
          }, null, 1)}</pre>
        </section>
      ))}
    </main>
  );
}
