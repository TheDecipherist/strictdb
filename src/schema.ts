/**
 * StrictDB Schema Integration — Zod → SQL DDL + ES Mappings
 *
 * Optional Zod schema registration for:
 * - Write validation (parse on every write when schema: true)
 * - SQL DDL generation (CREATE TABLE)
 * - Elasticsearch mapping generation
 * - Field whitelist for sanitization
 */

import type { z } from 'zod';
import type { CollectionSchema, IndexDefinition, SqlDialect } from './types.js';
import { registerFields } from './sanitize.js';

// ─── Schema Registry ─────────────────────────────────────────────────────────

const schemaRegistry = new Map<string, CollectionSchema>();
const indexRegistry: IndexDefinition[] = [];

export function registerCollection<T>(definition: CollectionSchema<T>): void {
  schemaRegistry.set(definition.name, definition as CollectionSchema);

  // Extract field names for sanitization whitelist
  const fieldNames = extractFieldNames(definition.schema);
  registerFields(definition.name, fieldNames);

  // Register indexes
  if (definition.indexes) {
    for (const idx of definition.indexes) {
      indexRegistry.push(idx);
    }
  }
}

export function getSchema(name: string): CollectionSchema | undefined {
  return schemaRegistry.get(name);
}

export function getRegisteredCollections(): string[] {
  return [...schemaRegistry.keys()];
}

export function getRegisteredIndexes(): IndexDefinition[] {
  return [...indexRegistry];
}

export function registerIndex(definition: IndexDefinition): void {
  indexRegistry.push(definition);
}

export function clearRegistry(): void {
  schemaRegistry.clear();
  indexRegistry.length = 0;
}

/**
 * Validate a document against the registered schema.
 * Returns null if valid, or a Zod error if invalid.
 */
export function validateDocument(collection: string, doc: unknown): z.ZodError | null {
  const schema = schemaRegistry.get(collection);
  if (!schema) return null;

  const result = schema.schema.safeParse(doc);
  if (result.success) return null;
  return result.error;
}

// ─── SQL DDL Generation ──────────────────────────────────────────────────────

export function generateCreateTableSQL(name: string, schema: z.ZodType, dialect: SqlDialect = 'pg'): string {
  const fields = extractFieldsWithTypes(schema);
  const columns = fields.map(f => {
    const sqlType = zodTypeToSQL(f.type, f.constraints, dialect);
    const nullable = f.required ? ' NOT NULL' : '';
    const check = f.enumValues ? generateCheckConstraint(f.name, f.enumValues, dialect) : '';
    return `  "${f.name}" ${sqlType}${nullable}${check}`;
  });

  return `CREATE TABLE IF NOT EXISTS "${name}" (\n${columns.join(',\n')}\n)`;
}

export function generateCreateIndexSQL(
  idx: IndexDefinition,
  dialect: SqlDialect = 'pg',
): string {
  const indexName = `idx_${idx.collection}_${Object.keys(idx.fields).join('_')}`;
  const unique = idx.unique ? 'UNIQUE ' : '';
  const columns = Object.entries(idx.fields)
    .map(([col, dir]) => `"${col}" ${dir === 1 ? 'ASC' : 'DESC'}`)
    .join(', ');

  let sql = `CREATE ${unique}INDEX IF NOT EXISTS "${indexName}" ON "${idx.collection}" (${columns})`;

  // TTL indexes are MongoDB-specific — skip for SQL
  if (idx.sparse && dialect === 'pg') {
    sql += ` WHERE ${Object.keys(idx.fields).map(f => `"${f}" IS NOT NULL`).join(' AND ')}`;
  }

  return sql;
}

// ─── Elasticsearch Mapping Generation ────────────────────────────────────────

export function generateElasticMapping(schema: z.ZodType): Record<string, unknown> {
  const fields = extractFieldsWithTypes(schema);
  const properties: Record<string, unknown> = {};

  for (const field of fields) {
    properties[field.name] = zodTypeToElasticMapping(field.type, field.constraints, field.enumValues);
  }

  return { properties };
}

