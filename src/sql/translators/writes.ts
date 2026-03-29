/**
 * SQL Mode 2 — Write Translator
 *
 * INSERT → bulkWrite insertOne
 * UPDATE → bulkWrite updateOne/updateMany
 * DELETE → bulkWrite deleteMany
 */

import { coerceValue } from '../coercion.js';
import { translateWhere } from './select.js';
import type { WriteOperation } from '../types.js';

/**
 * Translate INSERT AST to write operations.
 */
export function translateInsert(ast: Record<string, unknown>): WriteOperation[] {
  const table = extractTableFromInsert(ast);
  const columns = ast['columns'] as string[] | null;
  // node-sql-parser wraps VALUES in { type: 'values', values: [...] }
  const rawValues = ast['values'] as { type?: string; values?: Array<Record<string, unknown>> } | Array<Record<string, unknown>> | undefined;
  const values: Array<Record<string, unknown>> | undefined = Array.isArray(rawValues)
    ? rawValues
    : (rawValues as { values?: Array<Record<string, unknown>> } | undefined)?.values;

  if (!values || values.length === 0) {
    return [];
  }

  // Build all documents
  const docs: Record<string, unknown>[] = [];
  for (const valRow of values) {
    const valueList = valRow['value'] as Array<Record<string, unknown>>;
    const doc: Record<string, unknown> = {};

    if (columns && valueList) {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]!;
        const val = valueList[i];
        if (val) {
          doc[col] = coerceValue(extractInsertValue(val));
        }
      }
    }
    docs.push(doc);
  }

  // Single insertMany for all docs (1 round-trip, not N)
  if (docs.length === 1) {
    return [{
      type: 'insertOne',
      collection: table,
      document: docs[0]!,
    }];
  }
  return [{
    type: 'insertMany',
    collection: table,
    documents: docs,
  }];
}

/**
 * Translate UPDATE AST to write operations.
 */
export function translateUpdate(ast: Record<string, unknown>): WriteOperation[] {
  const table = extractTableFromUpdate(ast);
  const set = ast['set'] as Array<Record<string, unknown>> | undefined;
  const where = ast['where'];

  const filter = where ? translateWhere(where) : {};
  const update: Record<string, unknown> = {};
  const inc: Record<string, unknown> = {};

  if (set) {
    for (const item of set) {
      const column = item['column'] as string;
      const value = item['value'] as Record<string, unknown>;

      // Check for field = field + N (increment)
      if (isIncrementExpr(value, column)) {
        const incValue = extractIncrementValue(value);
        inc[column] = incValue;
      } else {
        update[column] = coerceValue(extractSetValue(value));
      }
    }
  }

  const updateDoc: Record<string, unknown> = {};
  if (Object.keys(update).length > 0) updateDoc['$set'] = update;
  if (Object.keys(inc).length > 0) updateDoc['$inc'] = inc;

  return [{
    type: 'updateMany',
    collection: table,
    filter,
    update: updateDoc,
  }];
}

/**
 * Translate DELETE AST to write operations.
 */
export function translateDelete(ast: Record<string, unknown>): WriteOperation[] {
  const table = extractTableFromDelete(ast);
  const where = ast['where'];
  const filter = where ? translateWhere(where) : {};

  return [{
    type: 'deleteMany',
    collection: table,
    filter,
  }];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractTableFromInsert(ast: Record<string, unknown>): string {
  const table = ast['table'] as Array<Record<string, unknown>> | undefined;
  if (table && table.length > 0) return table[0]!['table'] as string;
  return 'unknown';
}

function extractTableFromUpdate(ast: Record<string, unknown>): string {
  const table = ast['table'] as Array<Record<string, unknown>> | string | undefined;
  if (typeof table === 'string') return table;
  if (Array.isArray(table) && table.length > 0) return table[0]!['table'] as string;
  return 'unknown';
}

function extractTableFromDelete(ast: Record<string, unknown>): string {
  // DELETE uses 'from' for table in some parsers, 'table' in others
  const from = ast['from'] as Array<Record<string, unknown>> | undefined;
  if (from && from.length > 0) return from[0]!['table'] as string;
  const table = ast['table'] as Array<Record<string, unknown>> | string | undefined;
  if (typeof table === 'string') return table;
  if (Array.isArray(table) && table.length > 0) return table[0]!['table'] as string;
  return 'unknown';
}

function extractInsertValue(node: Record<string, unknown>): unknown {
  const type = node['type'] as string;
  if (type === 'number') return node['value'];
  if (type === 'string' || type === 'single_quote_string') return node['value'];
  if (type === 'bool') return node['value'];
  if (type === 'null') return null;
  if (type === 'function') {
    const rawName = node['name'];
    let name: string;
    if (typeof rawName === 'string') {
      name = rawName.toUpperCase();
    } else if (rawName && typeof rawName === 'object' && Array.isArray((rawName as Record<string, unknown>)['name'])) {
      const parts = (rawName as Record<string, unknown>)['name'] as Array<Record<string, unknown>>;
      name = (parts[0]?.['value'] as string ?? '').toUpperCase();
    } else {
      name = '';
    }
    if (name === 'NOW' || name === 'CURRENT_TIMESTAMP') return new Date();
  }
  return node['value'];
}

function extractSetValue(node: Record<string, unknown>): unknown {
  const type = node['type'] as string;
  if (type === 'number') return node['value'];
  if (type === 'string' || type === 'single_quote_string') return node['value'];
  if (type === 'bool') return node['value'];
  if (type === 'null') return null;
  if (type === 'function') {
    // node-sql-parser wraps function name as { name: [{ type: 'default', value: 'NOW' }] }
    const rawName = node['name'];
    let name: string;
    if (typeof rawName === 'string') {
      name = rawName.toUpperCase();
    } else if (rawName && typeof rawName === 'object' && Array.isArray((rawName as Record<string, unknown>)['name'])) {
      const parts = (rawName as Record<string, unknown>)['name'] as Array<Record<string, unknown>>;
      name = (parts[0]?.['value'] as string ?? '').toUpperCase();
    } else {
      name = '';
    }
    if (name === 'NOW' || name === 'CURRENT_TIMESTAMP') return new Date();
  }
  return node['value'];
}

function isIncrementExpr(value: Record<string, unknown>, column: string): boolean {
  if (value['type'] !== 'binary_expr') return false;
  const op = value['operator'] as string;
  if (op !== '+' && op !== '-') return false;

  const left = value['left'] as Record<string, unknown>;
  return left?.['type'] === 'column_ref' && left?.['column'] === column;
}

function extractIncrementValue(value: Record<string, unknown>): number {
  const op = value['operator'] as string;
  const right = value['right'] as Record<string, unknown>;
  const num = right?.['value'] as number ?? 1;
  return op === '-' ? -num : num;
}
