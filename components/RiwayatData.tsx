'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import {
  formatEngineeringParameterValue,
  formatRawParameterValue,
  normalizeType,
  TYPE_DIGITS,
  TYPE_UNIT,
} from '@/lib/classify';
import { line3SensorDisplayName } from '@/lib/mimic/line3TankTags';

export type ParamMeta = {
  tag: string;
  name: string;
  description: string | null;
  unit: string | null;
  parameter_type: string | null;
  data_type: string | null;
  min_value: number | null;
  max_value: number | null;
};

export type LogRow = { ts: string; value: number };
export type MachineInfo = { code: string; line_code: string; name: string };

export type UnitKey = 'tk1001' | 'tk1002' | 'filterLine' | 'filling';

const FILTER_TAGS = new Set(['TT1009', 'TT1010', 'TT1013', 'CT1003']);
const BUFFER_TAGS = new Set(['TT1012', 'PT1003', 'CT1004']);
const LINE3_TANK_TAG = /^DB2_[A-Z]+([12])_/i;

function isLine3TankParameter(tag: string, tank: UnitKey): boolean {
  const match = LINE3_TANK_TAG.exec(tag);
  if (!match) return false;
  return (tank === 'tk1002' ? '2' : '1') === match[1];
}

const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function getUnitForTag(tag: string, line: string): UnitKey {
  if (line.toLowerCase() === 'line3') return isLine3TankParameter(tag, 'tk1002') ? 'tk1002' : 'tk1001';
  const g = tag.toUpperCase();
  if (FILTER_TAGS.has(g) || g.includes('FILTER') || g === 'CT1003' || g === 'TT1009' || g === 'TT1010' || g === 'TT1013') {
    return 'filterLine';
  }
  if (BUFFER_TAGS.has(g) || g.includes('BUFFER') || g === 'PT1003' || g === 'CT1004' || g === 'TT1012') {
    return 'filling';
  }
  const tt = /^TT10(\d\d)$/.exec(g);
  if (tt) {
    const n = Number(tt[1]);
    if (n <= 4 || n === 11) return 'tk1001';
    if (n >= 5 && n <= 8) return 'tk1002';
  }
  if (g.includes('1002')) return 'tk1002';
  return 'tk1001';
}

function fmtClock(iso: string | Date | number): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDate(iso: string | Date | number): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function getStatus(value: number, min: number | null, max: number | null): 'normal' | 'danger' | 'unset' {
  if (min === null && max === null) return 'unset';
  if (min !== null && value < min) return 'danger';
  if (max !== null && value > max) return 'danger';
  return 'normal';
}

function getParamCleanLabel(p: ParamMeta): string {
  const tag = p.tag.toUpperCase();
  if (tag === 'TT1001') return 'Suhu Campuran';
  if (tag === 'TT1002') return 'Suhu Tangki Bawah';
  if (tag === 'TT1003') return 'Suhu Tangki Tengah';
  if (tag === 'TT1004') return 'Suhu Tangki Atas';
  if (tag === 'TT1005') return 'Suhu Campuran';
  if (tag === 'TT1006') return 'Suhu Tangki Bawah';
  if (tag === 'TT1007') return 'Suhu Tangki Tengah';
  if (tag === 'TT1008') return 'Suhu Tangki Atas';
  if (tag === 'TT1009') return 'Suhu Filter In';
  if (tag === 'TT1010') return 'Suhu Filter Out';
  if (tag === 'TT1011') return 'Suhu Sterilisasi SIP';
  if (tag === 'TT1012') return 'Suhu Buffer Tank';
  if (tag === 'TT1013') return 'Suhu Jalur Produk';
  if (tag === 'PT1001') return 'Tekanan Tangki 1';
  if (tag === 'PT1002') return 'Tekanan Tangki 2';
  if (tag === 'PT1003') return 'Tekanan Buffer Tank';
  if (tag === 'WM1001') return 'Berat Campuran 1';
  if (tag === 'WM1002') return 'Berat Campuran 2';
  if (tag === 'CT1001') return 'Konduktivitas Tangki 1';
  if (tag === 'CT1002') return 'Konduktivitas Tangki 2';
  if (tag === 'CT1003') return 'Konduktivitas Filter Line';
  if (tag === 'CT1004') return 'Konduktivitas Buffer Tank';
  if (tag === 'P1001' || tag === 'P1001-FREQ') return 'Frekuensi Pompa 1';
  if (tag === 'P1002-FREQ') return 'Frekuensi Pompa 2';
  if (tag === 'LMS1001-FREQ') return 'Frekuensi Agitator 1';
  if (tag === 'LMS1002-FREQ') return 'Frekuensi Agitator 2';
  if (p.name && p.name.toLowerCase() === 'temperature') return 'Suhu Campuran';
  if (p.name && p.name.toLowerCase() === 'weight') return 'Berat Campuran';
  if (p.name && p.name.toLowerCase() === 'pressure') return 'Tekanan Tangki';
  if (p.name && p.name.toLowerCase() === 'pump speed') return 'Kecepatan Pompa';
  return p.description?.replace(/Mixing Tank/i, '').trim() || p.name || p.tag;
}