// ─── Type Extraction Helpers ─────────────────────────────────────────────────

interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  constraints: Record<string, unknown>;
  enumValues?: string[];
}

function extractFieldNames(schema: z.ZodType): string[] {
  const def = (schema as unknown as Record<string, unknown>)['_def'] as Record<string, unknown> | undefined;
  if (!def) return [];

  const typeName = def['typeName'] as string | undefined;

  if (typeName === 'ZodObject') {
    const shape = def['shape'] as (() => Record<string, unknown>) | Record<string, unknown>;
    const resolved = typeof shape === 'function' ? shape() : shape;
    return Object.keys(resolved);
  }

  // Handle ZodEffects (refinements, transforms)
  if (typeName === 'ZodEffects') {
    const inner = def['schema'] as z.ZodType | undefined;
    if (inner) return extractFieldNames(inner);
  }

  return [];
}

function extractFieldsWithTypes(schema: z.ZodType): FieldInfo[] {
  const def = (schema as unknown as Record<string, unknown>)['_def'] as Record<string, unknown> | undefined;
  if (!def) return [];

  const typeName = def['typeName'] as string | undefined;

  if (typeName === 'ZodObject') {
    const shape = def['shape'] as (() => Record<string, unknown>) | Record<string, unknown>;
    const resolved = typeof shape === 'function' ? shape() : shape;
    const fields: FieldInfo[] = [];

    for (const [name, fieldSchema] of Object.entries(resolved)) {
      const info = analyzeZodType(fieldSchema as z.ZodType);
      fields.push({ name, ...info });
    }

    return fields;
  }

  if (typeName === 'ZodEffects') {
    const inner = def['schema'] as z.ZodType | undefined;
    if (inner) return extractFieldsWithTypes(inner);
  }

  return [];
}

function analyzeZodType(schema: z.ZodType): Omit<FieldInfo, 'name'> {
  const def = (schema as unknown as Record<string, unknown>)['_def'] as Record<string, unknown>;
  const typeName = def?.['typeName'] as string | undefined;
  const checks = def?.['checks'] as Array<Record<string, unknown>> | undefined;
  const constraints: Record<string, unknown> = {};

  // Check for max length
  if (checks) {
    for (const check of checks) {
      if (check['kind'] === 'max') constraints['max'] = check['value'];
      if (check['kind'] === 'min') constraints['min'] = check['value'];
      if (check['kind'] === 'int') constraints['int'] = true;
    }
  }

  switch (typeName) {
    case 'ZodString':
      return { type: 'string', required: true, constraints };

    case 'ZodNumber':
      return { type: 'number', required: true, constraints };

    case 'ZodBoolean':
      return { type: 'boolean', required: true, constraints };

    case 'ZodDate':
      return { type: 'date', required: true, constraints };

    case 'ZodEnum': {
      const values = def['values'] as string[];
      return { type: 'enum', required: true, constraints, enumValues: values };
    }

    case 'ZodNativeEnum': {
      const enumObj = def['values'] as Record<string, unknown>;
      const values = Object.values(enumObj).filter(v => typeof v === 'string') as string[];
      return { type: 'enum', required: true, constraints, enumValues: values };
    }

    case 'ZodArray': {
      return { type: 'array', required: true, constraints };
    }

    case 'ZodObject': {
      return { type: 'object', required: true, constraints };
    }

    case 'ZodOptional': {
      const inner = def['innerType'] as z.ZodType;
      const info = analyzeZodType(inner);
      return { ...info, required: false };
    }

    case 'ZodNullable': {
      const inner = def['innerType'] as z.ZodType;
      const info = analyzeZodType(inner);
      return { ...info, required: false };
    }

    case 'ZodDefault': {
      const inner = def['innerType'] as z.ZodType;
      const info = analyzeZodType(inner);
      return { ...info, required: false };
    }

    default:
      return { type: 'unknown', required: true, constraints };
  }
}

