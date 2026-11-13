import { is, getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as schema from '../src/schema';
import { withDisposableDatabase } from '../test/helpers/disposable-database';
import { readColumns, type CatalogColumn } from '../test/helpers/schema-catalog';

function builder(column: CatalogColumn): string {
  const name = JSON.stringify(column.name);
  const types: Record<string, string> = {
    uuid: `uuid(${name})`, text: `text(${name})`, boolean: `boolean(${name})`,
    integer: `integer(${name})`, bigint: `bigint(${name}, { mode: 'bigint' })`,
    date: `date(${name})`, inet: `inet(${name})`, jsonb: `jsonb(${name})`,
    citext: `citext(${name})`, 'text[]': `text(${name}).array()`,
    'timestamp with time zone': `timestamp(${name}, { withTimezone: true })`,
    'numeric(5,2)': `numeric(${name}, { precision: 5, scale: 2 })`,
  };
  let result = types[column.type];
  if (!result || column.generated) throw new Error(`UNSUPPORTED_ORM_COLUMN: ${column.table_name}.${column.name}`);
  if (column.not_null) result += '.notNull()';
  if (column.primary_key) result += '.primaryKey()';
  if (column.default_sql !== null) result += `.default(sql.raw(${JSON.stringify(column.default_sql)}))`;
  return result;
}

async function main() {
  if (process.argv.length !== 3 || !['--write', '--check'].includes(process.argv[2])) {
    throw new Error('Usage: node --import tsx packages/db/scripts/generate-orm.ts --check|--write');
  }
  // Only a newly created disposable database is inspected. No deployed connection
  // can silently redefine the contract or receive schema push/DDL from Drizzle.
  await withDisposableDatabase(async ({ admin }) => {
    const columns = await readColumns(admin);
    let output = `/**
 * Column projections of the append-only PostgreSQL migrations.
 * Regenerate with: node --import tsx packages/db/scripts/generate-orm.ts --write
 * SQL owns constraint/index/trigger/RLS/ACL DDL; single-column PK metadata is mirrored.
 * Do not use schema push or
 * migration generation from these projections. See docs/engineering/phase1-orm-contract.md.
 */
import { pgTable, uuid, text, integer, bigint, boolean, date, timestamp, jsonb, inet, numeric, customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const citext = customType<{ data: string; driverData: string }>({ dataType: () => 'citext' });
`;
    for (const [exportName, table] of Object.entries(schema).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
      if (!is(table, PgTable)) throw new Error(`UNEXPECTED_SCHEMA_EXPORT: ${exportName}`);
      const name = getTableConfig(table).name;
      const fields = columns.filter(column => column.table_name === name);
      if (!fields.length) throw new Error(`ORM_TABLE_ABSENT: ${name}`);
      if (fields.filter(column => column.primary_key).length !== 1) {
        throw new Error(`UNSUPPORTED_ORM_PRIMARY_KEY: ${name}`);
      }
      const oldNames = new Map(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
      const keys = new Set<string>();
      output += `\nexport const ${exportName} = pgTable(${JSON.stringify(name)}, {\n`;
      for (const column of fields) {
        const key = oldNames.get(column.name) ?? column.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        if (keys.has(key)) throw new Error(`DUPLICATE_ORM_PROPERTY: ${name}.${key}`);
        keys.add(key);
        output += `  ${key}: ${builder(column)},\n`;
      }
      output += '});\n';
    }
    const target = path.resolve(__dirname, '../src/schema.ts');
    if (process.argv[2] === '--write') await writeFile(target, output);
    else if (await readFile(target, 'utf8') !== output) throw new Error('ORM_GENERATED_SOURCE_DRIFT');
    console.log(`ORM projections ${process.argv[2] === '--write' ? 'generated' : 'verified'} against disposable migrated PostgreSQL.`);
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
