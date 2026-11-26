import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { line4ParameterTypeFor, parseLine4RestExport } from '../lib/kepserver';

const CSV_PATHS = [
  join(process.cwd(), 'REST_MIXING_L3 dan L4.csv'),
  join(process.cwd(), 'REST_MIXING_L4.csv'),
  join(process.cwd(), 'REST_MIXING_L3 dan 4.csv'),
];
const SERVER_TAG_PREFIX = 'S7-1200PLC.MIXING_LINE4.';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type ExistingTag = {
  id: string;
  tag: string;
  name: string;
  kepserver_tag: string;
  kind: 'parameter' | 'valve';
  data_type: string | null;
  parameter_type: string | null;
  is_active: boolean;
};

async function loadExportedTags() {
  for (const path of CSV_PATHS) {
    try {
      return parseLine4RestExport(await readFile(path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`No Line 4 KEPServer export found. Checked: ${CSV_PATHS.join(', ')}`);
}

async function getExistingTags(client: PoolClient, machineId: string): Promise<ExistingTag[]> {
  const result = await client.query<ExistingTag>(
    `SELECT id::text AS id, tag, name, kepserver_tag, 'parameter' AS kind,
            data_type, parameter_type, is_active
       FROM parameters WHERE machine_id = $1
     UNION ALL
     SELECT id::text AS id, tag, name, kepserver_tag, 'valve' AS kind,
            NULL::text AS data_type, NULL::text AS parameter_type, is_active
       FROM valves WHERE machine_id = $1`,
    [machineId],
  );
  return result.rows;
}

async function main() {
  const tags = await loadExportedTags();
  const client = await pool.connect();
  let inserted = 0;
  let corrected = 0;
  let deactivated = 0;

  try {
    await client.query('BEGIN');
    const machine = await client.query<{ id: string }>(
      `SELECT id FROM machines
        WHERE lower(line_code) = 'line4' AND lower(code) = 'mixingl4' AND is_active`,
    );
    if (machine.rowCount !== 1) {
      throw new Error(`Expected one active Line 4 / mixingL4 machine; found ${machine.rowCount ?? 0}.`);
    }
    const machineId = machine.rows[0].id;

    const existing = await getExistingTags(client, machineId);
    const matched = new Set<string>();

    for (const tag of tags) {
      const legacyName = tag.tag === 'BZL-02' ? 'BLZ-02' : null;
      const candidates = existing.filter((entry) =>
        entry.kepserver_tag === tag.kepserverTag ||
        entry.tag === tag.tag ||
        (legacyName !== null &&
          (entry.tag === legacyName ||
            entry.kepserver_tag === legacyName ||
            entry.kepserver_tag === `${SERVER_TAG_PREFIX}${legacyName}`)),
      );
      if (candidates.length > 1) {
        throw new Error(`Multiple existing database tags match ${tag.tag}; resolve the duplicate before importing.`);
      }

      const expectedKind =
        tag.dataType === 'BOOLEAN' && /^(PAV|PCV|PDV|PEV)/i.test(tag.tag) ? 'valve' : 'parameter';
      const current = candidates[0];
      if (current) {
        if (current.kind !== expectedKind) {
          throw new Error(
            `Existing ${tag.tag} is stored as a ${current.kind}, but the CSV requires a ${expectedKind}.`,
          );
        }

        matched.add(`${current.kind}:${current.id}`);
        const needsUpdate =
          current.tag !== tag.tag ||
          current.name !== tag.tag ||
          current.kepserver_tag !== tag.kepserverTag ||
          !current.is_active ||
          (current.kind === 'parameter' &&
            (current.data_type?.toUpperCase() !== tag.dataType ||
              current.parameter_type !== line4ParameterTypeFor(tag.tag, tag.dataType)));
        if (!needsUpdate) continue;

        if (current.kind === 'parameter') {
          await client.query(
            `UPDATE parameters
                SET tag = $1, name = $1, parameter_type = $2, data_type = $3,
                    kepserver_tag = $4, is_active = TRUE, updated_at = now()
              WHERE id = $5 AND machine_id = $6`,
            [
              tag.tag,
              line4ParameterTypeFor(tag.tag, tag.dataType),
              tag.dataType,
              tag.kepserverTag,
              current.id,
              machineId,
            ],
          );
        } else {
          await client.query(
            `UPDATE valves
                SET tag = $1, name = $1, kepserver_tag = $2,
                    is_active = TRUE, updated_at = now()
              WHERE id = $3 AND machine_id = $4`,
            [tag.tag, tag.kepserverTag, current.id, machineId],
          );
        }
        corrected += 1;
        continue;
      }

      if (expectedKind === 'valve') {
        await client.query(
          `INSERT INTO valves (machine_id, tag, name, kepserver_tag, description, is_active)
           VALUES ($1, $2, $2, $3, $4, TRUE)`,
          [machineId, tag.tag, tag.kepserverTag, 'Imported from KEPServerEX REST tag export.'],
        );
      } else {
        await client.query(
          `INSERT INTO parameters
             (machine_id, tag, name, parameter_type, data_type, kepserver_tag, description, is_active)
           VALUES ($1, $2, $2, $3, $4, $5, $6, TRUE)`,
          [
            machineId,
            tag.tag,
            line4ParameterTypeFor(tag.tag, tag.dataType),
            tag.dataType,
            tag.kepserverTag,
            'Imported from KEPServerEX REST tag export.',
          ],
        );
      }
      inserted += 1;
    }

    const expectedNames = new Set(tags.map((tag) => tag.tag));
    for (const entry of existing) {
      if (matched.has(`${entry.kind}:${entry.id}`) || !entry.is_active) continue;
      if (expectedNames.has(entry.tag)) {
        throw new Error(`An active duplicate database tag blocks reconciliation: ${entry.tag}.`);
      }

      if (entry.kind === 'parameter') {
        await client.query(
          `UPDATE parameters SET is_active = FALSE, updated_at = now()
            WHERE id = $1 AND machine_id = $2`,
          [entry.id, machineId],
        );
      } else {
        await client.query(
          `UPDATE valves SET is_active = FALSE, updated_at = now()
            WHERE id = $1 AND machine_id = $2`,
          [entry.id, machineId],
        );
      }
      deactivated += 1;
    }

    await client.query('COMMIT');
    console.log(
      `Line 4 tag reconciliation complete: ${tags.length} CSV tags checked, ${inserted} inserted, ` +
        `${corrected} corrected, ${deactivated} obsolete tags deactivated.`,
    );
    console.log('Historical readings are retained; database tags not enabled in the CSV are not deleted.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('[FATAL] Tag import failed:', error);
  process.exitCode = 1;
});
