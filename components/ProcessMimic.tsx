import type { MimicConfig, MimicInstrument } from '@/lib/mimic/types';
import { formatRawParameterValue, normalizeType } from '@/lib/classify';

// Warna status valve. Ubah di sini bila ingin warna lain.
export const VALVE_COLOR = { on: '#1f9d4d', off: '#d32f2f', unknown: '#9aa0a6' } as const;
const DEFAULT_VALVE_LABELS = { on: 'ON (buka)', off: 'OFF (tutup)', unknown: 'tidak ada data' } as const;
const MOTOR_ON = '#3ddc5f';

type Props = {
  config: MimicConfig;
  valves: Record<string, boolean | null | undefined>;  // tag -> true (ON/buka), false (OFF/tutup), null (belum ada data)
  values?: Record<string, number | null | undefined>;  // tag -> nilai engineering unit
  stale?: boolean;                                      // data tidak update -> semua valve abu-abu
  onValveClick?: (tag: string) => void;
  valveLabels?: { on: string; off: string; unknown: string };
};

const stateOf = (value: boolean | null | undefined, stale?: boolean, inverted?: boolean) =>
  stale || value === null || value === undefined
    ? 'unknown'
    : (inverted ? !value : value) ? 'on' : 'off';

export default function ProcessMimic({
  config,
  valves,
  values = {},
  stale,
  onValveClick,
  valveLabels = DEFAULT_VALVE_LABELS,
}: Props) {
  const { width, height, x0 = 0, y0 = 0 } = config;
  const gradId = `mimic-tank-grad-${config.title.replace(/\W/g, '')}`;
  const fmt = (ins: MimicInstrument) => {
    const v = values[ins.tag];
    return v === null || v === undefined
      ? '–'
      : formatRawParameterValue(v, normalizeType(null, ins.unit, ins.tag), ins.digits);
  };
  const fmtSet = (ins: MimicInstrument) => {
    const v = ins.setTag ? values[ins.setTag] : undefined;
    return v === null || v === undefined
      ? '–'
      : formatRawParameterValue(v, normalizeType(null, ins.unit, ins.tag), ins.digits);
  };
  const running = (runTag: string | undefined, fallbackTag?: string) => {
    if (stale) return false;
    const v = runTag ? values[runTag] : fallbackTag ? values[fallbackTag] : undefined;
    return (v ?? 0) > 0;
  };
  const panel = config.instruments.filter((i) => !i.pos);
  const ib = config.instrumentBox ?? { x: 0, y: 0 };

  return (
    <svg viewBox={`${x0} ${y0} ${width} ${height}`} width="100%" role="img" aria-label={`Mimic ${config.title}`}
         style={{ display: 'block', maxWidth: Math.min(1200, width * 1.2), fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#aeb3b8" />
          <stop offset="45%" stopColor="#f4f5f6" />
          <stop offset="100%" stopColor="#a4a9ae" />
        </linearGradient>
      </defs>

      <rect x={x0} y={y0} width={width} height={height} rx="6" fill="#d3d6d9" />

      {config.pipes.map((p, i) => (
        <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={p.width ?? 3} strokeLinejoin="round" />
      ))}

      {config.tanks.map((t, i) => (
        <rect key={i} x={t.x} y={t.y} width={t.w} height={t.h} rx="28" fill={`url(#${gradId})`} stroke="#8d9297" />
      ))}
      {config.tankLabel && (
        <text x={config.tankLabel.x} y={config.tankLabel.y} textAnchor="middle" fontSize="24" fontWeight="600" fill="#222">
          {config.tankLabel.text}
        </text>
      )}

      {/* Agitator: bilah bergerak saat RUN = 1 */}
      {(config.agitators ?? []).map((a, i) => {
        const on = running(a.runTag);
        return (
          <g key={i} stroke="#333" fill="#333">
            <line x1={a.x} y1={a.y} x2={a.x} y2={a.y + a.h} strokeWidth="3" />
            <rect x={a.x - 18} y={a.y + a.h - 3} width="36" height="6" rx="3">
              {on && <animate attributeName="x" values={`${a.x - 18};${a.x - 4};${a.x - 18}`} dur="0.8s" repeatCount="indefinite" />}
              {on && <animate attributeName="width" values="36;8;36" dur="0.8s" repeatCount="indefinite" />}
            </rect>
          </g>
        );
      })}

      {/* Pompa: bentuk tetap (tidak bergeser); hanya warna yang berubah, hijau saat RUN = 1.
          (p.x, p.y) = pusat casing. Hisap di kiri, keluar di atas, drain di bawah. */}
      {(config.pumps ?? []).map((p, i) => {
        const fill = running(p.runTag) ? MOTOR_ON : '#d9dcdf';
        return (
          <g key={i} stroke="#444" strokeWidth="1.2" fill={fill} style={{ transition: 'fill .3s' }}>
            <rect x={p.x - 4} y={p.y - 19} width="8" height="7" />               {/* stub keluar atas */}
            <rect x={p.x - 16} y={p.y - 8} width="5" height="16" fill="#e8eaec" /> {/* flens hisap */}
            <rect x={p.x - 11} y={p.y - 13} width="22" height="25" rx="4" />     {/* casing */}
            <rect x={p.x + 11} y={p.y - 4} width="5" height="8" fill="#9aa0a6" /> {/* kopling */}
            <rect x={p.x + 16} y={p.y - 10} width="33" height="21" rx="3" />     {/* motor */}
            <rect x={p.x + 20} y={p.y + 11} width="25" height="3" fill="#6b7280" /> {/* kaki */}
            {[22, 28, 34, 40, 46].map((dx) => (
              <line key={dx} x1={p.x + dx} y1={p.y - 8} x2={p.x + dx} y2={p.y + 9} />
            ))}
          </g>
        );
      })}

      {config.arrows.map((a, i) => (
        <polygon key={i} points="0,0 -10,-5 -10,5" fill={a.color} transform={`translate(${a.x} ${a.y}) rotate(${a.rot})`} />
      ))}

      {config.texts.map((t, i) => (
        <text key={i} x={t.x} y={t.y} textAnchor={t.anchor ?? 'start'} fontSize={t.size ?? 13} fill="#222"
              fontWeight={t.bold ? 700 : undefined} textDecoration={t.underline ? 'underline' : undefined}
              transform={t.rotate ? `rotate(${t.rotate} ${t.x} ${t.y})` : undefined}>
          {t.text}
        </text>
      ))}

      {/* Valve: satu <g> per valve; warna ditentukan oleh data PLC */}
      {config.valves.map((v) => {
        const s = stateOf(valves[v.tag], stale, v.inverted);
        const color = VALVE_COLOR[s === 'on' ? 'on' : s === 'off' ? 'off' : 'unknown'];
        const text = valveLabels[s];
        return (
          <g key={v.tag} id={`valve-${v.tag}`} data-tag={v.tag} data-state={s}
             style={{ cursor: onValveClick ? 'pointer' : 'default' }}
             onClick={onValveClick ? () => onValveClick(v.tag) : undefined}>
            <title>{`${v.tag}: ${text}`}</title>
            <g transform={`translate(${v.x} ${v.y}) rotate(${v.vertical ? 90 : 0})`}>
              <rect x="-15" y="-10" width="30" height="20" fill="transparent" />
              <g fill={color} stroke="#222" strokeWidth="1.2" style={{ transition: 'fill .3s' }}>
                <polygon points="-12,-7 0,0 -12,7" />
                <polygon points="12,-7 0,0 12,7" />
              </g>
            </g>
            <text x={v.label.x} y={v.label.y} textAnchor={v.label.anchor ?? 'middle'} fontSize="12" fontWeight="600" fill="#222"
                  transform={v.label.rotate ? `rotate(-90 ${v.label.x} ${v.label.y})` : undefined}>
              {v.tag}
            </text>
          </g>
        );
      })}

      {/* Instrumen pada posisi tertentu */}
      {config.instruments.filter((i) => i.pos).map((ins) => {
        const { x, y } = ins.pos!;
        if (ins.kind === 'motor') {
          const on = running(ins.runTag, ins.tag);
          return (
            <g key={ins.tag} transform={`translate(${x} ${y})`}>
              <title>{ins.tag}</title>
              <rect width="70" height="24" fill={on ? MOTOR_ON : '#e4e6e8'} stroke="#555" />
              <text x="35" y="17" textAnchor="middle" textLength="64" lengthAdjust="spacingAndGlyphs" fontSize="12" fontWeight="700" fill="#111">{fmt(ins)} {ins.unit}</text>
              {ins.setTag && (
                <g transform="translate(0 31)">
                  <title>{ins.setTag}</title>
                  <rect width="70" height="24" fill="#fff" stroke="#555" />
                  <text x="35" y="17" textAnchor="middle" textLength="64" lengthAdjust="spacingAndGlyphs" fontSize="12" fontWeight="700" fill="#111">{fmtSet(ins)} {ins.unit}</text>
                </g>
              )}
            </g>
          );
        }
        return (
          <g key={ins.tag} transform={`translate(${x} ${y})`}>
            <rect width="102" height="44" fill="#fff" stroke="#8d9297" />
            <text x="6" y="15" fontSize="12" fontWeight="700" fill="#222">{ins.tag}</text>
            <rect x="4" y="21" width="62" height="18" fill="#2c4a6e" />
              <text x="63" y="34" textAnchor="end" fontSize="12" fontWeight="600" fill="#fff">{fmt(ins)}</text>
            <text x="70" y="34" fontSize="10" fill="#333">{ins.unit}</text>
          </g>
        );
      })}

      {/* Panel instrumen (yang tidak punya pos) */}
      {panel.map((ins, i) => (
        <g key={ins.tag} transform={`translate(${ib.x} ${ib.y + i * 56})`}>
          <rect width="170" height="48" fill="#fff" stroke="#8d9297" />
          <text x="8" y="16" fontSize="12" fontWeight="700" fill="#222">{ins.tag}</text>
          <rect x="8" y="22" width="96" height="20" fill="#2c4a6e" />
          <text x="100" y="37" textAnchor="end" fontSize="13" fontWeight="600" fill="#fff">{fmt(ins)}</text>
          <text x="112" y="37" fontSize="11" fill="#333">{ins.unit}</text>
        </g>
      ))}

      {stale && (
        <g>
          <rect x={x0 + width / 2 - 90} y={y0 + 8} width="180" height="22" rx="4" fill="#ffdbca" />
          <text x={x0 + width / 2} y={y0 + 23} textAnchor="middle" fontSize="12" fontWeight="700" fill="#763300">Data tidak update</text>
        </g>
      )}

      {/* Legenda */}
      {([['on', valveLabels.on], ['off', valveLabels.off], ['unknown', valveLabels.unknown]] as const).map(([k, label], i) => (
        <g key={k} transform={`translate(${x0 + 16 + i * 120} ${y0 + height - 12})`}>
          <circle r="6" fill={VALVE_COLOR[k]} stroke="#222" strokeWidth="1" />
          <text x="12" y="4" fontSize="12" fill="#222">{label}</text>
        </g>
      ))}
    </svg>
  );
}