/**
 * SQL Mode 2 — SELECT Translator
 *
 * Translates SELECT/FROM/WHERE/ORDER BY/LIMIT/OFFSET/DISTINCT/aliases/IS NULL
 * into MongoDB aggregate pipeline stages.
 */

import { coerceValue } from '../coercion.js';
import { translateFunction } from './functions.js';

// ─── Hoisted Constants (avoid per-call allocation) ──────────────────────────

const EXPR_OP_MAP: Readonly<Record<string, string>> = Object.freeze({
  '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte',
  '=': '$eq', '!=': '$ne', '<>': '$ne',
});

// ─── WHERE → $match ─────────────────────────────────────────────────────────

export function translateWhere(where: unknown): Record<string, unknown> {
  if (!where) return {};
  return translateExpr(where as Record<string, unknown>);
}

function translateExpr(node: Record<string, unknown>): Record<string, unknown> {
  const type = node['type'] as string | undefined;

  if (type === 'binary_expr') return translateBinaryExpr(node);
  if (type === 'unary_expr') return translateUnaryExpr(node);
  if (type === 'function' || type === 'aggr_func') return translateFunctionExpr(node);

  return {};
}

function translateBinaryExpr(node: Record<string, unknown>): Record<string, unknown> {
  const operator = (node['operator'] as string || '').toUpperCase();
  const left = node['left'] as Record<string, unknown>;
  const right = node['right'] as Record<string, unknown>;

  // Logical operators
  if (operator === 'AND') {
    const parts = [translateExpr(left), translateExpr(right)].filter(p => Object.keys(p).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0]!;
    return { $and: parts };
  }
  if (operator === 'OR') {
    const parts = [translateExpr(left), translateExpr(right)].filter(p => Object.keys(p).length > 0);
    if (parts.length === 0) return {};
    if (parts.length === 1) return parts[0]!;
    return { $or: parts };
  }

  // IS NULL / IS NOT NULL — preserve table prefix for anti-join patterns
  if (operator === 'IS') {
    const table = left['table'] as string | null;
    const col = extractFieldName(left);
    const field = table ? `${table}.${col}` : col;
    const rightType = right['type'] as string;
    if (rightType === 'null' || right['value'] === null) {
      return { $or: [{ [field]: null }, { [field]: { $exists: false } }] };
    }
    return { [field]: coerceValue(extractValue(right)) };
  }

  if (operator === 'IS NOT') {
    const table = left['table'] as string | null;
    const col = extractFieldName(left);
    const field = table ? `${table}.${col}` : col;
    const rightType = right['type'] as string;
    if (rightType === 'null' || right['value'] === null) {
      return { [field]: { $exists: true, $ne: null } };
    }
    return { [field]: { $ne: coerceValue(extractValue(right)) } };
  }

  // LIKE
  if (operator === 'LIKE' || operator === 'NOT LIKE') {
    const field = extractFieldName(left);
    const pattern = extractValue(right) as string;
    const regex = likeToRegex(pattern);
    if (operator === 'NOT LIKE') {
      return { [field]: { $not: { $regex: regex, $options: 'i' } } };
    }
    return { [field]: { $regex: regex, $options: 'i' } };
  }

  // REGEXP / RLIKE
  if (operator === 'REGEXP' || operator === 'RLIKE') {
    const field = extractFieldName(left);
    const pattern = extractValue(right) as string;
    return { [field]: { $regex: pattern } };
  }
  if (operator === 'NOT REGEXP' || operator === 'NOT RLIKE') {
    const field = extractFieldName(left);
    const pattern = extractValue(right) as string;
    return { [field]: { $not: { $regex: pattern } } };
  }

  // PostgreSQL regex operators
  if (operator === '~') {
    const field = extractFieldName(left);
    const pattern = extractValue(right) as string;
    return { [field]: { $regex: pattern } };
  }
  if (operator === '~*') {
    const field = extractFieldName(left);
    const pattern = extractValue(right) as string;
    return { [field]: { $regex: pattern, $options: 'i' } };
  }
  if (operator === '!~') {
    const field = extractFieldName(left);
    const pattern = extractValue(right) as string;
    return { [field]: { $not: { $regex: pattern } } };
  }

  // IN / NOT IN (literal list)
  if (operator === 'IN' || operator === 'NOT IN') {
    const field = extractFieldName(left);
    const values = extractInList(right);
    const op = operator === 'IN' ? '$in' : '$nin';
    return { [field]: { [op]: values.map(v => coerceValue(v)) } };
  }

  // BETWEEN
  if (operator === 'BETWEEN') {
    const field = extractFieldName(left);
    const rightValue = right['value'] as unknown[];
    if (Array.isArray(rightValue) && rightValue.length === 2) {
      // Values may be raw AST nodes { type: 'number', value: 10 } or primitives
      const low = typeof rightValue[0] === 'object' && rightValue[0] !== null
        ? extractValue(rightValue[0] as Record<string, unknown>)
        : rightValue[0];
      const high = typeof rightValue[1] === 'object' && rightValue[1] !== null
        ? extractValue(rightValue[1] as Record<string, unknown>)
        : rightValue[1];
      return { [field]: { $gte: coerceValue(low), $lte: coerceValue(high) } };
    }
    // node-sql-parser uses type: 'expr_list' with value array
    const exprType = right['type'] as string;
    if (exprType === 'expr_list') {
      const vals = right['value'] as Record<string, unknown>[];
      if (vals && vals.length === 2) {
        return {
          [field]: {
            $gte: coerceValue(extractValue(vals[0]!)),
            $lte: coerceValue(extractValue(vals[1]!)),
          },
        };
      }
    }
    return {};
  }

  // NOT BETWEEN
  if (operator === 'NOT BETWEEN') {
    const field = extractFieldName(left);
    // NOT BETWEEN a AND b → $or: [{ field: { $lt: a } }, { field: { $gt: b } }]
    const rightValue = right['value'] as unknown[];
    if (Array.isArray(rightValue) && rightValue.length === 2) {
      const low = typeof rightValue[0] === 'object' && rightValue[0] !== null
        ? extractValue(rightValue[0] as Record<string, unknown>)
        : rightValue[0];
      const high = typeof rightValue[1] === 'object' && rightValue[1] !== null
        ? extractValue(rightValue[1] as Record<string, unknown>)
        : rightValue[1];
      return { $or: [{ [field]: { $lt: coerceValue(low) } }, { [field]: { $gt: coerceValue(high) } }] };
    }
    const exprType = right['type'] as string;
    if (exprType === 'expr_list') {
      const vals = right['value'] as Record<string, unknown>[];
      if (vals && vals.length === 2) {
        return {
          $or: [
            { [field]: { $lt: coerceValue(extractValue(vals[0]!)) } },
            { [field]: { $gt: coerceValue(extractValue(vals[1]!)) } },
          ],
        };
      }
    }
    return {};
  }

  // Comparison operators
  // If left side is a complex expression (binary_expr, aggr_func), use $expr
  if (left['type'] === 'binary_expr' || left['type'] === 'aggr_func' || left['type'] === 'function') {
    const leftExpr = astToMongoAggExpr(left);
    const rightExpr = astToMongoAggExpr(right);
    const exprOp = EXPR_OP_MAP[operator];
    if (exprOp) {
      return { $expr: { [exprOp]: [leftExpr, rightExpr] } };
    }
  }

  const field = extractFieldName(left);
  const value = coerceValue(extractValue(right));

  switch (operator) {
    case '=': return { [field]: value };
    case '!=':
    case '<>': return { [field]: { $ne: value } };
    case '>': return { [field]: { $gt: value } };
    case '>=': return { [field]: { $gte: value } };
    case '<': return { [field]: { $lt: value } };
    case '<=': return { [field]: { $lte: value } };
    default: return {};
  }
}

