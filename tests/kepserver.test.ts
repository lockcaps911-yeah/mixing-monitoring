import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadEnvConfig } from '@next/env';
import {
  createKepReadUrl,
  hasGoodKepQuality,
  isLine4MotorFrequencyTag,
  line4ParameterTypeFor,
  parseLine4RestExport,
  parseKepReadResults,
  resolveKepserverTagId,
} from '../lib/kepserver';
import {
  applyParameterCalibration,
  calculateParameterCalibration,
  line4FrequencyToRawValue,
  loadParameterCalibrations,
  type ParameterCalibrations,
} from '../lib/parameterCalibration';
import { splitLine4RealtimeMessage } from '../lib/line4Realtime';
import type { RealtimeMessage } from '../lib/realtime';
import {
  boolRole,
  formatEngineeringParameterValue,
  formatParameterValue,
  formatRawParameterValue,
  isBoolean,
  TYPE_UNIT,
} from '../lib/classify';
import { LINE3_TANK_TAGS, line3HmiSensorTag, line3SensorDisplayName } from '../lib/mimic/line3TankTags';
import { SCREENS } from '../lib/mimic/screens';

test('Line 3 HMI sensor labels map only to their tank database tags', () => {
  assert.equal(line3HmiSensorTag('TT 1-01', 'T1'), 'DB2_TT1_01');
  assert.equal(line3HmiSensorTag('PT 2-01', 'T2'), 'DB2_PT2_01');
  assert.equal(line3HmiSensorTag('CE 1-01', 'T1'), 'DB2_CE1_01');
  assert.equal(line3HmiSensorTag('WM 2-01', 'T2'), 'DB2_WM2_01');
  assert.equal(line3HmiSensorTag('AGIT', 'T1'), 'DB2_MS1_01');
  assert.equal(line3HmiSensorTag('TT 2-01', 'T1'), null);
  assert.equal(line3HmiSensorTag('TT 1-99', 'T1'), null);
  assert.equal(line3HmiSensorTag('IN1.P1', 'T1'), null);
});

test('Line 3 sensor aliases are display-only and unknown tags remain unchanged', () => {
  assert.deepEqual(LINE3_TANK_TAGS.sensors.T1, [
    'DB2_CE1_01', 'DB2_WM1_01', 'DB2_MS1_01', 'DB2_PT1_01',
    'DB2_TT1_01', 'DB2_TT1_02', 'DB2_TT1_03', 'DB2_TT1_04', 'DB2_TT1_05',
  ]);
  assert.deepEqual(LINE3_TANK_TAGS.sensors.T2, [
    'DB2_CE2_01', 'DB2_WM2_01', 'DB2_MS2_01', 'DB2_PT2_01',
    'DB2_TT2_01', 'DB2_TT2_02', 'DB2_TT2_03', 'DB2_TT2_04', 'DB2_TT2_05',
  ]);
  assert.deepEqual(LINE3_TANK_TAGS.sensors.T1.map(line3SensorDisplayName), [
    'CE1-01', 'WM1-01', 'MS1-01', 'PT1-01',
    'TT1-01', 'TT1-02', 'TT1-03', 'TT1-04', 'TT1-05',
  ]);
  assert.deepEqual(LINE3_TANK_TAGS.sensors.T2.map(line3SensorDisplayName), [
    'CE2-01', 'WM2-01', 'MS2-01', 'PT2-01',
    'TT2-01', 'TT2-02', 'TT2-03', 'TT2-04', 'TT2-05',
  ]);
  assert.equal(line3SensorDisplayName('DB2_CE1_01'), 'CE1-01');
  assert.equal(line3SensorDisplayName('DB2_TT2_05'), 'TT2-05');
  assert.equal(line3SensorDisplayName('UNRECOGNIZED_TAG'), 'UNRECOGNIZED_TAG');
  assert.equal(line3HmiSensorTag('AGIT', 'T1'), 'DB2_MS1_01');
});

