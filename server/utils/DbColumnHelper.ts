import { isPgsql } from '@server/utils/dbType';
import type { ColumnOptions, ColumnType } from 'typeorm';
import { Column } from 'typeorm';
const pgTypeMapping: { [key: string]: ColumnType } = {
  datetime: 'timestamp with time zone',
};

/**
 * Types that Postgres needs spelled differently, and SQLite cannot represent at all.
 *
 * `bigint` is only needed for permission bitmasks that exceed int4 range. SQLite has
 * no bigint type, but its INTEGER affinity is already 64-bit, so integers are the
 * correct fallback there.
 */
const sqliteFallbackMapping: { [key: string]: ColumnType } = {
  bigint: 'integer',
};

export function resolveDbType(pgType: ColumnType): ColumnType {
  if (!isPgsql) {
    return sqliteFallbackMapping[pgType.toString()] ?? pgType;
  }
  if (pgType.toString() in pgTypeMapping) {
    return pgTypeMapping[pgType.toString()];
  }
  return pgType;
}

export function DbAwareColumn(columnOptions: ColumnOptions) {
  if (columnOptions.type) {
    columnOptions.type = resolveDbType(columnOptions.type);
  }
  return Column(columnOptions);
}
