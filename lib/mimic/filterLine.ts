import type { MimicConfig, MimicValve } from '@/lib/mimic/types';

// Palette warna jalur pipa Filter Line
const PINK = '#d83fd0';
const ORANGE = '#e8a35a';
const BLUE = '#2c4fb0';
const WATER_BLUE = '#3b5fc0';
const RED = '#e02424';
const WHITE = '#f2f2f2';

// Helper pembangun valve
const h = (tag: string, x: number, y: number, lx: number, ly: number): MimicValve =>
  ({ tag, x, y, label: { x: lx, y: ly, anchor: 'middle' } });
const v = (tag: string, x: number, y: number, lx: number, ly: number): MimicValve =>
  ({ tag, x, y, vertical: true, label: { x: lx, y: ly, rotate: true, anchor: 'middle' } });

export const filterLine: MimicConfig = {
  title: 'Filter Line',
  x0: 80,
  y0: 175,
  width: 1115,
  height: 590,

  pipes: [
    // Pure steam kiri
    { d: 'M 185 207 V 705', color: PINK },
    { d: 'M 181 705 V 722', color: RED },
    { d: 'M 185 292 H 315', color: PINK },
    { d: 'M 185 361 H 390', color: PINK },

    // WFI
    { d: 'M 315 207 V 527', color: ORANGE },

    // Oil-free compressed air
    { d: 'M 390 207 V 326', color: BLUE },
    { d: 'M 390 368 V 380 H 680 V 525', color: BLUE },
    { d: 'M 515 380 V 438 H 585', color: BLUE },

    // Pure steam tengah
    { d: 'M 506 207 V 527', color: PINK },

    // Header utama TK1001 / TK1002
    { d: 'M 150 527 H 945', color: PINK },

    // Outlet bawah tangki filter
    { d: 'M 476 527 V 705', color: WHITE },

    // Cooling water (inlet & return)
    { d: 'M 739 207 V 466 H 762', color: WATER_BLUE },
    { d: 'M 855 207 V 447', color: WATER_BLUE },

    // Heat Exchanger outlet & header
    { d: 'M 902 452 H 1059', color: PINK },
    { d: 'M 1037 452 V 705', color: WHITE },
    { d: 'M 945 452 V 527', color: PINK },
    { d: 'M 914 527 V 705', color: WHITE },

    // Jalur menuju TK1001 / TK1002 / Filling
    { d: 'M 1059 452 V 232 H 1028', color: PINK },
    { d: 'M 1008 334 H 1128', color: PINK },

    // Emission
    { d: 'M 1110 705 H 163', color: WHITE },
    { d: 'M 1110 452 V 724 H 183', color: RED },

    // Heat Exchanger E01
    { d: 'M 768 447 H 886 V 485 H 768 Z', color: '#5d7290', width: 2 },
    { d: 'M 775 456 H 884 M 775 466 H 884 M 775 476 H 884', color: '#7f93ad', width: 1.5 },
    { d: 'M 886 441 H 902 V 491 H 886 Z', color: '#3d4d66', width: 2 },

    // Filter F01 (pada pipa udara)
    { d: 'M 381 326 H 399 V 368 H 381 Z', color: '#333', width: 1.5 },

    // Tombol Cooling ON / OFF
    { d: 'M 760 283 H 840 V 315 H 760 Z', color: '#666', width: 1.5 },
    { d: 'M 760 325 H 840 V 357 H 760 Z', color: '#666', width: 1.5 },
  ],

  arrows: [
    { x: 181, y: 722, rot: 90, color: RED },
    { x: 315, y: 292, rot: 0, color: PINK },
    { x: 1028, y: 232, rot: 180, color: PINK },
    { x: 1008, y: 334, rot: 180, color: PINK },
    { x: 1128, y: 334, rot: 0, color: PINK },
    { x: 163, y: 705, rot: 180, color: WHITE },
    { x: 183, y: 724, rot: 180, color: RED },
  ],

  tanks: [
    { x: 418, y: 422, w: 46, h: 103 },
    { x: 585, y: 424, w: 46, h: 101 },
  ],

  texts: [
    { x: 185, y: 198, text: 'Pure steam', anchor: 'middle', size: 13 },
    { x: 318, y: 198, text: 'WFI', anchor: 'middle', size: 13 },
    { x: 390, y: 186, text: 'Oil-free', anchor: 'middle', size: 12 },
    { x: 390, y: 202, text: 'Compressed air', anchor: 'middle', size: 12 },
    { x: 506, y: 200, text: 'Pure steam', anchor: 'middle', size: 13 },
    { x: 747, y: 293, text: 'Cooling water inlet', anchor: 'middle', size: 11, rotate: -90 },
    { x: 859, y: 306, text: 'Cooling water return', anchor: 'middle', size: 11, rotate: -90 },
    { x: 992, y: 237, text: 'TK1001', anchor: 'middle', size: 13 },
    { x: 965, y: 341, text: 'TK1002', anchor: 'middle', size: 13 },
    { x: 1150, y: 342, text: 'Filling', anchor: 'middle', size: 11 },
    { x: 90, y: 527, text: 'TK1001', anchor: 'start', size: 13 },
    { x: 90, y: 543, text: 'TK1002', anchor: 'start', size: 13 },
    { x: 88, y: 710, text: 'Emission', anchor: 'start', size: 13, underline: true },
    { x: 88, y: 732, text: 'Emission', anchor: 'start', size: 13, underline: true },

    // Label tombol cooling
    { x: 800, y: 303, text: 'Cooling ON', anchor: 'middle', size: 11, bold: true },
    { x: 800, y: 345, text: 'Cooling OFF', anchor: 'middle', size: 11, bold: true },
  ],

  valves: [
    // Vertikal
    v('PDV9003', 316, 234, 342, 245),
    v('PCV1019', 390, 270, 418, 275),
    v('PCV1022', 183, 320, 210, 328),
    v('PDV1037', 314, 477, 341, 487),
    v('PDV1035', 506, 478, 532, 492),
    v('PDV1027', 680, 466, 706, 475),
    v('PDV1026', 476, 553, 503, 562),
    v('PCV1014', 476, 653, 503, 662),
    v('PAV1014', 739, 400, 766, 407),
    v('PAV1013', 855, 400, 882, 407),
    v('PDV1028', 945, 500, 971, 510),
    v('PDV1029', 914, 562, 941, 570),
    v('PCV1015', 914, 668, 941, 678),
    v('PCV1016', 1037, 668, 1064, 678),
    v('PDV1030', 1037, 487, 1064, 487),
    v('PDV1039', 1059, 261, 1085, 268),

    // Horizontal
    h('PDV1017', 245, 291, 251, 314),
    h('PCV1018', 240, 361, 245, 385),
    h('PDV1036', 224, 526, 229, 551),
    h('PDV1045', 550, 438, 560, 460),
    h('PCV1023', 627, 380, 632, 403),
    h('PDV1041', 1032, 334, 1028, 357),
    h('PDV1040', 1093, 334, 1100, 357),
  ],

  instruments: [
    { tag: 'TT1008', unit: '°C', digits: 1, pos: { x: 78, y: 602 } },
    { tag: 'TT1009', unit: '°C', digits: 1, pos: { x: 330, y: 585 } },
    { tag: 'TT1013', unit: '°C', digits: 1, pos: { x: 580, y: 545 } },
    { tag: 'CT1003', unit: 'µS/cm', digits: 1, pos: { x: 765, y: 590 } },
    { tag: 'TT1010', unit: '°C', digits: 1, pos: { x: 960, y: 595 } },
    { tag: 'TT1011', unit: '°C', digits: 1, pos: { x: 1045, y: 530 } },
  ],
};