test('KepServer read URL sends each tag as a separate ids parameter', () => {
  const ids = [
    'S7-1200PLC.MIXING_LINE4.BZL-01',
    'S7-1200PLC.MIXING_LINE4.CT1001',
  ];

  const url = createKepReadUrl('http://127.0.0.1:39320/iotgateway/', ids);

  assert.deepEqual(url.searchParams.getAll('ids'), ids);
});

test('Line 4 realtime notifications are split below PostgreSQL size limits without losing readings', () => {
  const tags = Array.from({ length: 120 }, (_, index) => `TAG${index}`);
  const message: RealtimeMessage = {
    line: 'line4',
    machine: 'mixingL4',
    ts: new Date().toISOString(),
    values: Object.fromEntries(tags.map((tag, index) => [tag, index])),
    quality: Object.fromEntries(tags.map((tag) => [tag, 'GOOD'])),
    timestamps: Object.fromEntries(tags.map((tag) => [tag, new Date().toISOString()])),
    valves: Object.fromEntries(tags.slice(0, 20).map((tag, index) => [tag, index % 2 === 0])),
  };

  const chunks = splitLine4RealtimeMessage(message);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Buffer.byteLength(JSON.stringify(chunk), 'utf8') <= 7000));
  assert.deepEqual(Object.assign({}, ...chunks.map((chunk) => chunk.values)), message.values);
  assert.deepEqual(Object.assign({}, ...chunks.map((chunk) => chunk.quality)), message.quality);
  assert.deepEqual(Object.assign({}, ...chunks.map((chunk) => chunk.timestamps)), message.timestamps);
  assert.deepEqual(Object.assign({}, ...chunks.map((chunk) => chunk.valves)), message.valves);
});

test('Line 3 fallback uses its separate Boolean and DB2 REST namespaces', () => {
  assert.equal(
    resolveKepserverTagId('line3', 'DB2_CE1_01'),
    'S7-1200PLC.MIXING_LINE3DB.DB2_CE1_01',
  );
  assert.equal(
    resolveKepserverTagId('line3', 'PBV 1-01'),
    'S7-1200PLC.MIXING LINE3.PBV 1-01',
  );
  assert.equal(
    resolveKepserverTagId('line3', 'DB2_TT2_05', { line3db: 'verified.DB2.' }),
    'verified.DB2.DB2_TT2_05',
  );
});

test('Line 4 KEPServer fallback namespace remains unchanged', () => {
  assert.equal(
    resolveKepserverTagId('line4', 'TT1001'),
    'S7-1200PLC.MIXING_LINE4.TT1001',
  );
  assert.equal(
    resolveKepserverTagId('line4', 'LMS1001-FREQ'),
    'S7-1200PLC.MIXING_LINE4.LMS1001-FREQ',
  );
});

test('Line 4 motor frequency tag detection and raw-scale conversion', () => {
  const tags = ['LMS1001-FREQ', 'LMS1002-FREQ', 'P1001-FREQ', 'P1002-FREQ'];
  for (const tag of tags) assert.equal(isLine4MotorFrequencyTag(tag), true, tag);
  assert.equal(isLine4MotorFrequencyTag('P1001FLT'), false);

  const valuesHz = [0, 12.5, 25, 37.5, 50];
  const rawBits = valuesHz.map(line4FrequencyToRawValue);
  assert.deepEqual(rawBits, [0, 6867, 13734, 20601, 27468]);
  assert.deepEqual(
    rawBits.map((raw) => applyParameterCalibration('line4', raw, 'P1001-FREQ', null, new Map())),
    valuesHz,
  );
  assert.equal(line4FrequencyToRawValue(-1), 0);
  assert.equal(line4FrequencyToRawValue(51), 27468);
});

