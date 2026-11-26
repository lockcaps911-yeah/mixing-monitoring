'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ParamInfo, Point, Snapshot } from '@/lib/types';
import type { RealtimeMessage } from '@/lib/realtime';
import {
  AREA_LABEL, AREA_ORDER, formatEngineeringParameterValue, TYPE_DIGITS, TYPE_LABEL, VALVE_GROUP_LABEL,
  shortLabel, type ParamType,
} from '@/lib/classify';
import { RANGES, type RangeKey, type TrendRow } from '@/lib/ranges';
import RealtimeChart, { COLORS, DASHES, fmtClock, fmtDateTime, xDomain, valueAt, type Series } from '@/components/RealtimeChart';
import MachineSelect from '@/components/MachineSelect';
import { line3SensorDisplayName } from '@/lib/mimic/line3TankTags';

type Mode = 'live' | RangeKey;
const MODES: { key: Mode; label: string }[] = [
  { key: 'live', label: 'Live' }, { key: 'hour', label: '1 Jam' }, { key: 'day', label: '24 Jam' },
  { key: 'week', label: '1 Minggu' }, { key: 'month', label: '1 Bulan' },
];
const LIVE_WINDOW = 10 * 60_000;
const HISTORY_MS = 30 * 60_000;
const STALE_MS = 10_000;
const TABS: ParamType[] = ['temperature', 'pressure', 'weight', 'conductivity', 'frequency'];
const bucketText = (s: number) => (s < 60 ? `${s} detik` : s < 3600 ? `${s / 60} menit` : `${s / 3600} jam`);

type Live = { v: number; ts: number; receivedAt: number; quality: 'GOOD' | 'BAD' };
type ValveLive = { state: boolean | null; since: number | null };
type Machines = { code: string; line_code: string; name: string }[];

