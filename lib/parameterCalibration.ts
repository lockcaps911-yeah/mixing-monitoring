
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CALIBRATION_FILES = [
  'Data Monitoring Mixing - PAGE 1 LINE 4 (1).csv',
  'Data Monitoring Mixing - PAGE 2 LINE 4 (1).csv',
  'Data Monitoring Mixing - PAGE 3 LINE 4 (1).csv',
  'Data Monitoring Mixing - PAGE 4 LINE 4 (1).csv',
];

export type ParameterCalibration = {
  slope: number;
  intercept: number;
};

export type ParameterCalibrations = Map<
  string,
  Map<string, ParameterCalibration>
>;

type EngineeringScale = {
  lowValue: number;
  highValue: number;
  rawHighValue?: number;
};

const LINE4_FREQUENCY_RAW_MAX = 27468;
const LINE4_FREQUENCY_HZ_MAX = 50;

// Koreksi nilai khusus untuk tag WM Line 4.
const LINE4_TAG_OFFSETS = new Map<string, number>([
  ['WM1001', 22],
  ['WM1002', 22],
]);

const LINE4_SENSOR_SCALE_GROUPS: readonly {
  tags: readonly string[];
  lowValue: number;
  highValue: number;
  rawHighValue?: number;
}[] = [
  { tags: ['WM1001', 'WM1002'], lowValue: 0, highValue: 12000 },
  {
    tags: [
      'TT1001', 'TT1002', 'TT1003', 'TT1004',
      'TT1005', 'TT1006', 'TT1007', 'TT1008',
      'TT1009', 'TT1010', 'TT1011', 'TT1012',
      'TT1013',
    ],
    lowValue: 0,
    highValue: 200,
  },
  {
    tags: ['PT1001', 'PT1002', 'PT1003'],
    lowValue: -1,
    highValue: 5,
  },
  {
    tags: ['CT1001', 'CT1002', 'CT1003', 'CT1004'],
    lowValue: 0,
    highValue: 50,
  },
  {
    tags: [
      'LMS1001-FREQ',
      'LMS1002-FREQ',
      'P1001-FREQ',
      'P1002-FREQ',
    ],
    lowValue: 0,
    highValue: LINE4_FREQUENCY_HZ_MAX,
    rawHighValue: LINE4_FREQUENCY_RAW_MAX,
  },
];

const LINE4_SENSOR_SCALES = new Map<string, EngineeringScale>(
  LINE4_SENSOR_SCALE_GROUPS.flatMap(
    ({ tags, lowValue, highValue, rawHighValue }) =>
      tags.map(
        (tag): [string, EngineeringScale] => [
          tag,
          { lowValue, highValue, rawHighValue },
        ],
      ),
  ),
);

export function calculateParameterCalibration(
  value1Hmi: number,
  value1KepServer: number,
  value2Hmi: number,
  value2KepServer: number,
): ParameterCalibration | null {
  const points = [
    value1Hmi,
    value1KepServer,
    value2Hmi,
    value2KepServer,
  ];

  if (
    !points.every(Number.isFinite) ||
    value2KepServer === value1KepServer
  ) {
    return null;
  }

  const exactSlope =
    (value2Hmi - value1Hmi) /
    (value2KepServer - value1KepServer);

  const exactIntercept =
    value1Hmi - exactSlope * value1KepServer;

  const slope = Number(exactSlope.toFixed(7));
  const intercept = Number(exactIntercept.toFixed(4));

  return Number.isFinite(slope) && Number.isFinite(intercept)
    ? { slope, intercept }
    : null;
}

export function line4FrequencyToRawValue(valueHz: number): number {
  if (!Number.isFinite(valueHz)) {
    throw new Error('Line 4 frequency must be a finite number.');
  }

  const clampedHz = Math.max(
    0,
    Math.min(LINE4_FREQUENCY_HZ_MAX, valueHz),
  );

  return Math.round(
    (clampedHz / LINE4_FREQUENCY_HZ_MAX) *
      LINE4_FREQUENCY_RAW_MAX,
  );
}

function normalizeParameterType(value: string): string {
  const type = value.trim().toLowerCase();

  if (
    type.startsWith('temperatur') ||
    type === 'temperature'
  ) {
    return 'temperature';
  }

  if (
    type.startsWith('tekanan') ||
    type === 'pressure'
  ) {
    return 'pressure';
  }

  if (
    type.startsWith('berat') ||
    type.startsWith('massa') ||
    type === 'weight'
  ) {
    return 'weight';
  }

  if (
    type.startsWith('konduktivitas') ||
    type === 'conductivity'
  ) {
    return 'conductivity';
  }

  return type;
}

function parseCsvRecord(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }

  if (quoted) {
    throw new Error(
      'Calibration CSV contains an unclosed quoted field.',
    );
  }

  fields.push(field);
  return fields;
}

function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(',', '.');

  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const number = Number(normalized);

  return Number.isFinite(number) ? number : null;
}