function translateUnaryExpr(node: Record<string, unknown>): Record<string, unknown> {
  const operator = (node['operator'] as string || '').toUpperCase();
  const expr = node['expr'] as Record<string, unknown>;
  if (operator === 'NOT') {
    const inner = translateExpr(expr);
    // Wrap with $nor for NOT
    return { $nor: [inner] };
  }
  return {};
}

function translateFunctionExpr(_node: Record<string, unknown>): Record<string, unknown> {
  // Function expressions in WHERE are handled by the functions translator
  return {};
}

// ─── SELECT → $project ──────────────────────────────────────────────────────

export function translateColumns(columns: unknown, tableAliases: Map<string, string>): Record<string, unknown> | null {
  if (columns === '*') return null; // No $project needed

  const cols = columns as Array<Record<string, unknown>>;
  if (!Array.isArray(cols)) return null;

  // Check if any column is just '*'
  if (cols.some(c => {
    const expr = c['expr'] as Record<string, unknown>;
    return expr?.['type'] === 'column_ref' && expr?.['column'] === '*';
  })) {
    return null;
  }

  const project: Record<string, unknown> = { _id: 0 };
  for (const col of cols) {
    const expr = col['expr'] as Record<string, unknown>;
    const alias = col['as'] as string | null;
    const exprType = expr?.['type'] as string;

    if (exprType === 'column_ref') {
      const field = resolveColumnRef(expr, tableAliases);
      if (alias) {
        project[alias] = `$${field}`;
      } else if (field.includes('.')) {
        // Table-qualified column (e.g. "r.rating") — flatten to top-level
        // "r.rating": 1 would produce { r: { rating: 2 } } — wrong
        // Instead: "rating": "$r.rating" produces { rating: 2 } — correct
        const colName = expr['column'] as string;
        project[colName] = `$${field}`;
      } else {
        project[field] = 1;
      }
    } else if (exprType === 'aggr_func') {
      // Aggregate functions handled by aggregates translator
      continue;
    } else {
      // Expression columns (functions, EXTRACT, CASE, etc.)
      const translated = translateFunction(expr);
      if (alias && translated && Object.keys(translated).length > 0) {
        project[alias] = translated;
      } else if (alias) {
        project[alias] = 1;
      }
    }
  }

  return Object.keys(project).length > 1 ? project : null;
}