test('Line 4 importer parser filters a mixed-line KEPServer export', () => {
  const content = [
    'Server Tag,Scan Rate,Data Type,Deadband,Send Every Scan,Enabled,Use Scan Rate,',
    '"S7-1200PLC.MIXING LINE3.PBV 1-01",1000,Boolean,0,0,1,1',
    '"S7-1200PLC.MIXING_LINE4.ES-01",1000,Boolean,0,0,1,1',
    '"S7-1200PLC.MIXING_LINE4.LMS1001-FREQ",1000,Word,0,0,1,1',
    '"S7-1200PLC.MIXING_LINE4.P1002-FREQ",1000,Word,0,0,1,1',
    '"S7-1200PLC.MIXING_LINE4.LMS1001FLT",1000,Boolean,0,0,1,1',
    '"S7-1200PLC.MIXING_LINE4.PDV1045",1000,Boolean,0,0,1,1',
  ].join('\n');
  const tags = parseLine4RestExport(content);
  const ids = tags.map((tag) => tag.kepserverTag);

  assert.ok(tags.length > 0);
  assert.ok(ids.every((id) => id.startsWith('S7-1200PLC.MIXING_LINE4.')));
  assert.ok(ids.includes('S7-1200PLC.MIXING_LINE4.ES-01'));
  assert.ok(ids.includes('S7-1200PLC.MIXING_LINE4.PDV1045'));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(tags.find((tag) => tag.tag === 'LMS1001-FREQ')?.dataType, 'SMALLINT');
  assert.equal(tags.find((tag) => tag.tag === 'P1002-FREQ')?.dataType, 'SMALLINT');
});

test('Current mixed-line export and Line 4 tank mimics include both KepServer valves', async (t) => {
  const exportPath = 'REST_MIXING_L3 dan L4.csv';
  try {
    await access(exportPath);
  } catch {
    t.skip('Current mixed-line KEPServer export is not present in the workspace');
    return;
  }

  const tags = parseLine4RestExport(await readFile(exportPath, 'utf8'));
  const byTag = new Map(tags.map((tag) => [tag.tag, tag]));
  assert.equal(byTag.get('PDV9001')?.kepserverTag, 'S7-1200PLC.MIXING_LINE4.PDV9001');
  assert.equal(byTag.get('PDV9001')?.dataType, 'BOOLEAN');
  assert.equal(byTag.get('PDV1044')?.kepserverTag, 'S7-1200PLC.MIXING_LINE4.PDV1044');
  assert.equal(byTag.get('PDV1044')?.dataType, 'BOOLEAN');

  const tk1001 = SCREENS.find((screen) => screen.id === 'tk1001')?.config;
  const tk1002 = SCREENS.find((screen) => screen.id === 'tk1002')?.config;
  assert.ok(tk1001?.valves.some((valve) => valve.tag === 'PDV9001'));
  assert.ok(tk1002?.valves.some((valve) => valve.tag === 'PDV1044'));
});

test('Line 4 motor faults import as alarms and motor frequencies are classified as analog', () => {
  for (const tag of ['LMS1001FLT', 'LMS1002FLT', 'P1001FLT', 'P1002FLT']) {
    const type = line4ParameterTypeFor(tag, 'BOOLEAN');
    assert.equal(type, 'alarm_status', tag);
    assert.equal(isBoolean('BOOLEAN', type), true, tag);
    assert.equal(boolRole(tag, type), 'fault', tag);
  }
  for (const tag of ['LMS1001-FREQ', 'LMS1002-FREQ', 'P1001-FREQ', 'P1002-FREQ']) {
    assert.equal(line4ParameterTypeFor(tag, 'SMALLINT'), 'frequency', tag);
  }
});

test('Line 4 digital twin screens include both conductivity sensors', () => {
  const filterLine = SCREENS.find((screen) => screen.id === 'filterLine')?.config;
  const fillingRoom = SCREENS.find((screen) => screen.id === 'filling')?.config;

  assert.ok(filterLine?.instruments.some((instrument) => instrument.tag === 'CT1003'));
  assert.ok(fillingRoom?.instruments.some((instrument) => instrument.tag === 'CT1004'));
});