// ─── SQL Type Mapping ────────────────────────────────────────────────────────

function zodTypeToSQL(type: string, constraints: Record<string, unknown>, dialect: SqlDialect): string {
  const maxLen = constraints['max'] as number | undefined;
  const isInt = constraints['int'] as boolean | undefined;

  switch (type) {
    case 'string':
      if (maxLen) {
        switch (dialect) {
          case 'pg': return `VARCHAR(${maxLen})`;
          case 'mysql2': return `VARCHAR(${maxLen})`;
          case 'mssql': return `NVARCHAR(${maxLen})`;
          case 'sqlite': return 'TEXT';
        }
      }
      switch (dialect) {
        case 'pg': return 'TEXT';
        case 'mysql2': return 'TEXT';
        case 'mssql': return 'NVARCHAR(MAX)';
        case 'sqlite': return 'TEXT';
      }
      break;

    case 'number':
      if (isInt) {
        switch (dialect) {
          case 'pg': return 'INTEGER';
          case 'mysql2': return 'INT';
          case 'mssql': return 'INT';
          case 'sqlite': return 'INTEGER';
        }
      }
      switch (dialect) {
        case 'pg': return 'DOUBLE PRECISION';
        case 'mysql2': return 'DOUBLE';
        case 'mssql': return 'FLOAT';
        case 'sqlite': return 'REAL';
      }
      break;

    case 'boolean':
      switch (dialect) {
        case 'pg': return 'BOOLEAN';
        case 'mysql2': return 'TINYINT(1)';
        case 'mssql': return 'BIT';
        case 'sqlite': return 'INTEGER';
      }
      break;

    case 'date':
      switch (dialect) {
        case 'pg': return 'TIMESTAMPTZ';
        case 'mysql2': return 'DATETIME';
        case 'mssql': return 'DATETIME2';
        case 'sqlite': return 'TEXT';
      }
      break;

    case 'enum':
      switch (dialect) {
        case 'pg': return 'TEXT';
        case 'mysql2': return 'TEXT'; // CHECK constraint added separately
        case 'mssql': return 'NVARCHAR(255)';
        case 'sqlite': return 'TEXT';
      }
      break;

    case 'array':
    case 'object':
      switch (dialect) {
        case 'pg': return 'JSONB';
        case 'mysql2': return 'JSON';
        case 'mssql': return 'NVARCHAR(MAX)';
        case 'sqlite': return 'TEXT';
      }
      break;
  }

  return 'TEXT';
}

function generateCheckConstraint(field: string, values: string[], dialect: SqlDialect): string {
  if (dialect === 'mysql2') {
    // MySQL 8 supports CHECK
    const list = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
    return ` CHECK ("${field}" IN (${list}))`;
  }
  // PG, SQLite, MSSQL all support CHECK
  const list = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
  return ` CHECK ("${field}" IN (${list}))`;
}

// ─── ES Mapping Type ─────────────────────────────────────────────────────────

function zodTypeToElasticMapping(
  type: string,
  constraints: Record<string, unknown>,
  enumValues?: string[],
): Record<string, unknown> {
  const maxLen = constraints['max'] as number | undefined;
  const isInt = constraints['int'] as boolean | undefined;

  switch (type) {
    case 'string':
      if (maxLen && maxLen <= 256) return { type: 'keyword' };
      if (enumValues) return { type: 'keyword' };
      return { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } };

    case 'number':
      return isInt ? { type: 'integer' } : { type: 'double' };

    case 'boolean':
      return { type: 'boolean' };

    case 'date':
      return { type: 'date' };

    case 'enum':
      return { type: 'keyword' };

    case 'array':
      return { type: 'nested' };

    case 'object':
      return { type: 'object' };

    default:
      return { type: 'text' };
  }
}