function Spark({ pts }: { pts: Point[] }) {
  const W = 120;
  const H = 28;
  if (pts.length < 2) return <svg className="spark" viewBox={`0 0 ${W} ${H}`} aria-hidden />;
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const x0 = pts[0][0];
  const x1 = pts[pts.length - 1][0];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(((p[0] - x0) / (x1 - x0 || 1)) * W).toFixed(1)},${(y1 === y0 ? H / 2 : H - 3 - ((p[1] - y0) / (y1 - y0)) * (H - 6)).toFixed(1)}`).join('');
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden><path d={d} fill="none" vectorEffect="non-scaling-stroke" /></svg>;
}

export default function MachineDashboard({ snapshot, history, machines }: { snapshot: Snapshot; history: Record<string, Point[]>; machines: Machines }) {
  const { machine, parameters, valves } = snapshot;
  const isLine3 = machine.line.toLowerCase() === 'line3';
  const isLine4 = machine.line.toLowerCase() === 'line4';
  const displayTag = (tag: string) => isLine3 ? line3SensorDisplayName(tag) : tag;
  const byTag = useMemo(() => new Map(parameters.map((p) => [p.tag, p])), [parameters]);

  const [live, setLive] = useState<Record<string, Live>>(() =>
    Object.fromEntries(parameters.filter((p) => p.value != null && p.at).map((p) => [
      p.tag,
      {
        v: p.value as number,
        ts: new Date(p.at as string).getTime(),
        receivedAt: new Date(p.at as string).getTime(),
        quality: p.quality ?? 'GOOD',
      },
    ])));
  const [trend, setTrend] = useState(history);
  const [valveLive, setValveLive] = useState<Record<string, ValveLive>>(() =>
    Object.fromEntries(valves.map((v) => [v.tag, { state: v.state, since: v.changedAt ? new Date(v.changedAt).getTime() : null }])));
  const [connected, setConnected] = useState(false);
  const [lastGoodDataAt, setLastGoodDataAt] = useState<number | null>(() => {
    const timestamps = parameters
      .filter((parameter) => parameter.value !== null && parameter.quality !== 'BAD' && parameter.at)
      .map((parameter) => new Date(parameter.at!).getTime())
      .filter(Number.isFinite);
    return timestamps.length ? Math.max(...timestamps) : null;
  });
  const [now, setNow] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('live');
  const [hover, setHover] = useState<number | null>(null);
  const [vf, setVf] = useState<'all' | 'on' | 'off'>('all');
  const [tab, setTab] = useState<ParamType>(() => TABS.find((t) => parameters.some((p) => !p.isBool && p.type === t)) ?? 'temperature');
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const [hist, setHist] = useState<{ key: string; rows: Record<string, TrendRow[]> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, []);

  // ---------- realtime (SSE) ----------
  useEffect(() => {
    const lineFilter = machine.line.toLowerCase() === 'line4' ? '&line=line4' : '';
    const es = new EventSource(`/api/realtime/stream?machine=${encodeURIComponent(machine.code)}${lineFilter}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      const m: RealtimeMessage = JSON.parse(e.data);
      if (m.line.toLowerCase() !== machine.line.toLowerCase()) return;
      const ts = new Date(m.ts).getTime();
      const readings = m.values;
      const hasGoodReading = Object.entries(readings).some(([tag, value]) =>
        m.quality[tag] === 'GOOD' && Number.isFinite(value),
      ) || Object.entries(m.valves).some(([tag, value]) =>
        m.quality[tag] === 'GOOD' && typeof value === 'boolean',
      );
      const receivedAt = Date.now();
      if (hasGoodReading) setLastGoodDataAt(receivedAt);

      setLive((prev) => {
        const n = { ...prev };
        for (const [t, v] of Object.entries(readings)) {
          const quality = m.quality[t] ?? 'GOOD';
          n[t] = {
            v,
            ts: m.timestamps[t] ? new Date(m.timestamps[t]).getTime() : ts,
            receivedAt: isLine4 && quality === 'GOOD'
              ? receivedAt
              : m.timestamps[t] ? new Date(m.timestamps[t]).getTime() : ts,
            quality,
          };
        }
        return n;
      });
      setTrend((prev) => {
        const n = { ...prev };
        const cutoff = ts - HISTORY_MS;
        for (const [tag, v] of Object.entries(readings)) {
          if (byTag.get(tag)?.isBool) continue;
          const valueTs = isLine4
            ? receivedAt
            : m.timestamps[tag] ? new Date(m.timestamps[tag]).getTime() : ts;
          const arr: Point[] = [...(n[tag] ?? []), [valueTs, v]];
          let i = 0;
          while (i < arr.length && arr[i][0] < cutoff) i++;
          n[tag] = i ? arr.slice(i) : arr;
        }
        return n;
      });
      setValveLive((prev) => {
        const n = { ...prev };
        for (const [tag, state] of Object.entries(m.valves)) if (n[tag]?.state !== state) n[tag] = { state, since: ts };
        return n;
      });
    };
    return () => es.close();
  }, [machine.code, machine.line, byTag, isLine4]);

  // ---------- pilihan parameter untuk grafik ----------
  const analog = parameters.filter((p) => !p.isBool);
  const tabs = TABS.filter((t) => analog.some((p) => p.type === t));
  const tabParams = analog.filter((p) => p.type === tab);
  const defaultSel = (t: string) => {
    const ps = analog.filter((p) => p.type === t);
    return (ps.some((p) => p.critical) ? ps.filter((p) => p.critical) : ps).slice(0, 6).map((p) => p.tag);
  };
  const selected = (sel[tab] ?? defaultSel(tab)).filter((t) => byTag.has(t));
  const selKey = selected.join(',');
  const toggle = (tag: string) =>
    setSel((s) => {
      const cur = s[tab] ?? defaultSel(tab);
      const next = cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag].slice(-6);
      return { ...s, [tab]: next.length ? next : cur };
    });

  // ---------- data historis teragregasi ----------
  useEffect(() => {
    if (mode === 'live' || !selKey) return;
    let alive = true;
    const load = async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/trend/${machine.line}/${machine.code}?range=${mode}&tags=${encodeURIComponent(selKey)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (alive) setHist({ key: `${mode}|${selKey}`, rows: d.series });
      } catch (e) {
        if (alive) setErr((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [mode, selKey, machine.line, machine.code]);

  const isLive = mode === 'live';
  const histRows = hist && hist.key === `${mode}|${selKey}` ? hist.rows : null;
  const series: Series[] = selected.map((tag) => {
    const p = byTag.get(tag) as ParamInfo;
    if (isLive) return { tag, name: displayTag(tag), unit: p.unit, digits: TYPE_DIGITS[p.type], pts: trend[tag] ?? [] };
    const rows = histRows?.[tag] ?? [];
    return {
      tag, name: displayTag(tag), unit: p.unit, digits: TYPE_DIGITS[p.type],
      pts: rows.map((r) => [r[0], r[1]] as Point),
      band: rows.map((r) => [r[0], r[2], r[3]] as [number, number, number]),
    };
  });
  const windowMs = isLive ? LIVE_WINDOW : RANGES[mode].ms;
  const gapMs = isLive ? 15_000 : RANGES[mode].bucketS * 3000;
  const dom = xDomain(series, windowMs, now);
  const hoverT = hover === null ? null : dom.xMin + hover * windowMs;
  const digits = TYPE_DIGITS[tab];

  const statRows = series.map((s, i) => {
    const pts = s.pts.filter((p) => p[0] >= dom.xMin);
    if (!pts.length) return null;
    const vals = pts.map((p) => p[1]);
    const mins = s.band ? s.band.map((b) => b[1]) : vals;
    const maxs = s.band ? s.band.map((b) => b[2]) : vals;
    return {
      s, i, last: vals[vals.length - 1],
      min: mins.reduce((a, b) => Math.min(a, b), Infinity),
      max: maxs.reduce((a, b) => Math.max(a, b), -Infinity),
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    };
  });

  // ---------- turunan status ----------
  const val = (tag: string) => live[tag]?.v ?? null;
  const stale = (tag: string) =>
    now !== null &&
    !!live[tag] &&
    (live[tag].quality === 'BAD' ||
      now - (isLine4 ? live[tag].receivedAt : live[tag].ts) > STALE_MS);
  const alarmParams = parameters.filter((p) => p.role === 'fault' || p.role === 'estop');
  const alarms = alarmParams.filter((p) => (val(p.tag) ?? 0) > 0);
  const estop = alarms.some((a) => a.role === 'estop');
  const running = parameters.some((p) => p.role === 'run' && (val(p.tag) ?? 0) > 0) || analog.some((p) => p.type === 'frequency' && (val(p.tag) ?? 0) > 1);
  const lastReadingTs = Math.max(0, ...Object.values(live).map((l) => l.ts));
  const lastTs = isLine4 ? lastGoodDataAt ?? lastReadingTs : lastReadingTs;
  const ageSec = now !== null && lastTs ? Math.max(0, Math.round((now - lastTs) / 1000)) : null;
  const line4TelemetryActive = isLine4 &&
    connected &&
    now !== null &&
    lastGoodDataAt !== null &&
    now - lastGoodDataAt <= 15_000;
  const noData = isLine4
    ? !line4TelemetryActive
    : ageSec !== null && ageSec > 15;
  const status = noData
    ? { text: 'Data Tidak Masuk', tone: 'warn' }
    : estop
      ? { text: 'E-Stop Aktif', tone: 'bad' }
      : alarms.length
        ? { text: 'Ada Gangguan', tone: 'bad' }
        : (isLine4 ? line4TelemetryActive : running)
          ? { text: 'Mesin Berjalan', tone: 'ok' }
          : { text: 'Standby', tone: 'idle' };
  const vOn = valves.filter((v) => valveLive[v.tag]?.state === true).length;
  const vOff = valves.filter((v) => valveLive[v.tag]?.state === false).length;

  const valveGroups = useMemo(() => {
    const m = new Map<string, typeof valves>();
    for (const v of valves) {
      const k = v.tag.replace(/\d.*$/, '') || 'Lainnya';
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return [...m].sort(([a], [b]) => a.localeCompare(b));
  }, [valves]);

  const lineLabel = machine.line.replace(/^line(\d+)/i, 'Line $1');
  const badge = (p: ParamInfo) => {
    const v = val(p.tag);
    if (live[p.tag]?.quality === 'BAD') {
      return <span className="badge warn" title="Nilai terakhir diterima, tetapi kualitas tag KepServer sedang buruk">Kualitas buruk · nilai cache</span>;
    }
    if (stale(p.tag)) return <span className="badge warn">Tidak update</span>;
    if (v !== null) {
      if ((p.min != null && v < p.min) || (p.max != null && v > p.max)) return <span className="badge bad">Di luar batas</span>;
    }
    return <span className="badge ok">Normal</span>;
  };

  return (
    <>
      <header className="sc-head">
        <div className="sc-hl">
          <span className="sc-title">Mixing {lineLabel}</span>
          <label className="sc-sel"><span>Mesin</span><MachineSelect machines={machines} current={`${machine.line}/${machine.code}`} /></label>
        </div>
        <div className="sc-hr">
          <span className="sc-pill">Pembaruan <b>{now !== null && lastTs ? fmtClock(lastTs) : '–'}</b></span>
          <span className={`sc-pill ${connected ? 'ok' : 'bad'}`}><i />{connected ? 'Terhubung' : 'Terputus'}</span>
        </div>
      </header>

      <main className="sc-main">
        <div className="sc-pagehead">
          <h1>Dashboard Realtime</h1>
          <p>{machine.name}: pemantauan proses dan nilai parameter terkalibrasi melalui KEPServerEX</p>
        </div>

        {/* Status mesin */}
        <section className={`card banner ${status.tone}`}>
          <div className="who"><strong>{machine.code}</strong><span>{machine.name}</span></div>
          <div className="state"><i />{status.text}</div>
          <dl className="meta">
            <div><dt>Valve terbuka</dt><dd>{vOn} <small>dari {valves.length}</small></dd></div>
            <div><dt>Parameter</dt><dd>{analog.length}</dd></div>
            <div><dt>Data terakhir</dt><dd>{ageSec !== null ? `${ageSec} dtk lalu` : '–'}</dd></div>
          </dl>
        </section>

        {/* Alarm */}
        {alarmParams.length > 0 && (
          <section className={`card alarm ${alarms.length ? 'bad' : 'ok'}`}>
            <div className="alarm-title">
              <strong>{alarms.length ? `${alarms.length} Alarm Aktif` : 'Tidak Ada Alarm Aktif'}</strong>
              <span>{alarms.length ? 'Periksa sinyal di bawah' : `${alarmParams.length} sinyal alarm dan E-Stop dipantau`}</span>
              <Link className="alarm-link" href={`/dashboard/${machine.line}/${machine.code}/alarms`}>Lihat riwayat alarm</Link>
            </div>
            {alarms.length > 0 && (
              <ul>{alarms.map((a) => <li key={a.tag} title={displayTag(a.label)}><b>{displayTag(a.tag)}</b> {displayTag(a.label)}</li>)}</ul>
            )}
          </section>
        )}

        {/* Parameter per area */}
        {AREA_ORDER.map((area) => {
          const items = analog.filter((p) => p.area === area);
          if (!items.length) return null;
          const crit = items.filter((p) => p.critical);
          const rest = items.filter((p) => !p.critical);
          const runs = parameters.filter((p) => p.area === area && p.role === 'run');
          return (
            <section key={area} className="card">
              <div className="card-head">
                <div><h2>{AREA_LABEL[area]}</h2><p>{items.length} parameter</p></div>
                <div className="chips">
                  {runs.map((r) => {
                    const on = (val(r.tag) ?? 0) > 0;
                    return <span key={r.tag} className={`chip ${on ? 'on' : 'off'}`} title={displayTag(r.label)}><i />{displayTag(r.tag)}: {on ? 'Jalan' : 'Berhenti'}</span>;
                  })}
                </div>
              </div>
              {crit.length > 0 && (
                <div className="cards big">
                  {crit.map((p) => (
                    <article key={p.tag} className="metric" title={displayTag(p.label)}>
                      <div className="mh"><span>{shortLabel(p.type, p.tag)}</span>{badge(p)}</div>
                      <div className={`mv ${stale(p.tag) ? 'dim' : ''}`}><span className="mv-value">{val(p.tag) !== null ? formatEngineeringParameterValue(val(p.tag)!, p.type, machine.line) : '–'}</span><small>{p.unit}</small></div>
                      <div className="mf"><code>{displayTag(p.tag)}</code><Spark pts={(trend[p.tag] ?? []).slice(-150)} /></div>
                    </article>
                  ))}
                </div>
              )}
              {rest.length > 0 && (
                <div className="cards mini">
                  {rest.map((p) => (
                    <article key={p.tag} className="mini-card" title={displayTag(p.label)}>
                      <div className="mh"><code>{displayTag(p.tag)}</code>{stale(p.tag) && <span className="badge warn">Tidak update</span>}</div>
                      <div className={`mv ${stale(p.tag) ? 'dim' : ''}`}><span className="mv-value">{val(p.tag) !== null ? formatEngineeringParameterValue(val(p.tag)!, p.type, machine.line) : '–'}</span><small>{p.unit}</small></div>
                      <span className="cap">{shortLabel(p.type, p.tag)}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* Grafik tren */}
        {tabs.length > 0 && (
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Grafik Tren</h2>
                <p>{isLive ? 'Data langsung, 10 menit terakhir' : `Rata-rata per ${bucketText(RANGES[mode].bucketS)}; area transparan = rentang min sampai maks`}</p>
              </div>
              <div className="seg" role="group" aria-label="Rentang waktu">
                {MODES.map((m) => <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</button>)}
              </div>
            </div>

            <div className="tabs" role="tablist" aria-label="Jenis parameter">
              {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setHover(null); }}>{TYPE_LABEL[t]}</button>)}
            </div>

            <div className="legend">
              {tabParams.map((p) => {
                const idx = selected.indexOf(p.tag);
                const on = idx >= 0;
                const hv = on && hoverT !== null ? valueAt(series[idx].pts, hoverT, Math.max(6000, gapMs / 2)) : null;
                const shown = hv ?? val(p.tag);
                return (
                  <button key={p.tag} type="button" className={`lchip ${on ? 'on' : ''}`} aria-pressed={on} title={displayTag(p.label)} onClick={() => toggle(p.tag)}>
                    {on && <svg viewBox="0 0 26 8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={COLORS[idx % COLORS.length]} strokeWidth="2.6" strokeDasharray={DASHES[idx % DASHES.length] || undefined} /></svg>}
                    <b>{displayTag(p.tag)}</b>{on && <span>{shown !== null ? formatEngineeringParameterValue(shown, p.type, machine.line) : '–'} {p.unit}</span>}
                  </button>
                );
              })}
            </div>

            <div className="chartbox">
              {!isLive && loading && !histRows && <span className="loading">Memuat data…</span>}
              {err && <span className="loading err">Gagal memuat: {err}</span>}
              <RealtimeChart series={series} windowMs={windowMs} now={now} hoverFrac={hover} onHover={setHover} gapMs={gapMs} />
              {hoverT !== null && now !== null && <span className="hovertime">{isLive ? fmtClock(hoverT) : fmtDateTime(hoverT)}</span>}
            </div>

            <div className="tablewrap">
              <table className="stats">
                <thead><tr><th>Parameter</th><th>Terakhir</th><th>Min</th><th>Rata-rata</th><th>Maks</th></tr></thead>
                <tbody>
                  {statRows.map((r) => r && (
                    <tr key={r.s.tag}>
                      <td><svg viewBox="0 0 26 8" aria-hidden><line x1="0" y1="4" x2="26" y2="4" stroke={COLORS[r.i % COLORS.length]} strokeWidth="2.6" strokeDasharray={DASHES[r.i % DASHES.length] || undefined} /></svg><b>{displayTag(r.s.tag)}</b> <small>{r.s.unit}</small></td>
                      <td>{formatEngineeringParameterValue(r.last, tab, machine.line, digits)}</td>
                      <td>{formatEngineeringParameterValue(r.min, tab, machine.line, digits)}</td>
                      <td>{formatEngineeringParameterValue(r.avg, tab, machine.line, digits)}</td>
                      <td>{formatEngineeringParameterValue(r.max, tab, machine.line, digits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Valve */}
        {valves.length > 0 && (
          <section id="valves" className="card">
            <div className="card-head">
              <div>
                <h2>Monitoring Valve</h2>
                <p><b className="t-on">{vOn} buka</b>, <b className="t-off">{vOff} tutup</b>, {valves.length - vOn - vOff} belum ada data, dari {valves.length} valve</p>
              </div>
              <div className="seg" role="group" aria-label="Filter valve">
                {([['all', 'Semua'], ['on', 'Buka'], ['off', 'Tutup']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={vf === k} onClick={() => setVf(k)}>{l}</button>)}
              </div>
            </div>
            {valveGroups.map(([k, list]) => {
              const shown = list.filter((v) => vf === 'all' || (vf === 'on' ? valveLive[v.tag]?.state === true : valveLive[v.tag]?.state === false));
              if (!shown.length) return null;
              const open = list.filter((v) => valveLive[v.tag]?.state === true).length;
              return (
                <div key={k} className="vgroup">
                  <h3>{k} <small>{VALVE_GROUP_LABEL[k] ?? ''}</small><span>{open} dari {list.length} buka</span></h3>
                  <div className="vgrid">
                    {shown.map((v) => {
                      const s = valveLive[v.tag]?.state;
                      const cls = s === true ? 'on' : s === false ? 'off' : 'na';
                      return (
                        <div key={v.tag} className={`vcard ${cls}`} title={v.description ?? v.name}>
                          <i /><b>{v.tag}</b><span>{s === true ? 'Buka' : s === false ? 'Tutup' : 'Tidak ada data'}</span>
                          {now !== null && valveLive[v.tag]?.since && <small>sejak {fmtClock(valveLive[v.tag].since as number, false)}</small>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </main>
    </>
  );
}