test('KepServer quality parser rejects bad quality and accepts good results', () => {
  assert.equal(hasGoodKepQuality({ s: false, r: 'Tag quality is bad.' }), false);
  assert.equal(hasGoodKepQuality({ s: true }), true);
  assert.equal(hasGoodKepQuality({ s: 'Good' }), true);
  assert.equal(hasGoodKepQuality({ r: 0 }), true);
});

test('KepServer readings retain cached non-empty values with bad quality and count empty tags as failed', () => {
  const result = parseKepReadResults(
    ['cached', 'empty', 'missing'],
    [
      { id: 'cached', s: false, r: 'Tag quality is bad.', v: 42, t: 1_793_091_087_118 },
      { id: 'empty', s: false, r: 'Tag quality is bad.', v: '', t: 1_793_091_087_118 },
    ],
    (value) => Number(value),
  );

  assert.deepEqual(result.readings, [{
    id: 'cached',
    value: 42,
    quality: false,
    timestamp: 1_793_091_087_118,
    reason: 'Tag quality is bad.',
  }]);
  assert.equal(result.failed, 2);
});

test('parameter calibration uses the two HMI and KepServer points rounded to the requested precision', () => {
  const calibration = calculateParameterCalibration(85.9, 11867, 84, 11625);
  assert.deepEqual(calibration, { slope: 0.0078512, intercept: -7.2707 });
});

test('Line 4 sensor scales convert each specified tag from raw bits to engineering units', () => {
  const rawValues = [0, 6912, 13824, 20736, 27648];
  const groups = [
    {
      tags: [
        'TT1001', 'TT1002', 'TT1003', 'TT1004', 'TT1005', 'TT1006', 'TT1007', 'TT1008', 'TT1009',
        'TT1010', 'TT1011', 'TT1012', 'TT1013',
      ],
      expected: [0, 50, 100, 150, 200],
    },
    { tags: ['PT1001', 'PT1002', 'PT1003'], expected: [-1, 0.5, 2, 3.5, 5] },
    { tags: ['CT1001', 'CT1002', 'CT1003', 'CT1004'], expected: [0, 12.5, 25, 37.5, 50] },
  ];

  for (const group of groups) {
    for (const tag of group.tags) {
      const results = rawValues.map((rawValue) =>
        applyParameterCalibration('line4', rawValue, tag, null, new Map()),
      );
      assert.deepEqual(results, group.expected, tag);
    }
  }

  for (const tag of ['WM1001', 'WM1002']) {
    const results = rawValues.map((rawValue) =>
      applyParameterCalibration('line4', rawValue, tag, null, new Map()),
    );
    assert.deepEqual(results, [-22, 2978, 5978, 8978, 11978], tag);
  }
});

test('Line 4 motor frequencies scale 0-27468 raw bits to 0-50 Hz', () => {
  const tags = ['LMS1001-FREQ', 'LMS1002-FREQ', 'P1001-FREQ', 'P1002-FREQ'];
  for (const tag of tags) {
    const values = [0, 6867, 13734, 20601, 27468].map((rawValue) =>
      applyParameterCalibration('line4', rawValue, tag, 'frequency', new Map()),
    );
    assert.deepEqual(values, [0, 12.5, 25, 37.5, 50], tag);
    assert.equal(applyParameterCalibration('line3', 27468, tag, 'frequency', new Map()), 27468);
  }
});

