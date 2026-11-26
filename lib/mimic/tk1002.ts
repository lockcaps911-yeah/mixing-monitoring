import type { MimicConfig, MimicValve } from '@/lib/mimic/types';

// Warna jalur pipa HMI TK1002
const PINK = '#c026d3';
const ORANGE = '#e8702a';
const CYAN = '#22b8cf';
const RED = '#dc2626';
const BLUE = '#2563eb';
const WHITE = '#f5f5f5';
const GRAY = '#8a8f98';

// Helper pembangun valve
const h = (tag: string, x: number, y: number, lx: number, ly: number): MimicValve =>
  ({ tag, x, y, label: { x: lx, y: ly, anchor: 'middle' } });
const v = (tag: string, x: number, y: number, lx: number, ly: number): MimicValve =>
  ({ tag, x, y, vertical: true, label: { x: lx, y: ly, rotate: true, anchor: 'middle' } });
const side = (tag: string, x: number, y: number): MimicValve =>
  ({ tag, x, y, vertical: true, label: { x: x + 21, y: y + 5, anchor: 'start' } });

export const tk1002: MimicConfig = {
  title: 'TK1002',
  x0: 110,
  y0: 170,
  width: 1170,
  height: 590,

  pipes: [
    // Rangka / utilitas
    { d: 'M 540 306 H 413 V 697 H 765 V 606', color: GRAY },
    { d: 'M 238 322 V 343 M 238 367 V 402 H 578', color: CYAN },
    { d: 'M 170 367 V 526 H 578 M 170 526 V 553 M 170 577 V 620 H 235', color: CYAN },
    { d: 'M 308 320 V 343 M 308 367 V 392', color: RED },
    { d: 'M 377 320 V 345 M 377 369 V 392', color: BLUE },
    { d: 'M 408 286 V 298 H 486 M 510 298 H 540', color: BLUE },

    // Pure steam, WFI & header atas
    { d: 'M 460 201 V 216 M 460 201 H 588 M 612 201 H 680 M 537 201 V 228', color: PINK },
    { d: 'M 900 357 V 375 H 537 V 252 M 537 375 V 388 H 600', color: WHITE },
    { d: 'M 738 201 H 705 M 679 201 H 645', color: ORANGE },
    { d: 'M 645 201 V 258 M 645 282 V 328 M 645 352 V 368', color: PINK },
    { d: 'M 645 229 H 865 M 889 229 H 958', color: PINK },
    { d: 'M 540 306 H 561 M 585 306 H 691 M 715 306 H 812 M 836 306 H 1003 V 353 M 1003 377 V 543 H 1029 M 1053 543 H 1202 M 1226 543 H 1245', color: PINK },
    { d: 'M 762 306 V 330 M 762 354 V 375', color: PINK },
    { d: 'M 462 362 H 486 M 510 362 H 535', color: PINK },

    // Pompa P1002 & jalur filter
    { d: 'M 852 531 V 443 H 1003', color: PINK },
    { d: 'M 645 640 H 745 V 542 H 780 M 804 542 H 842', color: PINK },
    { d: 'M 1152 310 H 1238 M 1152 310 V 591 M 1152 615 V 655', color: PINK },
    { d: 'M 1148 655 V 685 M 1148 709 V 715', color: WHITE },
    { d: 'M 645 535 V 556 M 645 580 V 605 M 645 629 V 650 M 645 674 V 697', color: GRAY },

    // Jalur pembuangan & emission
    { d: 'M 852 560 V 592 H 1070 V 653 M 1070 677 V 738', color: RED },
    { d: 'M 905 608 H 980 V 651 M 980 675 V 738', color: RED },
    { d: 'M 765 606 H 905 V 651 M 905 675 V 715', color: GRAY },
    { d: 'M 1152 668 H 1220 V 738', color: RED },
    { d: 'M 460 240 V 738', color: RED },
    { d: 'M 238 530 V 555 M 238 579 V 738', color: RED },
    { d: 'M 1150 715 H 225', color: WHITE },
    { d: 'M 1222 740 H 225', color: RED },

    // Komponen filter atas
    { d: 'M 530 335 H 542 V 370 H 530 Z', color: '#555', width: 1.5 },
  ],

  arrows: [
    { x: 692, y: 375, rot: 180, color: WHITE },
    { x: 537, y: 258, rot: 270, color: WHITE },
    { x: 238, y: 318, rot: 270, color: CYAN },
    { x: 308, y: 397, rot: 90,  color: RED },
    { x: 377, y: 397, rot: 90,  color: BLUE },
    { x: 720, y: 201, rot: 180, color: ORANGE },
    { x: 970, y: 229, rot: 0,   color: PINK },
    { x: 1244, y: 310, rot: 0,  color: PINK },
    { x: 460, y: 742, rot: 90,  color: RED },
    { x: 238, y: 742, rot: 90,  color: RED },
    { x: 212, y: 715, rot: 180, color: WHITE },
    { x: 212, y: 740, rot: 180, color: RED },
  ],

  tanks: [{ x: 578, y: 380, w: 137, h: 158 }],
  tankLabel: { x: 650, y: 530, text: 'TK1002' },
  agitators: [{ x: 610, y: 430, h: 48, runTag: 'LMX1002RUN' }],
  pumps: [{ x: 851, y: 541, runTag: 'P1002RUN' }],

  texts: [
    { x: 172, y: 277, text: 'Cooling water inlet',    anchor: 'middle', size: 11, rotate: -90 },
    { x: 240, y: 290, text: 'Cooling water return',   anchor: 'middle', size: 11, rotate: -90 },
    { x: 310, y: 258, text: 'Industrial steam',       anchor: 'middle', size: 11, rotate: -90 },
    { x: 378, y: 303, text: 'Low-oil compressed air', anchor: 'middle', size: 11, rotate: -90 },
    { x: 402, y: 272, text: 'Oil-free',               anchor: 'middle', size: 11, rotate: -90 },
    { x: 418, y: 270, text: 'Compressed air',         anchor: 'middle', size: 11, rotate: -90 },
    { x: 436, y: 176, text: 'Pure steam',             anchor: 'start',  size: 14 },
    { x: 751, y: 206, text: 'WFI',                    anchor: 'start',  size: 13 },
    { x: 1243, y: 318, text: 'Filter',                anchor: 'start',  size: 14 },
    { x: 882, y: 569, text: 'P1002',                  anchor: 'middle', size: 13, bold: true },
    { x: 136, y: 719, text: 'Emission',               anchor: 'start',  size: 14, underline: true },
    { x: 136, y: 740, text: 'Emission',               anchor: 'start',  size: 14, underline: true },
    { x: 775, y: 791, text: 'Current step sequence:', anchor: 'start',  size: 15 },
    { x: 775, y: 814, text: 'TK1002SIP',              anchor: 'start',  size: 17, bold: true },
  ],

  valves: [
    // Utilitas pendingin & udara
    v('PAV1007', 170, 355, 190, 368),
    v('PAV1008', 238, 355, 258, 368),
    v('PAV1009', 308, 355, 328, 368),
    v('PAV1010', 377, 357, 397, 368),
    v('PAV1011', 170, 565, 190, 578),
    v('PAV1012', 238, 567, 258, 580),

    // Pure steam, WFI & header
    v('PCV1008', 460, 228, 480, 245),
    v('PCV1009', 537, 240, 556, 252),
    h('PDV1016', 600, 201, 606, 222),
    h('PDV9002', 692, 201, 697, 220),
    v('PDV1044', 643, 270, 662, 258),
    h('PDV1042', 877, 229, 884, 249),
    h('PCV1010', 498, 300, 500, 318),
    h('PDV1034', 573, 306, 574, 326),
    h('PDV1019', 703, 306, 705, 327),
    h('PDV1020', 824, 306, 825, 327),
    v('PDV1018', 643, 340, 662, 358),
    v('PDV1021', 762, 342, 782, 328),
    h('PCV1011', 498, 362, 502, 384),
    v('PDV1015', 1005, 365, 1025, 368),

    // Pompa & jalur filter
    { ...h('PDV1024', 792, 542, 792, 566), inverted: true },
    h('PDV1014', 1041, 543, 1047, 566),
    h('PDV1012', 1214, 545, 1221, 567),
    v('PDV1013', 1150, 603, 1172, 612),
    v('PCV1007', 1148, 697, 1170, 712),

    // Bawah tangki
    side('PEV1002', 645, 568),
    side('PDV1022', 645, 617),
    side('PDV1023', 645, 662),

    // Jalur pembuangan / emission
    v('PCV1012', 906, 663, 928, 670),
    v('PCV1013', 980, 663, 1002, 668),
    v('PDV1025', 1068, 665, 1090, 670),
  ],

  instruments: [
    { tag: 'TT1005',       unit: 'C',     digits: 1,             pos: { x: 468, y: 418 } },
    { tag: 'WM1002',       unit: 'KG',    digits: 1,             pos: { x: 468, y: 463 } },
    { tag: 'TT1006',       unit: 'C',     digits: 1,             pos: { x: 468, y: 596 } },
    { tag: 'TT1007',       unit: 'C',     digits: 1,             pos: { x: 768, y: 608 } },
    { tag: 'CT1002',       unit: 'uS/cm', digits: 1,             pos: { x: 768, y: 656 } },
    { tag: 'TT1004',       unit: 'C',     digits: 1,             pos: { x: 1175, y: 624 } },
    { tag: 'PT1002',       unit: 'bar',   digits: 2, pos: { x: 848, y: 314 } },
    { tag: 'LMS1002-FREQ', unit: 'HZ',   digits: 1, kind: 'motor', runTag: 'LMX1002RUN', pos: { x: 632, y: 396 } },
    { tag: 'P1002-FREQ',   unit: 'HZ',   digits: 1, kind: 'motor', runTag: 'P1002RUN',   pos: { x: 869, y: 495 } },
  ],
};