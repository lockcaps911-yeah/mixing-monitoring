'use client';

import { useState } from 'react';
import MimicLive from '@/components/MimicLive';
import HmiTank from '@/components/HmiTank';
import Line4FillingRoomLive from '@/components/Line4FillingRoomLive';
import { SCREENS } from '@/lib/mimic/screens';

export default function MimicTabs({ line, machine, initial }: { line: string; machine: string; initial?: string }) {
  const isLine3Mixing = line.toLowerCase() === 'line3' && machine.toLowerCase() === 'mixingl3';
  const isLine4Mixing = line.toLowerCase() === 'line4' && machine.toLowerCase() === 'mixingl4';
  const firstReady = SCREENS.find((s) => s.config)!.id;
  const initialScreen = SCREENS.find((s) => s.id === initial && s.config)?.id;
  const [active, setActive] = useState(
    isLine3Mixing ? (initial === 't2Tank' ? 't2Tank' : 't1Tank') : initialScreen ?? firstReady,
  );
  const screen = SCREENS.find((s) => s.id === active && s.config);

  return (
    <div>
      <div role="tablist" aria-label="Layar proses" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {isLine3Mixing
          ? (['t1Tank', 't2Tank'] as const).map((tank, i) => {
              const selected = active === tank;
              return (
                <button
                  key={tank}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActive(tank)}
                  style={{
                    font: 'inherit', fontWeight: 600, padding: '10px 18px', minHeight: 44, borderRadius: 6, cursor: 'pointer',
                    border: '1px solid #c5c6cc', background: selected ? '#1f2937' : '#fff', color: selected ? '#fff' : '#191c1e',
                  }}
                >
                  {i + 1}. {tank === 't1Tank' ? 'T1 Tank' : 'T2 Tank'}
                </button>
              );
            })
          : SCREENS.map((s, i) => {
              const selected = s.id === active;
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={selected}
                  disabled={!s.config}
                  onClick={() => setActive(s.id)}
                  style={{
                    font: 'inherit', fontWeight: 600, padding: '10px 18px', minHeight: 44, borderRadius: 6, cursor: s.config ? 'pointer' : 'not-allowed',
                    border: '1px solid #c5c6cc', background: selected ? '#1f2937' : '#fff', color: selected ? '#fff' : s.config ? '#191c1e' : '#9aa0a6',
                  }}
                >
                  {i + 1}. {s.label}{!s.config && ' (segera)'}
                </button>
              );
          })}
      </div>
      {isLine3Mixing ? (
        <HmiTank line={line} machine={machine} tank={active === 't2Tank' ? 'T2' : 'T1'} />
      ) : (
        screen?.config && (
          isLine4Mixing && screen.id === 'filling' ? (
            <Line4FillingRoomLive key={screen.id} />
          ) : (
            <MimicLive key={screen.id} line={line} machine={machine} config={screen.config} />
          )
        )
      )}
    </div>
  );
}
