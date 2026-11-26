import type { MimicConfig } from '@/lib/mimic/types';

// Disalin dari layar HMI "Filling Room". Koordinat dalam satuan viewBox (700 x 570).
const WFI = '#e07b39';      // jalur WFI
const STEAM = '#b83fb8';    // cleaning steam / jalur ke tanki
const EMIT = '#d32f2f';     // jalur emission
const WHITE = '#f6f6f6';

export const fillingRoom: MimicConfig = {
  title: 'Filling Room',
  width: 700,
  height: 570,

  pipes: [
    { d: 'M 330 30 H 247 V 97', color: WFI },                 // WFI masuk
    { d: 'M 135 85 H 247', color: STEAM },                    // cleaning steam
    { d: 'M 247 97 V 205', color: STEAM },                    // pipa vertikal ke tanki
    { d: 'M 247 131 H 343 V 205', color: STEAM },             // loop PDV1031
    { d: 'M 134 206 H 443', color: WHITE, width: 2.5 },       // plat atas tanki
    { d: 'M 243 372 V 417', color: WHITE },                   // keluaran tanki
    { d: 'M 243 417 H 157 V 494 H 100', color: EMIT },        // cabang kiri ke emission
    { d: 'M 243 417 H 400 V 532 H 312', color: WHITE },       // cabang kanan
    { d: 'M 400 433 H 462 V 502 H 400', color: EMIT },        // bypass PCV1020 / PCV1021
  ],

  arrows: [
    { x: 338, y: 30, rot: 180, color: WFI },
    { x: 247, y: 108, rot: 90, color: WFI },
    { x: 138, y: 85, rot: 0, color: STEAM },
    { x: 100, y: 494, rot: 180, color: EMIT },
  ],

  tanks: [{ x: 160, y: 210, w: 160, h: 162 }],

  texts: [
    { x: 355, y: 35, text: 'WFI', anchor: 'start' },
    { x: 24, y: 89, text: 'Cleaning steam', anchor: 'start' },
    { x: 240, y: 296, text: 'Filling buffer tank', anchor: 'middle', underline: true, size: 15 },
    { x: 58, y: 498, text: 'Emission', anchor: 'middle' },
    { x: 264, y: 537, text: 'Emission', anchor: 'middle' },
  ],

  valves: [
    { tag: 'PDV9004', x: 291, y: 30, label: { x: 297, y: 50, anchor: 'middle' } },
    { tag: 'PDV1038', x: 168, y: 85, label: { x: 173, y: 105, anchor: 'middle' } },
    { tag: 'PDV1031', x: 306, y: 131, label: { x: 312, y: 151, anchor: 'middle' } },
    { tag: 'PDV1032', x: 245, y: 170, vertical: true, label: { x: 268, y: 172, rotate: true, anchor: 'middle' } },
    { tag: 'PCV1017', x: 157, y: 448, vertical: true, label: { x: 180, y: 450, rotate: true, anchor: 'middle' } },
    { tag: 'PCV1020', x: 400, y: 467, vertical: true, label: { x: 423, y: 469, rotate: true, anchor: 'middle' } },
    { tag: 'PCV1021', x: 462, y: 467, vertical: true, label: { x: 485, y: 469, rotate: true, anchor: 'middle' } },
  ],

  instrumentBox: { x: 515, y: 16 },
  instruments: [
    { tag: 'TT1012', unit: '°C', digits: 1 },
    { tag: 'PT1003', unit: 'bar', digits: 2 },
    { tag: 'CT1004', unit: 'µS/cm', digits: 1 },
  ],
};
