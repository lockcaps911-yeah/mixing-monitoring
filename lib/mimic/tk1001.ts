import type { MimicConfig, MimicValve } from '@/lib/mimic/types';

// Disalin dari layar HMI "TK1001" (layar 1). Koordinat = koordinat foto HMI (viewBox mulai 70,140).
// ATURAN: setiap valve harus berada TEPAT di atas garis pipanya. Karena itu koordinat kolom/baris
// dipakai bersama oleh pipa dan valve lewat konstanta di bawah (ubah satu, keduanya ikut).
const PINK = '#c240c2';
const ORANGE = '#e07b39';
const CYAN = '#35c6cc';
const RED = '#d32f2f';
const BLUE = '#2f55d4';
const WHITE = '#f6f6f6';
const BLACK = '#222';

// ---- kolom (x) ----
const X_CW_IN = 122;     // PAV1001
const X_CW_RET = 192;    // PAV1002 / PAV1006
const X_STEAM = 262;     // PAV1003
const X_AIR = 332;       // PAV1004
const X_AIR_W = 368;     // garis putih tipis (udara) sisi kiri
const X_RED_L = 418;     // garis merah panjang (PCV1001 -> emission)
const X_PCV1002 = 493;   // garis putih tipis PCV1002 -> PCV1004 -> PT1001
const X_WFI = 602;       // WFI turun ke tanki
const X_TANK_OUT = 609;  // keluaran bawah tanki
const X_PDV1004 = 723;
const X_AIR_R = 730;     // garis putih tipis naik di kiri TT1003/CT1001
const X_SUCTION = 707;   // pipa pink naik ke sisi hisap pompa
const X_PUMP = 815;      // pusat casing pompa P1001
const X_PCV1006 = 872;
const X_PCV1005 = 947;
const X_PDV1011 = 967;   // ujung header pink (BUKAN ke Filter)
const X_PDV1010 = 1036;
const X_FILTER = 1117;   // cabang ke Filter + garis tipis turun ke emission
const X_END_RED = 1189;

// ---- baris (y) ----
const Y_PURE = 191;      // header pink pure steam
const Y_WFI = 190;       // garis orange WFI
const Y_PDV1043 = 217;
const Y_AIR_TOP = 200;
const Y_PCV1003 = 292;   // garis biru tipis
const Y_AIR_MID = 298;   // garis putih tipis (PDV1033)
const Y_HEADER = 297;    // header pink PDV1005 / PDV1006 (mulai dari garis WFI)
const Y_PCV1004 = 356;
const Y_AIR_LOW = 366;   // garis putih tipis ke PT1001
const Y_PUMP = 533;      // garis pompa & P1002
const Y_BRANCH = 635;    // cabang pink tanki -> pompa (antara PDV1007 dan PDV1008)
const Y_DRAIN = 580;     // header drain merah pompa
const Y_AIR_TTOP = 596;  // garis putih tipis di atas kotak TT1003
const Y_PCV_LINK = 602;  // garis merah PCV1005 -> PCV1006
const Y_RED_R = 659;     // cabang merah kanan (di atas PCV1007)
const Y_AIR_BOT = 696;   // garis putih tipis dari PDV1008
const Y_EMIT_W = 715;
const Y_EMIT_R = 739;

const h = (tag: string, x: number, y: number, lx: number, ly: number): MimicValve =>
  ({ tag, x, y, label: { x: lx, y: ly, anchor: 'middle' } });
const v = (tag: string, x: number, y: number, lx: number, ly: number): MimicValve =>
  ({ tag, x, y, vertical: true, label: { x: lx, y: ly, rotate: true, anchor: 'middle' } });
const side = (tag: string, x: number, y: number): MimicValve =>
  ({ tag, x, y, vertical: true, label: { x: x + 20, y: y + 4, anchor: 'start' } });