// ─── ORDER BY → $sort ───────────────────────────────────────────────────────

export interface OrderByResult {
  sort: Record<string, 1 | -1>;
  /** Computed fields that need $addFields before the $sort */
  computedFields?: Record<string, unknown>;
}

export function translateOrderBy(orderBy: unknown, tableAliases: Map<string, string>): OrderByResult | null {
  if (!orderBy) return null;
  const items = orderBy as Array<Record<string, unknown>>;
  if (!Array.isArray(items)) return null;

  const sort: Record<string, 1 | -1> = {};
  const computedFields: Record<string, unknown> = {};
  let computedIdx = 0;

  for (const item of items) {
    const expr = item['expr'] as Record<string, unknown>;
    const direction = (item['type'] as string || 'ASC').toUpperCase();

    if (expr?.['type'] === 'column_ref') {
      const field = resolveColumnRef(expr, tableAliases);
      sort[field] = direction === 'DESC' ? -1 : 1;
    } else if (expr?.['type'] === 'binary_expr' || expr?.['type'] === 'function' || expr?.['type'] === 'aggr_func') {
      // Complex expression — compute it as a temporary field
      const tempField = `_sort_expr_${computedIdx++}`;
      computedFields[tempField] = astToMongoAggExpr(expr);
      sort[tempField] = direction === 'DESC' ? -1 : 1;
    } else {
      const field = resolveColumnRef(expr, tableAliases);
      sort[field] = direction === 'DESC' ? -1 : 1;
    }
  }

  if (Object.keys(sort).length === 0) return null;
  return {
    sort,
    computedFields: Object.keys(computedFields).length > 0 ? computedFields : undefined,
  };
}

// ─── LIMIT / OFFSET ─────────────────────────────────────────────────────────

export function translateLimit(limit: unknown): { limit?: number; skip?: number } {
  if (!limit) return {};
  const l = limit as Record<string, unknown>;

  const result: { limit?: number; skip?: number } = {};
  const separator = (l['seperator'] ?? l['separator']) as string | undefined;

  const value = l['value'] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(value)) {
    if (value.length === 2) {
      const firstVal = value[0]!['value'] as number;
      const secondVal = value[1]!['value'] as number;

      if (separator === 'offset') {
        // "LIMIT count OFFSET skip" → first=limit, second=skip
        result.limit = firstVal;
        result.skip = secondVal;
      } else {
        // MySQL-style "LIMIT offset, count" → first=offset, second=limit
        result.skip = firstVal;
        result.limit = secondVal;
      }
    } else if (value.length === 1) {
      result.limit = value[0]!['value'] as number;
    }
  } else if (typeof l['value'] === 'number') {
    result.limit = l['value'] as number;
  }

  return result;
}

// ─── DISTINCT → $group ──────────────────────────────────────────────────────