function parseCalibrationEquation(
  value: string,
): ParameterCalibration | null {
  const match =
    /^\s*y\s*=\s*([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s*x\s*([+-])\s*((?:\d+(?:[.,]\d+)?|[.,]\d+))\s*$/i.exec(
      value,
    );

  if (!match) return null;

  const slope = parseDecimal(match[1]);
  const offsetMagnitude = parseDecimal(match[3]);

  if (slope === null || offsetMagnitude === null) {
    return null;
  }

  return {
    slope: Number(slope.toFixed(7)),
    intercept: Number(
      (
        match[2] === '-'
          ? -offsetMagnitude
          : offsetMagnitude
      ).toFixed(4),
    ),
  };
}

export function applyParameterCalibration(
  lineCode: string,
  rawValue: number,
  tag: string,
  parameterType: string | null,
  calibrations: ParameterCalibrations,
): number {
  // Kalibrasi dan koreksi ini hanya berlaku untuk Line 4.
  if (lineCode.trim().toLowerCase() !== 'line4') {
    return rawValue;
  }

  const normalizedTag = tag.trim().toUpperCase();

  const candidates = calibrations.get(normalizedTag);

  const type = parameterType
    ? normalizeParameterType(parameterType)
    : '';

  const calibration =
    (type ? candidates?.get(type) : undefined) ??
    (candidates?.size === 1
      ? candidates.values().next().value
      : undefined);

  const scale = LINE4_SENSOR_SCALES.get(normalizedTag);

  // 1. Konversi skala sensor tetap menggunakan rumus lama.
  let converted: number;

  if (scale) {
    converted =
      (rawValue / (scale.rawHighValue ?? 27648)) *
        (scale.highValue - scale.lowValue) +
      scale.lowValue;
  } else if (calibration) {
    // 2. Kalibrasi CSV tetap menggunakan rumus lama.
    converted =
      rawValue * calibration.slope +
      calibration.intercept;
  } else {
    // 3. Jika tidak ada skala atau kalibrasi, gunakan nilai asli.
    converted = rawValue;
  }

  if (!Number.isFinite(converted)) {
    throw new Error(
      `Calibration produced an invalid value for ${normalizedTag}.`,
    );
  }

  // 4. Koreksi khusus WM1001 dan WM1002.
  const offset = LINE4_TAG_OFFSETS.get(normalizedTag) ?? 0;

  const finalValue = converted - offset;

  if (!Number.isFinite(finalValue)) {
    throw new Error(
      `Final calibration produced an invalid value for ${normalizedTag}.`,
    );
  }

  return finalValue;
}

let calibrationPromise:
  | Promise<ParameterCalibrations>
  | undefined;

export function loadParameterCalibrations(): Promise<ParameterCalibrations> {
  calibrationPromise ??= (async () => {
    const calibrations: ParameterCalibrations = new Map();
    const ambiguous = new Set<string>();

    let contents: string[];

    try {
      contents = await Promise.all(
        CALIBRATION_FILES.map((file) =>
          readFile(join(process.cwd(), file), 'utf8'),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      console.warn(
        `[calibration] Line 4 calibration CSVs are missing; sensor values will remain raw. Expected: ${CALIBRATION_FILES.join(', ')}`,
      );

      return calibrations;
    }

    for (
      let fileIndex = 0;
      fileIndex < CALIBRATION_FILES.length;
      fileIndex += 1
    ) {
      const file = CALIBRATION_FILES[fileIndex];

      const content = contents[fileIndex].replace(/^\uFEFF/, '');

      const records = content
        .split(/\r?\n/)
        .filter(
          (line) =>
            line.trim() !== '' &&
            !line.startsWith(';'),
        );

      const headerIndex = records.findIndex(
        (line) =>
          parseCsvRecord(line)[0]?.trim() === 'Tag',
      );

      if (headerIndex < 0) {
        throw new Error(
          `Calibration CSV is missing a Tag header: ${file}`,
        );
      }

      for (const line of records.slice(headerIndex + 1)) {
        const fields = parseCsvRecord(line);

        const tag = fields[0]?.trim().toUpperCase();

        const parameterType = fields[1]
          ? normalizeParameterType(fields[1])
          : '';

        if (!tag || !parameterType) continue;

        const points = fields
          .slice(4, 8)
          .map(parseDecimal);

        const calibration =
          points.length === 4 &&
          points.every((point) => point !== null)
            ? calculateParameterCalibration(
                points[0]!,
                points[1]!,
                points[2]!,
                points[3]!,
              )
            : fields
                .slice(8)
                .map(parseCalibrationEquation)
                .find((equation) => equation !== null) ??
              null;

        if (!calibration) continue;

        const key = `${tag}:${parameterType}`;

        if (ambiguous.has(key)) continue;

        const byType =
          calibrations.get(tag) ??
          new Map<string, ParameterCalibration>();

        const existing = byType.get(parameterType);

        if (
          existing &&
          (
            existing.slope !== calibration.slope ||
            existing.intercept !== calibration.intercept
          )
        ) {
          byType.delete(parameterType);
          ambiguous.add(key);

          console.warn(
            `[calibration] Conflicting equations for ${tag} (${parameterType}); raw values will be used.`,
          );
        } else {
          byType.set(parameterType, calibration);
        }

        calibrations.set(tag, byType);
      }
    }

    const equationCount = [
      ...calibrations.values(),
    ].reduce(
      (count, values) => count + values.size,
      0,
    );

    console.info(
      `[calibration] Loaded ${equationCount} parameter equations from ${CALIBRATION_FILES.length} CSV files.`,
    );

    return calibrations;
  })();

  return calibrationPromise;
}