export const tk1001: MimicConfig = {
  title: 'TK1001',
  x0: 70, y0: 140, width: 1190, height: 640,

  pipes: [
    // ---- utilitas kiri ----
    { d: `M ${X_CW_IN} 316 V 625 H ${X_CW_RET}`, color: CYAN },
    { d: `M ${X_CW_RET} 322 V 553`, color: CYAN },
    { d: `M ${X_CW_IN} 525 H 537`, color: CYAN, width: 2 },          // jacket masuk
    { d: `M ${X_CW_RET} 396 H 537`, color: CYAN, width: 2 },         // jacket kembali
    { d: `M ${X_CW_RET} 553 V ${Y_EMIT_R}`, color: RED },
    { d: `M ${X_STEAM} 314 V 390`, color: RED },                      // industrial steam (masuk)
    { d: `M ${X_AIR} 314 V 390`, color: BLUE },                       // low-oil air (masuk)

    // ---- pure steam & WFI ----
    { d: `M ${X_RED_L} ${Y_PURE} H 594`, color: PINK },
    { d: `M ${X_RED_L} ${Y_PURE} V ${Y_EMIT_R}`, color: RED },
    { d: `M 697 ${Y_WFI} H ${X_WFI} V 372`, color: ORANGE },
    { d: `M ${X_WFI} ${Y_PDV1043} H 931`, color: PINK },

    // ---- garis tipis udara (putih / biru) ----
    { d: `M 364 276 V ${Y_PCV1003} H ${X_PCV1002}`, color: BLUE, width: 1.5 },
    { d: `M 474 ${Y_AIR_TOP} H ${X_PCV1002} V ${Y_AIR_LOW} H 870 V 350`, color: WHITE, width: 2 },
    { d: `M ${X_AIR_W} ${Y_AIR_MID} H ${X_WFI}`, color: WHITE, width: 2 },
    { d: `M ${X_AIR_W} ${Y_AIR_MID} V ${Y_AIR_BOT} H ${X_AIR_R} V ${Y_AIR_TTOP} H ${X_PCV1006} V 712`, color: WHITE, width: 2 },
    { d: `M ${X_RED_L} ${Y_PCV1004} H ${X_PCV1002}`, color: PINK },

    // ---- header pink: mulai di garis WFI, berhenti di PDV1011 (TIDAK ke Filter) ----
    { d: `M ${X_WFI} ${Y_HEADER} H ${X_PDV1011}`, color: PINK },
    { d: `M ${X_PDV1004} ${Y_HEADER} V ${Y_AIR_LOW}`, color: PINK },
    { d: `M ${X_PDV1011} ${Y_HEADER} V ${Y_PUMP} H 1212`, color: PINK },   // PDV1011 -> PDV1012 -> PDV1014 -> P1002

    // ---- tanki -> PDV1007 -> P1001 ----
    { d: `M ${X_TANK_OUT} 540 V 650`, color: PINK },
    { d: `M ${X_TANK_OUT} ${Y_BRANCH} H ${X_SUCTION} V ${Y_PUMP} H ${X_PUMP}`, color: PINK },
    { d: `M ${X_PUMP} ${Y_PUMP} V 432 H ${X_PDV1011}`, color: PINK },
    { d: `M ${X_FILTER} ${Y_PUMP} V ${Y_HEADER} H 1187`, color: PINK },   // cabang ke Filter

    // ---- drain pompa P1001 -> PDV1010 (merah) ----
    { d: `M ${X_PUMP} ${Y_PUMP} V ${Y_DRAIN} H ${X_PDV1010} V ${Y_EMIT_R}`, color: RED },

    // ---- PDV1008 -> PCV1006 (putih), PCV1005 -> PCV1006 (merah) ----
    { d: `M ${X_TANK_OUT} 650 V ${Y_AIR_BOT}`, color: WHITE, width: 2 },
    { d: `M ${X_PCV1005} ${Y_EMIT_R} V ${Y_PCV_LINK} H ${X_PCV1006}`, color: RED },

    // ---- kanan: PDV1013 / PCV1007 ----
    { d: `M ${X_FILTER} ${Y_PUMP} V ${Y_EMIT_W} H 175`, color: WHITE, width: 2.5 },
    { d: `M ${X_FILTER} 635 H 1160`, color: BLACK, width: 1.5 },           // garis sensor TT1004
    { d: `M ${X_FILTER} ${Y_RED_R} H ${X_END_RED} V ${Y_EMIT_R} H 172`, color: RED },
  ],

  arrows: [
    // utilitas: PAV1001 & PAV1002 keluar (ke atas); PAV1003 & PAV1004 masuk (ke bawah, di bawah valve)
    { x: X_CW_IN, y: 318, rot: 270, color: CYAN },
    { x: X_CW_RET, y: 318, rot: 270, color: CYAN },
    { x: X_STEAM, y: 394, rot: 90, color: RED },
    { x: X_AIR, y: 394, rot: 90, color: BLUE },
    { x: 364, y: 291, rot: 90, color: BLUE },
    { x: 595, y: Y_PURE, rot: 0, color: PINK },
    { x: 676, y: Y_WFI, rot: 180, color: ORANGE },
    { x: 931, y: Y_PDV1043, rot: 0, color: PINK },
    { x: 1189, y: Y_HEADER, rot: 0, color: PINK },
    // ke emission
    { x: 172, y: Y_EMIT_W, rot: 180, color: WHITE },
    { x: 170, y: Y_EMIT_R, rot: 180, color: RED },
    { x: X_PCV1006, y: 713, rot: 90, color: WHITE },
    { x: X_CW_RET, y: Y_EMIT_R, rot: 90, color: RED },
    { x: X_RED_L, y: Y_EMIT_R, rot: 90, color: RED },
    { x: X_PCV1005, y: Y_EMIT_R, rot: 90, color: RED },
    { x: X_PDV1010, y: Y_EMIT_R, rot: 90, color: RED },
    { x: X_END_RED, y: Y_EMIT_R, rot: 90, color: RED },
  ],

  tanks: [{ x: 537, y: 372, w: 143, h: 168 }],
  tankLabel: { x: 612, y: 525, text: 'TK1001' },
  agitators: [{ x: 569, y: 426, h: 50, runTag: 'LMS1001RUN' }],
  pumps: [{ x: X_PUMP, y: Y_PUMP, runTag: 'P1001RUN' }],

  texts: [
    { x: 122, y: 215, text: 'Cooling water inlet', anchor: 'middle', size: 11, rotate: -90 },
    { x: 193, y: 218, text: 'Cooling water return', anchor: 'middle', size: 11, rotate: -90 },
    { x: 263, y: 205, text: 'Industrial steam', anchor: 'middle', size: 11, rotate: -90 },
    { x: 333, y: 225, text: 'Low-oil compressed air', anchor: 'middle', size: 11, rotate: -90 },
    { x: 369, y: 215, text: 'Oil-free Compressed air', anchor: 'middle', size: 11, rotate: -90 },
    { x: 430, y: 167, text: 'Pure steam', anchor: 'middle', size: 14 },
    { x: 700, y: 195, text: 'WFI', anchor: 'start' },
    { x: 1204, y: 301, text: 'Filter', anchor: 'start' },
    { x: 1217, y: 539, text: 'P1002', anchor: 'start' },
    { x: 846, y: 561, text: 'P1001', anchor: 'middle' },
    { x: 125, y: 722, text: 'Emission', anchor: 'middle' },
    { x: 125, y: 745, text: 'Emission', anchor: 'middle' },
  ],

  valves: [
    // utilitas
    v('PAV1001', X_CW_IN, 354, 143, 364), v('PAV1002', X_CW_RET, 354, 213, 364),
    v('PAV1003', X_STEAM, 354, 283, 364), v('PAV1004', X_AIR, 354, 353, 364),
    v('PAV1005', X_CW_IN, 568, 146, 578), v('PAV1006', X_CW_RET, 568, 216, 578),
    // pure steam / WFI
    h('PDV1001', 557, Y_PURE, 564, 213), h('PDV9001', 649, Y_WFI, 654, 210),
    h('PDV1043', 836, Y_PDV1043, 843, 236),
    v('PCV1001', X_RED_L, 220, 436, 225), v('PCV1002', X_PCV1002, 230, 511, 238),
    h('PCV1003', 455, Y_PCV1003, 456, 311), h('PDV1033', 530, Y_AIR_MID, 538, 317),
    v('PDV1002', X_WFI, 260, 622, 250), v('PDV1003', X_WFI, 332, 622, 335),
    h('PDV1005', 661, Y_HEADER, 664, 318), v('PDV1004', X_PDV1004, 333, 743, 330),
    h('PDV1006', 783, Y_HEADER, 784, 317), h('PCV1004', 455, Y_PCV1004, 458, 378),
    v('PDV1011', X_PDV1011, 353, 991, 370),
    // bawah tanki
    side('PEV1001', X_TANK_OUT, 566), side('PDV1007', X_TANK_OUT, 616), side('PDV1008', X_TANK_OUT, 662),
    // pompa & jalur filter
    { ...h('PDV1009', 755, Y_PUMP, 757, 557), inverted: true },
    h('PDV1012', 1007, Y_PUMP, 1013, 553), h('PDV1014', 1161, Y_PUMP, 1166, 553),
    v('PDV1013', X_FILTER, 591, 1140, 605), v('PCV1007', X_FILTER, 688, 1140, 697),
    // emission
    v('PCV1006', X_PCV1006, 656, 895, 665), v('PCV1005', X_PCV1005, 656, 969, 665), v('PDV1010', X_PDV1010, 656, 1059, 665),
  ],

  instruments: [
    { tag: 'TT1001', unit: '°C', digits: 1, pos: { x: 440, y: 413 } },
    { tag: 'WM1001', unit: 'KG', digits: 1, pos: { x: 440, y: 459 } },
    { tag: 'TT1002', unit: '°C', digits: 1, pos: { x: 431, y: 596 } },
    { tag: 'TT1003', unit: '°C', digits: 1, pos: { x: 738, y: 602 } },
    { tag: 'CT1001', unit: 'µS/cm', digits: 1, pos: { x: 738, y: 649 } },
    { tag: 'TT1004', unit: '°C', digits: 1, pos: { x: 1160, y: 612 } },
    { tag: 'PT1001', unit: 'bar', digits: 2, pos: { x: 818, y: 311 } },
    { tag: 'LMS1001-FREQ', unit: 'HZ', digits: 1, kind: 'motor', runTag: 'LMS1001RUN', pos: { x: 594, y: 388 } },
    { tag: 'P1001-FREQ', unit: 'HZ', digits: 1, kind: 'motor', runTag: 'P1001RUN', pos: { x: 833, y: 454 } },
  ],
};