export function translateDistinct(columns: unknown, tableAliases: Map<string, string>): Record<string, unknown>[] | null {
  const cols = columns as Array<Record<string, unknown>>;
  if (!Array.isArray(cols)) return null;

  // Build $group with all selected fields as _id
  const groupId: Record<string, unknown> = {};
  const projectAfter: Record<string, unknown> = { _id: 0 };

  for (const col of cols) {
    const expr = col['expr'] as Record<string, unknown>;
    const exprType = expr?.['type'] as string;
    if (exprType === 'column_ref') {
      const field = resolveColumnRef(expr, tableAliases);
      groupId[field] = `$${field}`;
      projectAfter[field] = `$_id.${field}`;
    }
  }

  return [
    { $group: { _id: groupId } },
    { $project: projectAfter },
  ];
}

// ─── LIKE → Regex ───────────────────────────────────────────────────────────

export function likeToRegex(pattern: string): string {
  // Escape regex special characters except our wildcards
  let regex = pattern.replace(/([.+^${}()|[\]\\])/g, '\\$1');

  // Convert SQL wildcards
  const hasLeading = regex.startsWith('%');
  const hasTrailing = regex.endsWith('%');

  regex = regex.replace(/%/g, '.*');
  regex = regex.replace(/_/g, '.');

  // Anchor if no leading wildcard
  if (!hasLeading) regex = '^' + regex;
  if (!hasTrailing) regex = regex + '$';

  // Clean up consecutive .* patterns
  regex = regex.replace(/(\.\*)+/g, '.*');

  return regex;
}

// ─── AST to MongoDB Aggregation Expression ──────────────────────────────────

/**
 * Convert an AST node to a MongoDB aggregation expression.
 * Used for complex expressions in WHERE ($expr), ORDER BY, and GROUP BY.
 */
export function astToMongoAggExpr(node: Record<string, unknown>): unknown {
  const type = node['type'] as string;
  if (type === 'column_ref') return `$${node['column'] as string}`;
  if (type === 'number') {
    const val = node['value'];
    return typeof val === 'string' ? Number(val) : val;
  }
  if (type === 'string' || type === 'single_quote_string') return node['value'];
  if (type === 'bool') return node['value'];
  if (type === 'null') return null;
  if (type === 'binary_expr') {
    const op = node['operator'] as string;
    const left = astToMongoAggExpr(node['left'] as Record<string, unknown>);
    const right = astToMongoAggExpr(node['right'] as Record<string, unknown>);
    const opMap: Record<string, string> = {
      '+': '$add', '-': '$subtract', '*': '$multiply', '/': '$divide', '%': '$mod',
    };
    const mongoOp = opMap[op];
    if (mongoOp) return { [mongoOp]: [left, right] };
    return left; // fallback
  }
  return node['value'] ?? null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function extractFieldName(node: Record<string, unknown>): string {
  const type = node['type'] as string;
  if (type === 'column_ref') {
    return node['column'] as string;
  }
  if (type === 'string' || type === 'single_quote_string') {
    return node['value'] as string;
  }
  return String(node['value'] ?? node['column'] ?? 'unknown');
}

export function extractValue(node: Record<string, unknown>): unknown {
  const type = node['type'] as string;
  if (type === 'number') return node['value'] as number;
  if (type === 'string' || type === 'single_quote_string') return node['value'] as string;
  if (type === 'bool') return node['value'] as boolean;
  if (type === 'null') return null;
  if (type === 'column_ref') return node['column'] as string;
  return node['value'];
}

export function extractInList(node: Record<string, unknown>): unknown[] {
  const type = node['type'] as string;
  if (type === 'expr_list') {
    const values = node['value'] as Array<Record<string, unknown>>;
    return values.map(v => extractValue(v));
  }
  return [];
}

export function resolveColumnRef(expr: Record<string, unknown>, tableAliases: Map<string, string>): string {
  const column = expr['column'];
  if (typeof column !== 'string') return '';  // defensive — parser produced non-string column
  const table = expr['table'] as string | null;

  if (table) {
    const resolvedTable = tableAliases.get(table);
    const mainTable = tableAliases.get('__main__');

    if (resolvedTable && resolvedTable !== mainTable) {
      // This is a JOIN alias — keep the prefix: e.g., o.total
      return `${table}.${column}`;
    }
  }

  return column;
}

export function buildTableAliases(from: unknown): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!Array.isArray(from)) return aliases;

  let isFirst = true;
  for (const item of from) {
    const f = item as Record<string, unknown>;
    const table = f['table'] as string | undefined;
    const alias = f['as'] as string | null;

    // Derived table: { expr: { ast: ... }, as: 't' }
    if (!table && f['expr']) {
      const expr = f['expr'] as Record<string, unknown>;
      if (expr['ast']) {
        const innerCollection = extractCollection(expr['ast'] as Record<string, unknown>);
        const derivedAlias = alias ?? '_derived';
        aliases.set(derivedAlias, innerCollection);
        if (isFirst) {
          aliases.set('__main__', derivedAlias);
          isFirst = false;
        }
        continue;
      }
    }

    if (table) {
      if (alias) {
        aliases.set(alias, table);
      }
      aliases.set(table, table);
    }
    // Mark the first (main) table so resolveColumnRef can distinguish JOINs
    if (isFirst) {
      aliases.set('__main__', table ?? '_derived');
      isFirst = false;
    }
  }

  return aliases;
}

