'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { line3SensorDisplayName } from '@/lib/mimic/line3TankTags';

type Row = { id: string; tag: string; description: string | null; severity: 'critical' | 'alarm'; triggeredAt: string; clearedAt: string | null };
type Resp = {
  rows: Row[]; total: number;
  summary: { active: number; d1: number; d7: number };
  top: { tag: string; description: string | null; n: number }[];
};

const STATUS = [['all', 'Semua'], ['active', 'Aktif'], ['cleared', 'Selesai']] as const;
const RANGE = [['day', '24 Jam'], ['week', '7 Hari'], ['month', '30 Hari'], ['all', 'Semua']] as const;
const SEV = [['all', 'Semua'], ['critical', 'E-Stop'], ['alarm', 'Gangguan']] as const;
const PAGE_SIZE = 20;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function fmtDur(sec: number) {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} dtk`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
  return `${Math.floor(s / 3600)} j ${Math.floor((s % 3600) / 60)} mnt`;
}

export default function AlarmHistory({ line, machine }: { line: string; machine: string }) {
  const [status, setStatus] = useState<(typeof STATUS)[number][0]>('all');
  const [range, setRange] = useState<(typeof RANGE)[number][0]>('week');
  const [sev, setSev] = useState<(typeof SEV)[number][0]>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const initial = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, []);

  const qs = `status=${status}&range=${range}&severity=${sev}&q=${encodeURIComponent(q.trim())}`;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (alive) setLoading(true);
      try {
        const r = await fetch(`/api/alarms/${line}/${machine}?${qs}&page=${page}&limit=${PAGE_SIZE}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d: Resp = await r.json();
        if (alive) { setData(d); setErr(null); }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 10_000); // alarm baru ikut muncul tanpa memuat ulang
    return () => { alive = false; clearInterval(t); };
  }, [line, machine, qs, page]);

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const base = `/dashboard/${line}/${machine}`;
  const maxTop = Math.max(1, ...(data?.top.map((t) => t.n) ?? [1]));

  const group = <T extends string>(label: string, opts: readonly (readonly [T, string])[], val: T, set: (v: T) => void) => (
    <div className="fgroup">
      <span>{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {opts.map(([k, l]) => <button key={k} type="button" aria-pressed={val === k} onClick={() => resetPage(set)(k)}>{l}</button>)}
      </div>
    </div>
  );

  return (
    <>
      <header className="sc-head">
        <div className="sc-hl">
          <span className="sc-title">Riwayat Alarm</span>
          <span className="sc-pill">{machine}</span>
        </div>
        <div className="sc-hr"><Link className="sc-pill" href={base}>Kembali ke dashboard</Link></div>
      </header>

      <main className="sc-main">
        <div className="sc-pagehead">
          <h1>Riwayat Alarm</h1>
          <p>Seluruh kejadian alarm dan E-Stop yang pernah terjadi, dicatat otomatis dari sinyal PLC</p>
        </div>

        <div className="sumgrid">
          <div className={`sum ${data && data.summary.active > 0 ? 'bad' : 'ok'}`}><span>Alarm aktif sekarang</span><b>{data?.summary.active ?? '–'}</b></div>
          <div className="sum"><span>24 jam terakhir</span><b>{data?.summary.d1 ?? '–'}</b></div>
          <div className="sum"><span>7 hari terakhir</span><b>{data?.summary.d7 ?? '–'}</b></div>
          <div className="sum"><span>Sesuai filter</span><b>{data?.total ?? '–'}</b></div>
        </div>

        <section className="card">
          <div className="filters">
            {group('Status', STATUS, status, setStatus)}
            {group('Rentang', RANGE, range, setRange)}
            {group('Tingkat', SEV, sev, setSev)}
            <label className="fgroup"><span>Cari tag</span>
              <input className="finput" value={q} placeholder="mis. P1001FLT" onChange={(e) => resetPage(setQ)(e.target.value)} />
            </label>
            <a className="csv" href={`/api/alarms/${line}/${machine}?${qs}&format=csv`}>Unduh CSV</a>
          </div>
        </section>

        {data && data.top.length > 0 && (
          <section className="card">
            <div className="card-head"><div><h2>Alarm Paling Sering</h2><p>Pada rentang dan tingkat yang dipilih</p></div></div>
            <ul className="toplist">
              {data.top.map((t) => (
                <li key={t.tag} title={t.description ?? ''}>
                  <b>{line3SensorDisplayName(t.tag)}</b><span className="tdesc">{t.description}</span>
                  <i style={{ width: `${(t.n / maxTop) * 100}%` }} /><em>{t.n}x</em>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          {err && <p className="errtext">Gagal memuat riwayat: {err}</p>}
          <div className="tablewrap">
            <table className="alt">
              <thead><tr><th>Mulai</th><th>Tag</th><th>Keterangan</th><th>Tingkat</th><th>Status</th><th>Selesai</th><th>Durasi</th></tr></thead>
              <tbody>
                {data?.rows.map((r) => {
                  const active = r.clearedAt === null;
                  const end = r.clearedAt ? new Date(r.clearedAt).getTime() : now;
                  const dur = end === null ? null : (end - new Date(r.triggeredAt).getTime()) / 1000;
                  return (
                    <tr key={r.id} className={active ? 'active' : ''}>
                      <td>{fmtTime(r.triggeredAt)}</td>
                      <td><b>{line3SensorDisplayName(r.tag)}</b></td>
                      <td className="desc">{r.description}</td>
                      <td><span className={`badge ${r.severity === 'critical' ? 'bad' : 'warn'}`}>{r.severity === 'critical' ? 'E-Stop' : 'Gangguan'}</span></td>
                      <td><span className={`badge ${active ? 'bad' : 'ok'}`}>{active ? 'Aktif' : 'Selesai'}</span></td>
                      <td>{r.clearedAt ? fmtTime(r.clearedAt) : '–'}</td>
                      <td>{dur === null ? '–' : fmtDur(dur)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && data.rows.length === 0 && <p className="emptytext">{loading ? 'Memuat…' : 'Tidak ada alarm pada filter ini.'}</p>}

          {data && data.total > 0 && (
            <div className="pager">
              <span>Menampilkan {(page - 1) * PAGE_SIZE + 1} sampai {Math.min(page * PAGE_SIZE, data.total)} dari {data.total}</span>
              <div className="seg">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Sebelumnya</button>
                <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Berikutnya</button>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