const TIME_PRESETS = [
  { key: 'today', label: 'Hari Ini (00:00 - Sekarang)' },
  { key: '1h',    label: '1 Jam Terakhir' },
  { key: '6h',    label: '6 Jam Terakhir' },
  { key: '12h',   label: '12 Jam Terakhir' },
  { key: '24h',   label: '24 Jam Terakhir' },
  { key: 'custom', label: 'Kustom...' },
] as const;

type Preset = typeof TIME_PRESETS[number]['key'];

export type RiwayatDataProps = {
  line: string;
  machine: string;
  machines: MachineInfo[];
  initialUnit?: string;
};

export default function RiwayatData({
  line,
  machine,
  initialUnit,
  // machines prop accepted but navigation is handled via router
}: RiwayatDataProps) {
  const router = useRouter();
  const isLine3 = line.toLowerCase() === 'line3';
  const isLine4 = line.toLowerCase() === 'line4';
  const lineLabel = line.replace(/^line(\d+)/i, 'LINE $1').toUpperCase();

  // Active unit inside line
  const [selectedUnit, setSelectedUnit] = useState<UnitKey>(() => {
    if (initialUnit && ['tk1001', 'tk1002', 'filterLine', 'filling'].includes(initialUnit)) {
      if (isLine3 && ['tk1001', 'tk1002'].includes(initialUnit)) return initialUnit as UnitKey;
      if (!isLine4) return 'tk1001';
      return initialUnit as UnitKey;
    }
    return 'tk1001';
  });

  const [params, setParams] = useState<ParamMeta[]>([]);
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [preset, setPreset] = useState<Preset>('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const mounted = useMounted();
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch parameters list for the machine
  useEffect(() => {
    let active = true;
    fetch(`/api/parameters/${encodeURIComponent(line)}/${encodeURIComponent(machine)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Gagal memuat daftar parameter');
        return res.json();
      })
      .then((data: ParamMeta[]) => {
        if (!active) return;
        setParams(data);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [line, machine]);

  // Parameters filtered by selected unit
  const unitParams = useMemo(() => {
    if (isLine3) return params.filter((p) => isLine3TankParameter(p.tag, selectedUnit));
    if (!isLine4) return params;
    return params.filter((p) => getUnitForTag(p.tag, line) === selectedUnit);
  }, [params, selectedUnit, isLine3, isLine4, line]);

  // Derived active tag (avoids setState cascading in effect)
  const activeTag = useMemo(() => {
    if (unitParams.length > 0) {
      if (selectedTag && unitParams.some((p) => p.tag === selectedTag)) {
        return selectedTag;
      }
      const defaultP = unitParams.find((p) => p.tag.startsWith('TT')) || unitParams[0];
      return defaultP?.tag || '';
    }
    if (params.length > 0 && !isLine4) {
      if (selectedTag && params.some((p) => p.tag === selectedTag)) {
        return selectedTag;
      }
      return params[0]?.tag || '';
    }
    return selectedTag;
  }, [unitParams, selectedTag, params, isLine4]);

  // Display label for current machine / unit
  const unitDisplayName = useMemo(() => {
    if (isLine3) return selectedUnit === 'tk1002' ? 'TK1002' : 'TK1001';
    if (!isLine4) return 'TK1001';
    if (selectedUnit === 'tk1001') return 'TK1001';
    if (selectedUnit === 'tk1002') return 'TK1002';
    if (selectedUnit === 'filterLine') return 'Filter Line';
    if (selectedUnit === 'filling') return 'Filling Room';
    return 'TK1001';
  }, [isLine3, isLine4, selectedUnit]);

  // Compute date range based on selected preset
  const range = useMemo(() => {
    const now = new Date();
    if (preset === 'today') {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);
      return { from, to: now };
    }
    if (preset === '1h') return { from: new Date(now.getTime() - 3600000), to: now };
    if (preset === '6h') return { from: new Date(now.getTime() - 6 * 3600000), to: now };
    if (preset === '12h') return { from: new Date(now.getTime() - 12 * 3600000), to: now };
    if (preset === '24h') return { from: new Date(now.getTime() - 24 * 3600000), to: now };
    const from = customFrom ? new Date(customFrom) : new Date(now.getTime() - 3600000);
    const to = customTo ? new Date(customTo) : now;
    return { from, to };
  }, [preset, customFrom, customTo]);

  // Fetch table data
  const fetchData = useCallback(
    async (tagToFetch = activeTag) => {
      if (!tagToFetch) return;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        q.set('tag', tagToFetch);
        q.set('from', range.from.toISOString());
        q.set('to', range.to.toISOString());
        q.set('limit', '500');

        const res = await fetch(
          `/api/historylog/${encodeURIComponent(line)}/${encodeURIComponent(machine)}?${q.toString()}`,
        );
        if (!res.ok) throw new Error('Gagal memuat log data operasional');
        const data = await res.json();
        setRows(data.rows || []);
        setLastSync(new Date());
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [activeTag, range, line, machine],
  );

  // Trigger initial fetch when activeTag or range changes
  useEffect(() => {
    if (!activeTag) return;
    const timer = setTimeout(() => { void fetchData(activeTag); }, 0);
    return () => clearTimeout(timer);
  }, [activeTag, range, fetchData]);

  // Setup 10-second sync when not using custom range
  useEffect(() => {
    if (preset === 'custom' || !activeTag) return;
    syncTimerRef.current = setInterval(() => {
      fetchData(activeTag);
    }, 10000);
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [activeTag, preset, fetchData]);

  // Active parameter metadata
  const currentParam = useMemo(
    () => params.find((p) => p.tag === activeTag) || null,
    [params, activeTag],
  );

  const parameterType = currentParam
    ? normalizeType(currentParam.parameter_type, currentParam.unit, currentParam.tag)
    : 'other';
  const unit = TYPE_UNIT[parameterType];
  const paramLabel = currentParam ? getParamCleanLabel(currentParam) : 'Suhu Campuran';
  const paramDisplayTag = currentParam ? line3SensorDisplayName(currentParam.tag) : '';
  const paramDisplayLabel = currentParam && isLine3 && !paramLabel.includes(paramDisplayTag)
    ? `${paramLabel} · ${paramDisplayTag}`
    : paramLabel;

  // Target setpoint bounds
  const hasDbBounds = currentParam?.min_value != null && currentParam?.max_value != null;
  const boundMin = hasDbBounds ? currentParam!.min_value! : null;
  const boundMax = hasDbBounds ? currentParam!.max_value! : null;

  // Text for Target Setpoint header display
  const setpointText = useMemo(() => {
    if (hasDbBounds) {
      return `${formatEngineeringParameterValue(boundMin!, parameterType, line)} ${unit} – ${formatEngineeringParameterValue(boundMax!, parameterType, line)} ${unit}`;
    }
    return 'Rentang target belum diatur';
  }, [hasDbBounds, boundMin, boundMax, parameterType, unit, line]);

  // Handle unit change from selector
  const handleUnitSelect = (val: string) => {
    // format: line/machine/unit
    const parts = val.split('/');
    if (parts.length === 3) {
      const [targetLine, targetMachine, targetUnit] = parts;
      if (targetLine === line && targetMachine === machine) {
        setSelectedUnit(targetUnit as UnitKey);
      } else {
        router.push(`/dashboard/${targetLine}/${targetMachine}/riwayat?unit=${targetUnit}`);
      }
    } else if (parts.length === 2) {
      router.push(`/dashboard/${val}/riwayat`);
    }
  };

  // Handle CSV Download
  const handleDownloadCsv = () => {
    if (!rows.length) return;
    const headers = ['WAKTU', 'MESIN', 'PARAMETER', 'NILAI', 'SATUAN', 'STATUS'];
    const csvContent = [
      headers.join(','),
      ...rows.map((r) => {
        const val = isLine3
          ? formatRawParameterValue(r.value, parameterType)
          : isLine4 && parameterType === 'pressure'
            ? r.value.toFixed(TYPE_DIGITS[parameterType])
            : Math.max(0, r.value).toFixed(TYPE_DIGITS[parameterType]);
        const st = getStatus(r.value, boundMin, boundMax);
        const stText = st === 'normal' ? 'NORMAL' : st === 'danger' ? 'DI LUAR BATAS' : 'BATAS BELUM DIATUR';
        return `"${fmtClock(r.ts)} ${fmtDate(r.ts)}","${unitDisplayName}","${paramLabel}",${val},"${unit}","${stText}"`;
      }),
    ].join('\r\n');

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Riwayat_${unitDisplayName.replace(/\s+/g, '_')}_${activeTag}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Handle Excel (.xls) Download
  const handleDownloadExcel = () => {
    if (!rows.length) return;
    const paramLabelEsc = paramLabel.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const unitEsc = unit.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const unitDispEsc = unitDisplayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Riwayat Data">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">WAKTU</Data></Cell>
    <Cell><Data ss:Type="String">MESIN</Data></Cell>
    <Cell><Data ss:Type="String">PARAMETER</Data></Cell>
    <Cell><Data ss:Type="String">NILAI</Data></Cell>
    <Cell><Data ss:Type="String">SATUAN</Data></Cell>
    <Cell><Data ss:Type="String">STATUS</Data></Cell>
   </Row>`;

    for (const r of rows) {
      const val = isLine3
        ? formatRawParameterValue(r.value, parameterType)
        : isLine4 && parameterType === 'pressure'
          ? r.value.toFixed(TYPE_DIGITS[parameterType])
          : Math.max(0, r.value).toFixed(TYPE_DIGITS[parameterType]);
      const st = getStatus(r.value, boundMin, boundMax);
      const stText = st === 'normal' ? 'NORMAL' : st === 'danger' ? 'DI LUAR BATAS' : 'BATAS BELUM DIATUR';
      xml += `
   <Row>
    <Cell><Data ss:Type="String">${fmtClock(r.ts)} ${fmtDate(r.ts)}</Data></Cell>
    <Cell><Data ss:Type="String">${unitDispEsc}</Data></Cell>
    <Cell><Data ss:Type="String">${paramLabelEsc}</Data></Cell>
    <Cell><Data ss:Type="Number">${val}</Data></Cell>
    <Cell><Data ss:Type="String">${unitEsc}</Data></Cell>
    <Cell><Data ss:Type="String">${stText}</Data></Cell>
   </Row>`;
    }

    xml += `
  </Table>
 </Worksheet>
</Workbook>`;

    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Riwayat_${unitDisplayName.replace(/\s+/g, '_')}_${activeTag}_${new Date().toISOString().slice(0, 10)}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Handle PDF Download
  const handleDownloadPdf = async () => {
    if (exportingPdf) return;
    setExportingPdf(true);
    setPdfError(null);
    try {
      const { exportHistoryPdf } = await import('@/lib/exportPdf');
      const presetItem = TIME_PRESETS.find((p) => p.key === preset);
      const presetLabel =
        preset === 'custom'
          ? `Kustom (${customFrom || '–'} s/d ${customTo || '–'})`
          : (presetItem?.label ?? 'Hari Ini (00:00 - Sekarang)');

      await exportHistoryPdf({
        unitDisplayName,
        lineLabel,
        paramLabel,
        paramTag: activeTag,
        unit,
        setpointText,
        presetLabel,
        rows,
        boundMin,
        boundMax,
      });
    } catch (err) {
      console.error('Export PDF error:', err);
      setPdfError('Export PDF gagal. Silakan coba lagi.');
      setTimeout(() => setPdfError(null), 5000);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="rw-root">
      {/* Top Header Bar */}
      <header className="rw-top-head">
        <div className="rw-top-left">
          <span className="rw-mixing-title">MIXING {lineLabel}</span>
          <div className="rw-mesin-box">
            <span className="rw-mesin-label">MESIN:</span>
            <div className="rw-select-wrap">
              <select
                className="rw-mesin-select"
                value={`${line}/${machine}/${selectedUnit}`}
                onChange={(e) => handleUnitSelect(e.target.value)}
              >
                {isLine4 ? (
                  <>
                    <option value="line4/mixingL4/tk1001">TK1001</option>
                    <option value="line4/mixingL4/tk1002">TK1002</option>
                    <option value="line4/mixingL4/filterLine">Filter Line</option>
                    <option value="line4/mixingL4/filling">Filling Room</option>
                  </>
                ) : (
                  <>
                    <option value="line3/mixingL3/tk1001">TK1001</option>
                    <option value="line3/mixingL3/tk1002">TK1002</option>
                    <option value="line4/mixingL4/tk1001">Line 4 - TK1001</option>
                    <option value="line4/mixingL4/tk1002">Line 4 - TK1002</option>
                    <option value="line4/mixingL4/filterLine">Line 4 - Filter Line</option>
                    <option value="line4/mixingL4/filling">Line 4 - Filling Room</option>
                  </>
                )}
              </select>
              <svg className="rw-select-caret" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        </div>

        <div className="rw-top-right">
          <div className="rw-pill-update">
            <span className="rw-dot-green" />
            <span>Pembaruan: <strong>{mounted && lastSync ? fmtClock(lastSync) : '–'}</strong></span>
          </div>

          <div className="rw-pill-connected">
            <span className="rw-dot-white" />
            <span>TERHUBUNG</span>
          </div>

          <button className="rw-icon-btn" aria-label="Notifikasi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>

          <button className="rw-user-btn" aria-label="Profil User">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" d="M12 2a5 5 0 100 10 5 5 0 000-10zm-7 18a7 7 0 0114 0H5z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="rw-content">
        {/* Title & Action Buttons Row */}
        <div className="rw-title-section">
          <div className="rw-title-left">
            {/* <div className="rw-badges-row">
              <span className="rw-badge-audit">AUDIT & QA LOGGING</span>
              <span className="rw-badge-sync">• REALTIME TELEMETRY SYNC</span>
            </div> */}
            <div className="sc-pagehead">
              <h1>Riwayat Data</h1>
            </div>
            <p className="rw-page-sub">
              Pencatatan log parameter operasional berkala dan verifikasi integritas batch
            </p>
          </div>

          <div className="rw-title-actions">
            <button
              className="rw-btn-pdf"
              onClick={handleDownloadPdf}
              disabled={exportingPdf}
              title="Download laporan riwayat data dalam format PDF profesional"
            >
              {exportingPdf ? (
                <>
                  <svg className="rw-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>Menyiapkan PDF...</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <path d="M9 13v-2a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9" />
                    <path d="M15 15h-2v-5h2" />
                  </svg>
                  <span>Download PDF</span>
                </>
              )}
            </button>

            <button className="rw-btn-excel" onClick={handleDownloadExcel}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Download Excel (.xlsx)</span>
            </button>

            <button className="rw-btn-csv" onClick={handleDownloadCsv}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span>Download CSV</span>
            </button>
          </div>
        </div>

        {pdfError && (
          <div className="rw-alert-error" role="alert">
            <span>{pdfError}</span>
            <button type="button" onClick={() => setPdfError(null)} aria-label="Tutup pesan error">✕</button>
          </div>
        )}

        {/* Filter Card */}
        <section className="rw-card rw-filter-card">
          <div className="rw-filter-head">
            <span className="rw-filter-head-label">FILTER PARAMETER TELEMETRI</span>
            <span className="rw-filter-sync-status">
              <span className="rw-dot-green-small" />
              SINKRONISASI AKTIF (10s)
            </span>
          </div>

          <div className="rw-filter-grid">
            {/* Field: Mesin / Unit Reaktor */}
            <div className="rw-filter-field">
              <label className="rw-filter-label">MESIN REAKTOR</label>
              <div className="rw-input-wrap">
                <select
                  className="rw-input-select"
                  value={isLine3 ? `line3/mixingL3/${selectedUnit}` : `line4/mixingL4/${selectedUnit}`}
                  onChange={(e) => handleUnitSelect(e.target.value)}
                >
                  <optgroup label="Mixing Line 4">
                    <option value="line4/mixingL4/tk1001">TK1001 - Tanki Mixing 1</option>
                    <option value="line4/mixingL4/tk1002">TK1002 - Tanki Mixing 2</option>
                    <option value="line4/mixingL4/filterLine">Filter Line - Jalur Filter</option>
                    <option value="line4/mixingL4/filling">Filling Room - Ruang Pengisian</option>
                  </optgroup>
                  <optgroup label="Mixing Line 3">
                    <option value="line3/mixingL3/tk1001">TK1001 - Reaktor Utama</option>
                    <option value="line3/mixingL3/tk1002">TK1002 - Reaktor Kedua</option>
                  </optgroup>
                </select>
                <svg className="rw-select-caret" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            {/* Field: Parameter Uji */}
            <div className="rw-filter-field">
              <label className="rw-filter-label">PARAMETER UJI</label>
              <div className="rw-input-wrap">
                <select
                  className="rw-input-select"
                  value={activeTag}
                  onChange={(e) => setSelectedTag(e.target.value)}
                >
                  {unitParams.map((p) => {
                    const pUnit = TYPE_UNIT[normalizeType(p.parameter_type, p.unit, p.tag)];
                    const pLabel = getParamCleanLabel(p);
                    const displayTag = line3SensorDisplayName(p.tag);
                    const tagSuffix = isLine3 && !pLabel.includes(displayTag) ? ` · ${displayTag}` : '';
                    return (
                      <option key={p.tag} value={p.tag}>
                        {pLabel}{tagSuffix} {pUnit ? `(${pUnit})` : ''}
                      </option>
                    );
                  })}
                </select>
                <svg className="rw-select-caret" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            {/* Field: Rentang Waktu */}
            <div className="rw-filter-field">
              <label className="rw-filter-label">RENTANG WAKTU</label>
              <div className="rw-input-wrap">
                <select
                  className="rw-input-select"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as Preset)}
                >
                  {TIME_PRESETS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <svg className="rw-select-caret" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            {/* Submit Button */}
            <div className="rw-filter-action">
              <button
                className="rw-btn-submit"
                onClick={() => fetchData(activeTag)}
                disabled={loading}
              >
                <svg className={loading ? 'rw-spin' : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>{loading ? 'Memuat...' : 'Tampilkan Data'}</span>
              </button>
            </div>
          </div>

          {/* Custom Date Pickers */}
          {preset === 'custom' && (
            <div className="rw-custom-range-row">
              <div className="rw-custom-field">
                <label>Dari Tanggal & Jam:</label>
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rw-date-input"
                />
              </div>
              <div className="rw-custom-field">
                <label>Sampai Tanggal & Jam:</label>
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rw-date-input"
                />
              </div>
            </div>
          )}
        </section>

        {/* Table Card */}
        <section className="rw-card rw-table-card">
          <div className="rw-table-card-head">
            <div className="rw-table-title-box">
              <svg className="rw-table-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
              </svg>
              <h2 className="rw-table-h2">Tabel Log Parameter Operasional</h2>
            </div>

            <div className="rw-table-setpoint">
              Target Setpoint (SP): <strong>{setpointText}</strong>
            </div>
          </div>

          {error ? (
            <div className="rw-table-error">
              <p>Terjadi kesalahan: {error}</p>
              <button onClick={() => fetchData()} className="rw-btn-retry">Coba Lagi</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rw-table-empty">
              {loading ? (
                <p>Sedang memuat data telemetri...</p>
              ) : (
                <p>Tidak ada data telemetri tercatat untuk parameter ini pada rentang waktu yang dipilih.</p>
              )}
            </div>
          ) : (
            <div className="rw-table-responsive">
              <table className="rw-data-table">
                <thead>
                  <tr>
                    <th>WAKTU</th>
                    <th>MESIN</th>
                    <th>PARAMETER</th>
                    <th>NILAI</th>
                    <th>SATUAN</th>
                    <th style={{ textAlign: 'center' }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const val = row.value;
                    const st = getStatus(val, boundMin, boundMax);
                    const stLabel = st === 'normal' ? 'NORMAL' : st === 'danger' ? 'DI LUAR BATAS' : 'BATAS BELUM DIATUR';
                    return (
                      <tr key={`${row.ts}-${idx}`} data-status={st}>
                        <td className="rw-col-time">
                          <span className="rw-time-text">{fmtClock(row.ts)}</span>
                          <span className="rw-date-text">{fmtDate(row.ts)}</span>
                        </td>
                        <td className="rw-col-machine">
                          <strong>{unitDisplayName}</strong>
                        </td>
                        <td className="rw-col-param">
                          {paramDisplayLabel}
                        </td>
                        <td className="rw-col-val">
                          <span className="rw-val-text">{formatEngineeringParameterValue(val, parameterType, line)}</span>
                        </td>
                        <td className="rw-col-unit">
                          {unit}
                        </td>
                        <td className="rw-col-status">
                          <span className={`rw-status-pill ${st}`}>
                            <span className="rw-status-dot" />
                            {stLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