test('Line 4 configured sensor scales override CSV calibration while Line 3 stays raw', () => {
  const calibrations: ParameterCalibrations = new Map([
    ['PT1001', new Map([['pressure', { slope: 0.0002157, intercept: -0.9916 }]])],
    ['PT1004', new Map([['pressure', { slope: 0.0002157, intercept: -0.9916 }]])],
    ['TT1010', new Map([['temperature', { slope: 0.0058824, intercept: 4.7706 }]])],
    ['CT1001', new Map([['conductivity', { slope: 0.01, intercept: 1 }]])],
  ]);
  assert.equal(applyParameterCalibration('line4', 13824, 'PT1001', 'pressure', calibrations), 2);
  assert.equal(applyParameterCalibration('line4', 13824, 'TT1010', 'temperature', calibrations), 100);
  assert.equal(applyParameterCalibration('line4', 13824, 'CT1001', 'conductivity', calibrations), 25);
  assert.equal(applyParameterCalibration('line4', 23, 'PT1004', 'pressure', calibrations), -0.9866389);
  assert.equal(applyParameterCalibration('line4', -3, 'NO-CALIBRATION', 'temperature', calibrations), -3);
  assert.equal(applyParameterCalibration('line3', 13918, 'PT1001', 'pressure', calibrations), 13918);
  assert.equal(applyParameterCalibration('line2', 13918, 'PT1001', 'pressure', calibrations), 13918);
});

test('Line 4 tank mimic displays each tank weight from its assigned KepServer tag', () => {
  const tk1001 = SCREENS.find((screen) => screen.id === 'tk1001')?.config;
  const tk1002 = SCREENS.find((screen) => screen.id === 'tk1002')?.config;

  assert.equal(tk1001?.instruments.find((instrument) => instrument.unit.toUpperCase() === 'KG')?.tag, 'WM1001');
  assert.equal(tk1002?.instruments.find((instrument) => instrument.unit.toUpperCase() === 'KG')?.tag, 'WM1002');
});

test('Line 4 digital twin shows one frequency value at each tank and pump without setpoints', () => {
  for (const [screenId, expectedTags] of [
    ['tk1001', ['LMS1001-FREQ', 'P1001-FREQ']],
    ['tk1002', ['LMS1002-FREQ', 'P1002-FREQ']],
  ] as const) {
    const config = SCREENS.find((screen) => screen.id === screenId)?.config;
    assert.ok(config, screenId);
    const expectedTagSet: ReadonlySet<string> = new Set(expectedTags);
    const motors = config?.instruments.filter((instrument) => expectedTagSet.has(instrument.tag));
    const tankFrequency = motors?.find((instrument) => instrument.tag.startsWith('LMS'));
    const pumpFrequency = motors?.find((instrument) => instrument.tag.startsWith('P'));
    const tank = config.tanks[0];
    const pump = config.pumps?.[0];

    assert.equal(motors?.length, 2, screenId);
    assert.ok(motors?.every((instrument) => instrument.setTag === undefined), screenId);
    assert.ok(tankFrequency?.pos, screenId);
    assert.ok(pumpFrequency?.pos, screenId);
    assert.ok(tankFrequency.pos.x >= tank.x && tankFrequency.pos.x + 70 <= tank.x + tank.w, screenId);
    assert.ok(tankFrequency.pos.y >= tank.y && tankFrequency.pos.y + 24 <= tank.y + tank.h, screenId);
    assert.ok(pump && pumpFrequency.pos.x >= tank.x + tank.w, screenId);
    assert.ok(
      pumpFrequency.pos.x <= pump.x + 48 &&
        pumpFrequency.pos.x + 70 > pump.x + 16 &&
        pumpFrequency.pos.y + 24 < pump.y,
      screenId,
    );
  }
});

test('Line 4 pressure display preserves negative values without changing other line formats', () => {
  assert.equal(formatEngineeringParameterValue(-1, 'pressure', 'line4'), '-1,00');
  assert.equal(formatEngineeringParameterValue(-1, 'pressure', 'line3'), '-1,00');
  assert.equal(formatEngineeringParameterValue(-1, 'weight', 'line4'), '0,0');
});