/**
 * Build the full aggregate pipeline stages from a SELECT AST.
 */
export function buildSelectPipeline(ast: Record<string, unknown>): Record<string, unknown>[] {
  const stages: Record<string, unknown>[] = [];
  const tableAliases = buildTableAliases(ast['from']);
  const distinct = (ast['distinct'] as string | null)?.toUpperCase() === 'DISTINCT' || ast['distinct'] === true;

  // 1. $match (WHERE)
  const where = ast['where'];
  if (where) {
    const match = translateWhere(where);
    if (Object.keys(match).length > 0) {
      stages.push({ $match: match });
    }
  }

  // 2. DISTINCT → $group
  if (distinct) {
    const distinctStages = translateDistinct(ast['columns'], tableAliases);
    if (distinctStages) {
      stages.push(...distinctStages);
    }
  }

  // 3. $sort (ORDER BY)
  const orderByResult = translateOrderBy(ast['orderby'] ?? ast['orderBy'], tableAliases);
  if (orderByResult) {
    if (orderByResult.computedFields) {
      stages.push({ $addFields: orderByResult.computedFields });
    }
    stages.push({ $sort: orderByResult.sort });
  }

  // 4. $skip and $limit
  const { skip, limit } = translateLimit(ast['limit']);
  if (skip) {
    stages.push({ $skip: skip });
  }
  if (limit) {
    stages.push({ $limit: limit });
  }

  // 5. $project (SELECT columns) — after sort/limit for efficiency
  if (!distinct) {
    const project = translateColumns(ast['columns'], tableAliases);
    if (project) {
      stages.push({ $project: project });
    }
  }

  return stages;
}

/**
 * Extract collection name from AST FROM clause.
 * For derived tables (subquery in FROM), returns the inner subquery's collection.
 */
export function extractCollection(ast: Record<string, unknown>): string {
  const from = ast['from'] as Array<Record<string, unknown>> | undefined;
  if (from && from.length > 0) {
    const first = from[0]!;
    if (first['table']) {
      return first['table'] as string;
    }
    // Derived table: { expr: { ast: { from: [...] } }, as: 't' }
    const expr = first['expr'] as Record<string, unknown> | undefined;
    if (expr?.['ast']) {
      return extractCollection(expr['ast'] as Record<string, unknown>);
    }
  }
  // For INSERT/UPDATE/DELETE the table is in 'table'
  const table = ast['table'] as Array<Record<string, unknown>> | string | undefined;
  if (typeof table === 'string') return table;
  if (Array.isArray(table) && table.length > 0 && table[0]!['table']) {
    return table[0]!['table'] as string;
  }
  return 'unknown';
}

/**
 * Check if the FROM clause contains a derived table (subquery in FROM).
 * Returns the derived table info if found.
 */
export function extractDerivedTable(from: unknown): { subAst: Record<string, unknown>; alias: string } | null {
  if (!Array.isArray(from) || from.length === 0) return null;
  const first = from[0] as Record<string, unknown>;
  const expr = first['expr'] as Record<string, unknown> | undefined;
  if (expr?.['ast']) {
    return {
      subAst: expr['ast'] as Record<string, unknown>,
      alias: (first['as'] as string) ?? '_derived',
    };
  }
  return null;
}
