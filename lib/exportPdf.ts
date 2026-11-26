import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type PdfExportOptions = {
  unitDisplayName: string;
  lineLabel: string;
  paramLabel: string;
  paramTag: string;
  unit: string;
  setpointText: string;
  presetLabel: string;
  rangeFromText?: string;
  rangeToText?: string;
  rows: { ts: string; value: number }[];
  boundMin: number | null;
  boundMax: number | null;
  exportTime?: Date;
};

function formatDateTimeIndo(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const date = pad(d.getDate());
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${month} ${year}, ${time} WIB`;
}

function formatRowTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function generateHistoryPdfBlob(options: PdfExportOptions): { blob: Blob; filename: string } {
  const {
    unitDisplayName,
    lineLabel,
    paramLabel,
    paramTag,
    unit,
    setpointText,
    presetLabel,
    rows,
    boundMin,
    boundMax,
    exportTime = new Date(),
  } = options;

  // Orientasi Portrait A4 (210 x 297 mm)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;

  // 1. Header Instansi / Sistem
  doc.setFillColor(15, 23, 42); // Navy/Slate-900
  doc.rect(0, 0, pageWidth, 5, 'F'); // Top accent bar

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('SATORIA MIXING MONITOR', marginX, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('SISTEM MONITORING OPERASIONAL MESIN MIXING • AUDIT & QA LOGGING', marginX, 21);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text('LAPORAN RIWAYAT DATA OPERASIONAL', marginX, 30);

  // Garis pemisah header
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(marginX, 34, pageWidth - marginX, 34);

  // 2. Metadata Information Card
  const boxY = 37;
  const boxHeight = 31;
  doc.setFillColor(248, 250, 252); // Soft gray background
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginX, boxY, pageWidth - marginX * 2, boxHeight, 2, 2, 'FD');

  const col1X = marginX + 4;
  const col1ValX = col1X + 28;
  const col2X = marginX + (pageWidth - marginX * 2) / 2 + 2;
  const col2ValX = col2X + 28;

  doc.setFontSize(8.5);

  // Baris 1: Mesin & Periode
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Mesin / Unit', col1X, boxY + 7);
  doc.text(':', col1ValX - 3, boxY + 7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${unitDisplayName} (${lineLabel})`, col1ValX, boxY + 7);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Periode', col2X, boxY + 7);
  doc.text(':', col2ValX - 3, boxY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(presetLabel, col2ValX, boxY + 7);

  // Baris 2: Parameter & Diekspor
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Parameter', col1X, boxY + 14);
  doc.text(':', col1ValX - 3, boxY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(`${paramLabel} (${paramTag})`, col1ValX, boxY + 14);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Diekspor', col2X, boxY + 14);
  doc.text(':', col2ValX - 3, boxY + 14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(formatDateTimeIndo(exportTime), col2ValX, boxY + 14);

  // Baris 3: Target SP & Total Data
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Target SP', col1X, boxY + 21);
  doc.text(':', col1ValX - 3, boxY + 21);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(setpointText, col1ValX, boxY + 21);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text('Total Data', col2X, boxY + 21);
  doc.text(':', col2ValX - 3, boxY + 21);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(`${rows.length} catatan telemetri`, col2ValX, boxY + 21);

  // 3. Tabel Data Riwayat
  const tableHeaders = ['NO', 'WAKTU', 'MESIN', 'PARAMETER', 'NILAI', 'SATUAN', 'STATUS'];

  const tableBody = rows.length === 0
    ? [
        [
          {
            content: 'Tidak ada data telemetri tercatat untuk filter ini pada rentang waktu yang dipilih.',
            colSpan: 7,
            styles: { halign: 'center', fontStyle: 'italic', textColor: [100, 116, 139] },
          },
        ],
      ]
    : rows.map((r, i) => {
        const valNum = r.value;
        const valFormatted = String(r.value);
        const isOutOfBound =
          (boundMin !== null && valNum < boundMin) ||
          (boundMax !== null && valNum > boundMax);
        const statusText =
          boundMin === null && boundMax === null ? 'RAW' : isOutOfBound ? 'DI LUAR BATAS' : 'NORMAL';

        return [
          String(i + 1),
          formatRowTime(r.ts),
          unitDisplayName,
          paramLabel,
          valFormatted,
          unit,
          statusText,
        ];
      });

  autoTable(doc, {
    startY: boxY + boxHeight + 6,
    margin: { left: marginX, right: marginX, bottom: 18 },
    head: [tableHeaders],
    body: tableBody as never,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 2.2,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 23, 42], // Slate-900
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 38, halign: 'center' },
      2: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 44, halign: 'left' },
      4: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 26, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6 && rows.length > 0) {
        const rawText = String(data.cell.raw);
        if (rawText === 'NORMAL') {
          data.cell.styles.fillColor = [220, 252, 231]; // Soft Green
          data.cell.styles.textColor = [22, 101, 52]; // Dark Green
          data.cell.styles.fontStyle = 'bold';
        } else if (rawText === 'DI LUAR BATAS') {
          data.cell.styles.fillColor = [254, 226, 226]; // Soft Red
          data.cell.styles.textColor = [153, 27, 27]; // Dark Red
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // Footer pada setiap halaman dengan total halaman yang akurat
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);

    // Footer kiri: Nama sistem & status kerahasiaan
    doc.text(
      'Satoria Mixing Monitor — Dokumen operasional resmi untuk keperluan audit & integritas batch.',
      marginX,
      pageHeight - 8,
    );

    // Footer kanan: Nomor halaman
    const pageInfo = `Halaman ${i} dari ${totalPages}`;
    doc.text(pageInfo, pageWidth - marginX - doc.getTextWidth(pageInfo), pageHeight - 8);

    // Garis batas footer
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(marginX, pageHeight - 12, pageWidth - marginX, pageHeight - 12);
  }

  const cleanUnit = unitDisplayName.replace(/\s+/g, '_');
  const cleanTag = paramTag.replace(/\s+/g, '_');
  const dateStr = exportTime.toISOString().slice(0, 10);
  const filename = `Riwayat_Data_${cleanUnit}_${cleanTag}_${dateStr}.pdf`;

  const blob = doc.output('blob');
  return { blob, filename };
}

export async function exportHistoryPdf(options: PdfExportOptions): Promise<void> {
  const { blob, filename } = generateHistoryPdfBlob(options);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