test('CSV calibrations distinguish duplicate tags by parameter type and skip incomplete points', async (t) => {
  try {
    await Promise.all([
      access('Data Monitoring Mixing - PAGE 1 LINE 4 (1).csv'),
      access('Data Monitoring Mixing - PAGE 2 LINE 4 (1).csv'),
      access('Data Monitoring Mixing - PAGE 3 LINE 4 (1).csv'),
      access('Data Monitoring Mixing - PAGE 4 LINE 4 (1).csv'),
    ]);
  } catch {
    t.skip('Line 4 calibration CSV fixtures are not present in the workspace');
    return;
  }
  const calibrations = await loadParameterCalibrations();

  assert.deepEqual(calibrations.get('TT1001')?.get('temperature'), {
    slope: 0.0078512,
    intercept: -7.2707,
  });
  assert.deepEqual(calibrations.get('WM1001')?.get('weight'), {
    slope: -0.2962215,
    intercept: 18922.0829,
  });
  assert.deepEqual(calibrations.get('TT1004')?.get('temperature'), {
    slope: 0.0117647,
    intercept: -17.5118,
  });
  assert.deepEqual(calibrations.get('TT1010')?.get('temperature'), {
    slope: 0.0058824,
    intercept: 4.7706,
  });
  assert.equal(
    applyParameterCalibration('line4', 3541, 'TT1010', 'temperature', calibrations),
    (3541 / 27648) * 200,
  );
  assert.deepEqual(calibrations.get('TT1004')?.get('conductivity'), {
    slope: 0.0041667,
    intercept: 11.8292,
  });
  assert.deepEqual(calibrations.get('TT1012')?.get('temperature'), {
    slope: 0.0072228,
    intercept: 0,
  });
  assert.deepEqual(calibrations.get('PT1003')?.get('pressure'), {
    slope: 0,
    intercept: 0,
  });
  assert.equal(calibrations.get('P1001'), undefined);
});

test('parameter display uses the correct engineering unit and a fixed precision', () => {
  assert.equal(TYPE_UNIT.temperature, '°C');
  assert.equal(TYPE_UNIT.pressure, 'bar');
  assert.equal(TYPE_UNIT.weight, 'kg');
  assert.equal(TYPE_UNIT.conductivity, 'µS/cm');
  assert.equal(formatParameterValue(23.456, 'pressure'), '23,46');
  assert.equal(formatParameterValue(23.456, 'temperature'), '23,5');
  assert.equal(formatParameterValue(-3, 'weight'), '0,0');
});

test('Line 3 raw display preserves the received numeric value', () => {
  assert.equal(formatRawParameterValue(25.56, 'temperature'), '25,6');
  assert.equal(formatRawParameterValue(-3.125, 'pressure'), '-3,13');
});

test(
  'KepServer and the monitoring API provide healthy live readings',
  { skip: process.env.KEPSERVER_INTEGRATION_TESTS !== '1' },
  async () => {
    loadEnvConfig(process.cwd());
    const appUrl = (process.env.APP_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const response = await fetch(`${appUrl}/api/kepserver/status`);
    assert.equal(response.status, 200);

    const status = await response.json() as {
      ok: boolean;
      gateway: {
        reachable: boolean;
        readTest: { tagId: string; success: boolean; quality: unknown; error: string | null } | null;
        valveReadTests: { tagId: string; success: boolean; quality: unknown; error: string | null }[] | null;
      };
      database: { connected: boolean; totalTags: number };
    };
    assert.equal(status.gateway.reachable, true);
    assert.equal(status.database.connected, true);
    assert.ok(status.database.totalTags > 0);
    assert.deepEqual(
      status.gateway.valveReadTests?.map((test) => test.tagId),
      ['S7-1200PLC.MIXING_LINE4.PDV9001', 'S7-1200PLC.MIXING_LINE4.PDV1044'],
    );
    for (const test of status.gateway.valveReadTests ?? []) {
      assert.equal(test.success, true, `${test.tagId} quality=${test.quality}: ${test.error ?? 'read failed'}`);
    }
    assert.equal(
      status.gateway.readTest?.success,
      true,
      `${status.gateway.readTest?.tagId} quality=${status.gateway.readTest?.quality}: ` +
        (status.gateway.readTest?.error ?? 'Gateway tag read failed.'),
    );
    assert.equal(status.ok, true);
  },
);
