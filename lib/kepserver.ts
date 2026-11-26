const DEFAULT_TAG_PREFIXES: Readonly<Record<string, string>> = {
  line3: 'S7-1200PLC.MIXING LINE3.',
  line3db: 'S7-1200PLC.MIXING_LINE3DB.',
  line4: 'S7-1200PLC.MIXING_LINE4.',
};

export function resolveKepserverTagId(
  lineCode: string,
  tag: string,
  prefixOverrides: Readonly<Record<string, string | undefined>> = {},
): string {
  const line = lineCode.toLowerCase();
  const prefixKey = line === 'line3' && /^DB2_/i.test(tag) ? 'line3db' : line;
  const prefix = prefixOverrides[prefixKey] ?? DEFAULT_TAG_PREFIXES[prefixKey] ?? '';
  return `${prefix}${tag}`;
}

export type Line4RestTag = {
  kepserverTag: string;
  tag: string;
  dataType: 'BOOLEAN' | 'SMALLINT';
};

export function isLine4MotorFrequencyTag(tag: string): boolean {
  return /^(?:LMS1001|LMS1002|P1001|P1002)-FREQ$/i.test(tag);
}

export function line4ParameterTypeFor(tag: string, dataType: Line4RestTag['dataType']): string {
  if (dataType === 'BOOLEAN') {
    if (/^(BZL|BLZ)/i.test(tag)) return 'alarm_status';
    if (/^ES/i.test(tag)) return 'safety_status';
    if (/^(?:LMS1001|LMS1002|P1001|P1002)FLT$/i.test(tag)) return 'alarm_status';
    return 'digital_status';
  }
  if (/^TT/i.test(tag)) return 'temperature';
  if (/^PT/i.test(tag)) return 'pressure';
  if (/^WM/i.test(tag)) return 'weight';
  if (/^CT/i.test(tag)) return 'conductivity';
  if (isLine4MotorFrequencyTag(tag) || (/^(P|LMS|LMX)\d/i.test(tag) && /FREQ/i.test(tag))) return 'frequency';
  return 'analog_generic';
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

  if (quoted) throw new Error('KEPServer export contains an unclosed quoted field.');
  fields.push(field);
  return fields;
}

export function parseLine4RestExport(content: string): Line4RestTag[] {
  const prefix = DEFAULT_TAG_PREFIXES.line4;
  const records = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  const headerIndex = records.findIndex((line) => line.startsWith('Server Tag,'));
  if (headerIndex < 0) throw new Error('KEPServer export is missing the "Server Tag" header.');

  const headers = parseCsvRecord(records[headerIndex]);
  const tagColumn = headers.indexOf('Server Tag');
  const typeColumn = headers.indexOf('Data Type');
  const enabledColumn = headers.indexOf('Enabled');
  if (tagColumn < 0 || typeColumn < 0 || enabledColumn < 0) {
    throw new Error('KEPServer export must contain Server Tag, Data Type, and Enabled columns.');
  }

  const tags: Line4RestTag[] = [];
  for (const line of records.slice(headerIndex + 1)) {
    if (line.startsWith(';')) continue;
    const fields = parseCsvRecord(line);
    if (fields.length <= Math.max(tagColumn, typeColumn, enabledColumn)) continue;
    if (fields[enabledColumn] !== '1') continue;

    const kepserverTag = fields[tagColumn].trim();
    if (!kepserverTag.startsWith(prefix)) continue;

    const tag = kepserverTag.slice(prefix.length);
    const exportedType = fields[typeColumn].trim().toLowerCase();
    if (!tag || !['boolean', 'short', 'word'].includes(exportedType)) {
      throw new Error(`Unsupported Line 4 tag or data type: ${kepserverTag} (${fields[typeColumn]})`);
    }
    tags.push({ kepserverTag, tag, dataType: exportedType === 'boolean' ? 'BOOLEAN' : 'SMALLINT' });
  }

  if (tags.length === 0) throw new Error('KEPServer export does not contain enabled Line 4 tags.');
  if (new Set(tags.map((tag) => tag.kepserverTag)).size !== tags.length) {
    throw new Error('KEPServer export contains duplicate Line 4 Server Tag values.');
  }
  if (new Set(tags.map((tag) => tag.tag)).size !== tags.length) {
    throw new Error('KEPServer export contains duplicate Line 4 tag names.');
  }
  return tags;
}

export function createKepReadUrl(gatewayUrl: string, ids: readonly string[]): URL {
  const gatewayBase = gatewayUrl.endsWith('/') ? gatewayUrl : `${gatewayUrl}/`;
  const url = new URL('read', gatewayBase);
  for (const id of ids) {
    url.searchParams.append('ids', id);
  }
  return url;
}

export function hasGoodKepQuality(result: { s?: unknown; r?: unknown }): boolean {
  if (typeof result.s === 'boolean') return result.s;
  if (typeof result.s === 'string') return result.s.toLowerCase() === 'good';
  if (typeof result.r === 'number') return result.r === 0;
  return false;
}

export type KepReadResult = {
  id?: unknown;
  s?: unknown;
  r?: unknown;
  v?: unknown;
  t?: unknown;
};

export type KepReading = {
  id: string;
  value: unknown;
  quality: boolean;
  timestamp: number;
  reason: string | null;
};

export function parseKepReadResults(
  requestedIds: readonly string[],
  results: readonly unknown[],
  timestampFor: (value: unknown) => number,
): { readings: KepReading[]; failed: number } {
  const requested = new Set(requestedIds);
  const received = new Map<string, KepReadResult>();

  for (const raw of results) {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      Array.isArray(raw) ||
      typeof (raw as KepReadResult).id !== 'string'
    ) {
      continue;
    }
    const result = raw as KepReadResult;
    if (requested.has(result.id as string)) received.set(result.id as string, result);
  }

  const readings: KepReading[] = [];
  let failed = 0;
  for (const id of requested) {
    const result = received.get(id);
    if (
      !result ||
      result.v === null ||
      result.v === undefined ||
      (typeof result.v === 'string' && result.v.trim() === '')
    ) {
      failed += 1;
      continue;
    }
    readings.push({
      id,
      value: result.v,
      quality: hasGoodKepQuality(result),
      timestamp: timestampFor(result.t),
      reason: typeof result.r === 'string' ? result.r : null,
    });
  }
  return { readings, failed };
}
