'use client';

/**
 * FilterLineHmi – renders the read-only HMI Filter Line SVG.
 * Renders read-only valve states and real-time sensor value bindings.
 */

import { useEffect, useRef } from 'react';
import { formatRawParameterValue, normalizeType } from '@/lib/classify';

const SVG_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:c2pa="http://c2pa.org/manifest" viewBox="80 175 1110 585" width="100%" font-family="Arial, Helvetica, sans-serif" role="img" aria-labelledby="hmi-title" preserveAspectRatio="xMidYMid meet" id="hmi-filter-line" style="display:block;width:100%;height:auto;max-width:1200px;">
  <style>
    .valve { transition: fill 0.15s ease, opacity 0.15s ease; }
    .valve.open    { fill: #1f9d4d; }
    .valve.closed  { fill: #d32f2f; }
    .valve.unknown { fill: #9aa0a6; }
    .valve.selected { stroke: #111827; stroke-width: 2.5; }
    .tag { font-size: 12px; fill: #222; user-select: none; }
    .proc { font-size: 13px; fill: #222; user-select: none; }
    .sensor-tag { font-size: 11px; fill: #333; user-select: none; }
    .sensor-value { font-size: 12px; fill: #fff; font-weight: bold; font-family: monospace, Arial, sans-serif; }
    .sensor-unit { font-size: 10px; fill: #fff; }
  </style>
  <title id="hmi-title">HMI Filter Line</title>

  <defs>
    <linearGradient id="grad-tank" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6f84a0"/>
      <stop offset="0.45" stop-color="#c3d0e0"/>
      <stop offset="1" stop-color="#6a7f9b"/>
    </linearGradient>
    <linearGradient id="grad-hx" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c3d0e0"/>
      <stop offset="0.5" stop-color="#7f93ad"/>
      <stop offset="1" stop-color="#5d7290"/>
    </linearGradient>

    <marker id="arrow-magenta" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d83fd0"/></marker>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#e02424"/></marker>
    <marker id="arrow-white" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#f2f2f2"/></marker>

  </defs>

  <!-- ============ BACKGROUND ============ -->
  <rect id="background" x="80" y="175" width="1110" height="585" rx="6" fill="#d3d6d9"/>

  <!-- ============ PIPES ============ -->
  <g id="pipes" fill="none" stroke-width="2" stroke-linejoin="round">
    <!-- Pure steam kiri -->
    <polyline id="pipe-steam-left" class="pipe pipe-steam" points="185,207 185,705" stroke="#d83fd0"/>
    <polyline id="pipe-steam-left-drain" class="pipe pipe-emission" points="181,705 181,722" stroke="#e02424" marker-end="url(#arrow-red)"/>
    <polyline id="pipe-steam-branch-pdv1017" class="pipe pipe-steam" points="185,292 315,292" stroke="#d83fd0" marker-end="url(#arrow-magenta)"/>
    <polyline id="pipe-steam-branch-pcv1018" class="pipe pipe-steam" points="185,361 390,361" stroke="#d83fd0"/>

    <!-- WFI -->
    <polyline id="pipe-wfi" class="pipe pipe-wfi" points="315,207 315,527" stroke="#e8a35a"/>

    <!-- Oil-free compressed air -->
    <polyline id="pipe-air-top" class="pipe pipe-air" points="390,207 390,326" stroke="#2c4fb0"/>
    <polyline id="pipe-air-main" class="pipe pipe-air" points="390,368 390,380 680,380 680,525" stroke="#2c4fb0"/>
    <polyline id="pipe-air-branch-tank2" class="pipe pipe-air" points="515,380 515,438 585,438" stroke="#2c4fb0"/>

    <!-- Pure steam tengah -->
    <polyline id="pipe-steam-middle" class="pipe pipe-steam" points="506,207 506,527" stroke="#d83fd0"/>

    <!-- Header utama TK1001/TK1002 -->
    <polyline id="pipe-main-tk" class="pipe pipe-steam" points="150,527 945,527" stroke="#d83fd0"/>

    <!-- Outlet bawah tangki -->
    <polyline id="pipe-tank-outlet" class="pipe" points="476,527 476,705" stroke="#f2f2f2"/>

    <!-- Cooling water -->
    <polyline id="pipe-cooling-inlet" class="pipe pipe-water" points="739,207 739,466 762,466" stroke="#3b5fc0"/>
    <polyline id="pipe-cooling-return" class="pipe pipe-water" points="855,207 855,447" stroke="#3b5fc0"/>

    <!-- Outlet heat exchanger -->
    <polyline id="pipe-hx-outlet-right" class="pipe pipe-steam" points="902,452 1059,452" stroke="#d83fd0"/>
    <polyline id="pipe-line-pdv1030-pcv1016" class="pipe" points="1037,452 1037,705" stroke="#f2f2f2"/>
    <polyline id="pipe-hx-outlet-down" class="pipe pipe-steam" points="902,472 945,472 945,527" stroke="#d83fd0"/>
    <polyline id="pipe-drain-1029-1015" class="pipe" points="914,527 914,705" stroke="#f2f2f2"/>

    <!-- TK1001 / TK1002 / Filling -->
    <polyline id="pipe-tk1001" class="pipe pipe-steam" points="1059,452 1059,232 1028,232" stroke="#d83fd0" marker-end="url(#arrow-magenta)"/>
    <polyline id="pipe-tk1002-filling" class="pipe pipe-steam" points="1008,334 1128,334" stroke="#d83fd0" marker-start="url(#arrow-magenta)" marker-end="url(#arrow-magenta)"/>

    <!-- Emission -->
    <polyline id="pipe-emission-white" class="pipe pipe-emission" points="1110,705 163,705" stroke="#f2f2f2" marker-end="url(#arrow-white)"/>
    <polyline id="pipe-emission-red" class="pipe pipe-emission" points="1110,452 1110,724 183,724" stroke="#e02424" marker-end="url(#arrow-red)"/>
  </g>

  <!-- ============ TANKS & EQUIPMENT ============ -->
  <g id="tanks">
    <g id="tank-t01" class="tank">
      <path d="M418,422 v96 a23,7 0 0 0 46,0 v-96 z" fill="url(#grad-tank)" stroke="#4d5f78" stroke-width="1"/>
      <ellipse cx="441" cy="422" rx="23" ry="7" fill="#aebfd3" stroke="#4d5f78" stroke-width="1"/>
    </g>
    <g id="tank-t02" class="tank">
      <path d="M585,424 v94 a23,7 0 0 0 46,0 v-94 z" fill="url(#grad-tank)" stroke="#4d5f78" stroke-width="1"/>
      <ellipse cx="608" cy="424" rx="23" ry="7" fill="#aebfd3" stroke="#4d5f78" stroke-width="1"/>
    </g>
  </g>

  <g id="equipment">
    <g id="heat-exchanger-e01" class="heat-exchanger">
      <rect x="768" y="447" width="118" height="38" fill="url(#grad-hx)" stroke="#4d5f78" stroke-width="1"/>
      <ellipse cx="768" cy="466" rx="9" ry="19" fill="#7f93ad" stroke="#4d5f78" stroke-width="1"/>
      <line x1="775" y1="456" x2="884" y2="456" stroke="#4d5f78" stroke-width="1"/>
      <line x1="775" y1="466" x2="884" y2="466" stroke="#4d5f78" stroke-width="1"/>
      <line x1="775" y1="476" x2="884" y2="476" stroke="#4d5f78" stroke-width="1"/>
      <rect x="886" y="441" width="16" height="50" fill="#5d7290" stroke="#3d4d66" stroke-width="1"/>
    </g>
    <g id="filter-f01" class="filter">
      <rect x="381" y="326" width="18" height="42" rx="3" fill="#e4e4e4" stroke="#333" stroke-width="1.5"/>
      <rect x="381" y="326" width="18" height="8" rx="3" fill="#fff" stroke="#333" stroke-width="1.5"/>
    </g>
  </g>

  <!-- ============ COOLING STATUS (read-only) ============ -->
  <g id="cooling-status" aria-label="Cooling status">
    <g id="indicator-cooling-on">
      <rect x="760" y="283" width="80" height="32" rx="3" fill="#d9d9d9" stroke="#666" stroke-width="1.5"/>
      <text x="800" y="303" font-size="11" font-weight="bold" text-anchor="middle" fill="#222">Cooling ON</text>
    </g>
    <g id="indicator-cooling-off">
      <rect x="760" y="325" width="80" height="32" rx="3" fill="#d9d9d9" stroke="#666" stroke-width="1.5"/>
      <text x="800" y="345" font-size="11" font-weight="bold" text-anchor="middle" fill="#222">Cooling OFF</text>
    </g>
  </g>

  <!-- ============ VALVES (23 valve) ============ -->
  <g id="valves" stroke="#1f2937" stroke-width="1">
    <!-- Vertikal -->
    <g id="valve-pdv9003" class="valve" data-tag="PDV9003" transform="translate(316,234)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pcv1019" class="valve" data-tag="PCV1019" transform="translate(390,270)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pcv1022" class="valve" data-tag="PCV1022" transform="translate(183,320)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1037" class="valve" data-tag="PDV1037" transform="translate(314,477)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1035" class="valve" data-tag="PDV1035" transform="translate(506,478)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1027" class="valve" data-tag="PDV1027" transform="translate(680,466)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1026" class="valve open" data-tag="PDV1026" transform="translate(476,553)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pcv1014" class="valve open" data-tag="PCV1014" transform="translate(476,653)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pav1014" class="valve" data-tag="PAV1014" transform="translate(739,400)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pav1013" class="valve" data-tag="PAV1013" transform="translate(855,400)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1028" class="valve" data-tag="PDV1028" transform="translate(945,500)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1029" class="valve" data-tag="PDV1029" transform="translate(914,562)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pcv1015" class="valve" data-tag="PCV1015" transform="translate(914,668)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pcv1016" class="valve" data-tag="PCV1016" transform="translate(1037,668)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1030" class="valve" data-tag="PDV1030" transform="translate(1037,487)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <g id="valve-pdv1039" class="valve" data-tag="PDV1039" transform="translate(1059,261)" fill="#6b7280"><polygon points="-7,-9 7,-9 0,0"/><polygon points="-7,9 7,9 0,0"/></g>
    <!-- Horizontal -->
    <g id="valve-pdv1017" class="valve" data-tag="PDV1017" transform="translate(245,291)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
    <g id="valve-pcv1018" class="valve" data-tag="PCV1018" transform="translate(240,361)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
    <g id="valve-pdv1036" class="valve" data-tag="PDV1036" transform="translate(224,526)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
    <g id="valve-pdv1045" class="valve" data-tag="PDV1045" transform="translate(550,438)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
    <g id="valve-pcv1023" class="valve" data-tag="PCV1023" transform="translate(627,380)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
    <g id="valve-pdv1041" class="valve" data-tag="PDV1041" transform="translate(1032,334)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
    <g id="valve-pdv1040" class="valve" data-tag="PDV1040" transform="translate(1093,334)" fill="#6b7280"><polygon points="-9,-7 -9,7 0,0"/><polygon points="9,-7 9,7 0,0"/></g>
  </g>

  <!-- ============ MOTORS / PUMPS ============ -->
  <g id="motors"/>

  <!-- ============ SENSORS ============ -->
  <g id="sensors">
    <g id="sensor-tt1008-leader" stroke="#777" stroke-width="1"><line x1="183" y1="628" x2="185" y2="628"/></g>
    <g id="sensor-tt1009-leader" stroke="#777" stroke-width="1"><line x1="464" y1="608" x2="476" y2="608"/></g>
    <g id="sensor-tt1013-leader" stroke="#777" stroke-width="1"><line x1="645" y1="527" x2="645" y2="543"/></g>
    <g id="sensor-ct1003-leader" stroke="#777" stroke-width="1"><line x1="882" y1="614" x2="914" y2="614"/></g>
    <g id="sensor-tt1011-leader" stroke="#777" stroke-width="1"><line x1="1037" y1="545" x2="1050" y2="545"/></g>

    <g id="sensor-tt1008" class="sensor temperature" data-tag="TT1008" transform="translate(91,607)">
      <rect width="92" height="42" fill="#e6e6e6" stroke="#8a8a8a"/>
      <text class="sensor-tag" x="4" y="14">TT1008</text>
      <rect class="sensor-value-bg" x="2" y="20" width="88" height="21" fill="#3f4f96"/>
      <text id="sensor-tt1008-value" class="sensor-value" x="55" y="35" text-anchor="end">25.9</text>
      <text class="sensor-unit" x="87" y="35" text-anchor="end">°C</text>
    </g>
    <g id="sensor-tt1009" class="sensor temperature" data-tag="TT1009" transform="translate(372,587)">
      <rect width="92" height="42" fill="#e6e6e6" stroke="#8a8a8a"/>
      <text class="sensor-tag" x="4" y="14">TT1009</text>
      <rect class="sensor-value-bg" x="2" y="20" width="88" height="21" fill="#3f4f96"/>
      <text id="sensor-tt1009-value" class="sensor-value" x="55" y="35" text-anchor="end">37.0</text>
      <text class="sensor-unit" x="87" y="35" text-anchor="end">°C</text>
    </g>
    <g id="sensor-tt1013" class="sensor temperature" data-tag="TT1013" transform="translate(601,543)">
      <rect width="92" height="42" fill="#e6e6e6" stroke="#8a8a8a"/>
      <text class="sensor-tag" x="4" y="14">TT1013</text>
      <rect class="sensor-value-bg" x="2" y="20" width="88" height="21" fill="#3f4f96"/>
      <text id="sensor-tt1013-value" class="sensor-value" x="55" y="35" text-anchor="end">42.0</text>
      <text class="sensor-unit" x="87" y="35" text-anchor="end">°C</text>
    </g>
    <g id="sensor-ct1003" class="sensor conductivity" data-tag="CT1003" transform="translate(790,592)">
      <rect width="92" height="42" fill="#e6e6e6" stroke="#8a8a8a"/>
      <text class="sensor-tag" x="4" y="14">CT1003</text>
      <rect class="sensor-value-bg" x="2" y="20" width="88" height="21" fill="#3f4f96"/>
      <text id="sensor-ct1003-value" class="sensor-value" x="55" y="35" text-anchor="end">0.1</text>
      <text class="sensor-unit" x="87" y="35" text-anchor="end">µS/cm</text>
    </g>
    <g id="sensor-tt1010" class="sensor temperature" data-tag="TT1010" transform="translate(929,601)">
      <rect width="92" height="42" fill="#e6e6e6" stroke="#8a8a8a"/>
      <text class="sensor-tag" x="4" y="14">TT1010</text>
      <rect class="sensor-value-bg" x="2" y="20" width="88" height="21" fill="#3f4f96"/>
      <text id="sensor-tt1010-value" class="sensor-value" x="55" y="35" text-anchor="end">26.2</text>
      <text class="sensor-unit" x="87" y="35" text-anchor="end">°C</text>
    </g>
    <g id="sensor-tt1011" class="sensor temperature" data-tag="TT1011" transform="translate(1050,527)">
      <rect width="92" height="42" fill="#e6e6e6" stroke="#8a8a8a"/>
      <text class="sensor-tag" x="4" y="14">TT1011</text>
      <rect class="sensor-value-bg" x="2" y="20" width="88" height="21" fill="#3f4f96"/>
      <text id="sensor-tt1011-value" class="sensor-value" x="55" y="35" text-anchor="end">24.5</text>
      <text class="sensor-unit" x="87" y="35" text-anchor="end">°C</text>
    </g>
  </g>

  <!-- ============ INDICATORS ============ -->
  <g id="indicators">
    <g id="indicator-alarm" class="indicator alarm-indicator">
      <rect x="1140" y="414" width="40" height="52" fill="#ececec" stroke="#888"/>
      <polygon points="1160,422 1148,446 1172,446" fill="#facc15" stroke="#111" stroke-width="2" stroke-linejoin="round"/>
      <text x="1160" y="442" font-size="14" font-weight="bold" text-anchor="middle" fill="#111">!</text>
      <text id="indicator-alarm-count" x="1160" y="462" font-size="8" text-anchor="middle" fill="#111">0</text>
    </g>
  </g>

  <!-- ============ LABELS ============ -->
  <g id="labels" font-size="12" fill="#222">
    <!-- Label proses -->
    <text id="label-pure-steam-left" class="proc" x="185" y="202" text-anchor="middle">Pure steam</text>
    <text id="label-wfi" class="proc" x="318" y="202" text-anchor="middle">WFI</text>
    <text id="label-oil-free" class="proc" x="390" y="190" text-anchor="middle">Oil-free</text>
    <text id="label-compressed-air" class="proc" x="390" y="208" text-anchor="middle">Compressed air</text>
    <text id="label-pure-steam-middle" class="proc" x="506" y="205" text-anchor="middle">Pure steam</text>
    <text id="label-cooling-water-inlet" class="proc" transform="translate(747,293) rotate(-90)" font-size="11">Cooling water inlet</text>
    <text id="label-cooling-water-return" class="proc" transform="translate(859,306) rotate(-90)" font-size="11">Cooling water return</text>
    <text id="label-tk1001-top" class="proc" x="992" y="237" text-anchor="middle">TK1001</text>
    <text id="label-tk1002-top" class="proc" x="965" y="341" text-anchor="middle">TK1002</text>
    <text id="label-filling" class="proc" x="1150" y="342" font-size="10" text-anchor="middle">Filling</text>
    <text id="label-tk1001-left" class="proc" x="90" y="527">TK1001</text>
    <text id="label-tk1002-left" class="proc" x="90" y="543">TK1002</text>
    <text id="label-emission-1" class="proc" x="88" y="710">Emission</text>
    <text id="label-emission-2" class="proc" x="88" y="732">Emission</text>

    <!-- Tag valve vertikal (diputar -90) -->
    <text id="label-pdv9003" class="tag" transform="translate(342,245) rotate(-90)" text-anchor="middle">PDV9003</text>
    <text id="label-pcv1019" class="tag" transform="translate(418,275) rotate(-90)" text-anchor="middle">PCV1019</text>
    <text id="label-pcv1022" class="tag" transform="translate(210,328) rotate(-90)" text-anchor="middle">PCV1022</text>
    <text id="label-pdv1037" class="tag" transform="translate(341,487) rotate(-90)" text-anchor="middle">PDV1037</text>
    <text id="label-pdv1035" class="tag" transform="translate(532,484) rotate(-90)" text-anchor="middle">PDV1035</text>
    <text id="label-pdv1026" class="tag" transform="translate(503,562) rotate(-90)" text-anchor="middle">PDV1026</text>
    <text id="label-pcv1014" class="tag" transform="translate(503,662) rotate(-90)" text-anchor="middle">PCV1014</text>
    <text id="label-pav1014" class="tag" transform="translate(766,407) rotate(-90)" text-anchor="middle">PAV1014</text>
    <text id="label-pav1013" class="tag" transform="translate(882,407) rotate(-90)" text-anchor="middle">PAV1013</text>
    <text id="label-pdv1027" class="tag" transform="translate(706,475) rotate(-90)" text-anchor="middle">PDV1027</text>
    <text id="label-pdv1028" class="tag" transform="translate(971,510) rotate(-90)" text-anchor="middle">PDV1028</text>
    <text id="label-pdv1029" class="tag" transform="translate(941,570) rotate(-90)" text-anchor="middle">PDV1029</text>
    <text id="label-pcv1015" class="tag" transform="translate(941,678) rotate(-90)" text-anchor="middle">PCV1015</text>
    <text id="label-pcv1016" class="tag" transform="translate(1064,678) rotate(-90)" text-anchor="middle">PCV1016</text>
    <text id="label-pdv1030" class="tag" transform="translate(1064,487) rotate(-90)" text-anchor="middle">PDV1030</text>
    <text id="label-pdv1039" class="tag" transform="translate(1085,268) rotate(-90)" text-anchor="middle">PDV1039</text>

    <!-- Tag valve horizontal -->
    <text id="label-pdv1017" class="tag" x="251" y="314" text-anchor="middle">PDV1017</text>
    <text id="label-pcv1018" class="tag" x="245" y="385" text-anchor="middle">PCV1018</text>
    <text id="label-pdv1036" class="tag" x="229" y="551" text-anchor="middle">PDV1036</text>
    <text id="label-pdv1045" class="tag" x="557" y="461" text-anchor="middle">PDV1045</text>
    <text id="label-pcv1023" class="tag" x="632" y="403" text-anchor="middle">PCV1023</text>
    <text id="label-pdv1041" class="tag" x="1028" y="357" text-anchor="middle">PDV1041</text>
    <text id="label-pdv1040" class="tag" x="1100" y="357" text-anchor="middle">PDV1040</text>
  </g>
</svg>`;

interface FilterLineHmiProps {
  valveStates?: Record<string, boolean | null | undefined>;
  sensorValues?: Record<string, number | null | undefined>;
  stale?: boolean;
}

export default function FilterLineHmi({ valveStates, sensorValues, stale }: FilterLineHmiProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Initialize the read-only SVG indicators.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const svg = wrapperRef.current.querySelector('svg');
    if (!svg) return;

    const STATE: Record<string, string> = {
      ON: 'open',
      OFF: 'closed',
      ALARM: 'alarm',
    };

    function normalizeState(value: unknown): 'ON' | 'OFF' | 'UNKNOWN' {
      const v = String(value ?? '').trim().toUpperCase();
      if (['ON', 'OPEN', '1', 'TRUE', 'RUNNING'].includes(v)) return 'ON';
      if (['OFF', 'CLOSED', '0', 'FALSE', 'STOPPED'].includes(v)) return 'OFF';
      return 'UNKNOWN';
    }

    function getValve(tag: string): SVGElement | null {
      return svg?.querySelector(`.valve[data-tag="${CSS.escape(tag)}"]`) ?? null;
    }

    function setValveState(tag: string, value: unknown): boolean {
      const valve = getValve(tag);
      if (!valve) {
        return false;
      }
      const state = normalizeState(value);
      valve.classList.remove('open', 'closed', 'unknown', 'alarm');
      valve.classList.add(state === 'UNKNOWN' ? 'unknown' : STATE[state]);
      valve.setAttribute('data-state', state);
      valve.setAttribute('aria-label', `${tag} ${state}`);
      valve.setAttribute('title', `${tag} : ${state}`);
      return true;
    }

    // Inisialisasi seluruh valve sebagai indikator read-only.
    svg.querySelectorAll<SVGElement>('.valve[data-tag]').forEach((valve) => {
      const tag = valve.getAttribute('data-tag');
      if (!tag) return;
      const initialState = valve.classList.contains('open') ? 'ON' : 'UNKNOWN';
      setValveState(tag, initialState);
    });
  }, []);

  // Update valve states when props change (real-time stream or initial fetch)
  useEffect(() => {
    if (!valveStates || !wrapperRef.current) return;
    const svg = wrapperRef.current.querySelector('svg');
    if (!svg) return;

    for (const [tag, state] of Object.entries(valveStates)) {
      const valve = svg.querySelector(`.valve[data-tag="${CSS.escape(tag)}"]`);
      if (!valve) continue;

      const norm = (state === null || state === undefined || stale) ? 'unknown' : state ? 'open' : 'closed';
      valve.classList.remove('open', 'closed', 'unknown', 'alarm');
      valve.classList.add(norm);
      valve.setAttribute('data-state', norm === 'open' ? 'ON' : 'OFF');
      valve.setAttribute('title', `${tag} : ${norm === 'open' ? 'ON' : 'OFF'}`);
    }
  }, [valveStates, stale]);

  // Cooling ON is active only when both verified cooling valve feedbacks are ON.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const svg = wrapperRef.current.querySelector('svg');
    const on = svg?.querySelector<SVGGElement>('#indicator-cooling-on');
    const off = svg?.querySelector<SVGGElement>('#indicator-cooling-off');
    if (!on || !off) return;

    const valid = !stale && valveStates?.PAV1014 != null && valveStates.PAV1013 != null;
    const active = valid && valveStates.PAV1014 === true && valveStates.PAV1013 === true;
    const onRect = on.querySelector('rect');
    const offRect = off.querySelector('rect');
    if (onRect) onRect.setAttribute('fill', active ? '#1f9d4d' : '#d9d9d9');
    if (offRect) offRect.setAttribute('fill', valid && !active ? '#d9d9d9' : '#bdbdbd');
    on.setAttribute('aria-label', active ? 'Cooling aktif' : valid ? 'Cooling tidak aktif' : 'Status cooling tidak tersedia');
    off.setAttribute('aria-label', active ? 'Cooling tidak aktif' : valid ? 'Cooling aktif' : 'Status cooling tidak tersedia');
  }, [valveStates, stale]);

  // Update sensors
  useEffect(() => {
    if (!wrapperRef.current) return;
    const svg = wrapperRef.current.querySelector('svg');
    if (!svg) return;

    if (!sensorValues) return;
    for (const [tag, val] of Object.entries(sensorValues)) {
      const el = svg.querySelector(`#sensor-${tag.toLowerCase()}-value`);
      if (el) {
        const tag = el.closest<SVGElement>('[data-tag]')?.dataset.tag ?? '';
        const type = normalizeType(null, null, tag);
        el.textContent = (val === null || val === undefined)
          ? '–'
          : formatRawParameterValue(val, type);
      }
    }
  }, [sensorValues, stale]);

  return (
    <div
      ref={wrapperRef}
      id="filter-line-hmi-container"
      style={{
        width: '100%',
        maxWidth: 1200,
        overflowX: 'auto',
      }}
      dangerouslySetInnerHTML={{ __html: SVG_MARKUP }}
    />
  );
}
