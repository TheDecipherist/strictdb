/**
 * SQL Mode 2 — Aggregate Translator
 *
 * GROUP BY → $group
 * HAVING → $match (after $group)
 * COUNT/SUM/AVG/MIN/MAX/GROUP_CONCAT/ARRAY_AGG/STDDEV → accumulators
 * Window functions → $setWindowFields
 */

import { resolveColumnRef, translateWhere, astToMongoAggExpr } from './select.js';
import type { AggregateField, WindowSpec } from '../types.js';

/**
 * Extract a plain string name from a function name field.
 * node-sql-parser can return name as a string or as { name: [{ value: "RANK" }] }.
 */
function extractFunctionName(expr: Record<string, unknown>): string {
  const raw = expr['name'];
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    // Shape: { name: [{ type: "default", value: "RANK" }] }
    const nameArr = (raw as Record<string, unknown>)['name'];
    if (Array.isArray(nameArr) && nameArr.length > 0) {
      const first = nameArr[0] as Record<string, unknown>;
      if (typeof first['value'] === 'string') return first['value'];
    }
  }
  // Fall back to expr type check (aggr_func without a string name)
  return '';
}

/**
 * Check if a SELECT AST has aggregate functions.
 */
export function hasAggregates(columns: unknown): boolean {
  if (!Array.isArray(columns)) return false;
  return columns.some((col: unknown) => {
    const c = col as Record<string, unknown>;
    const expr = c['expr'] as Record<string, unknown>;
    // aggr_func with an OVER clause is a window function, not a regular aggregate
    return expr?.['type'] === 'aggr_func' && !expr?.['over'];
  });
}

/**
 * Check if a SELECT AST has window functions.
 */
export function hasWindowFunctions(columns: unknown): boolean {
  if (!Array.isArray(columns)) return false;
  return columns.some((col: unknown) => {
    const c = col as Record<string, unknown>;
    const expr = c['expr'] as Record<string, unknown>;
    return expr?.['over'] !== undefined && expr?.['over'] !== null;
  });
}

/**
 * Extract aggregate fields from columns.
 */
export function extractAggregateFields(columns: unknown, tableAliases?: Map<string, string>): AggregateField[] {
  if (!Array.isArray(columns)) return [];

  const fields: AggregateField[] = [];
  for (const col of columns) {
    const c = col as Record<string, unknown>;
    const expr = c['expr'] as Record<string, unknown>;
    const alias = c['as'] as string | null;

    if (expr?.['type'] === 'aggr_func' && !expr?.['over']) {
      const name = extractFunctionName(expr).toUpperCase() || (expr['name'] as string || '').toUpperCase();
      const args = expr['args'] as Record<string, unknown>;
      let field = '*';
      const isDistinct = args?.['distinct'] === 'DISTINCT';

      if (args?.['expr']) {
        const argExpr = args['expr'] as Record<string, unknown>;
        if (argExpr['type'] === 'column_ref') {
          if (tableAliases) {
            field = resolveColumnRef(argExpr, tableAliases);
          } else {
            const table = argExpr['table'] as string | null;
            const col = argExpr['column'] as string;
            field = table ? `${table}.${col}` : col;
          }
        } else if (argExpr['type'] === 'star') {
          field = '*';
        }
      }

      fields.push({
        func: name,
        field,
        alias: alias ?? `${name.toLowerCase()}_${field}`.replace('*', 'all'),
        distinct: isDistinct || undefined,
      });
    }
  }

  return fields;
}

/**
 * Extract window function specs from columns.
 */
export function extractWindowSpecs(columns: unknown): WindowSpec[] {
  if (!Array.isArray(columns)) return [];

  const specs: WindowSpec[] = [];
  for (const col of columns) {
    const c = col as Record<string, unknown>;
    const expr = c['expr'] as Record<string, unknown>;
    const alias = c['as'] as string | null;
    const over = expr?.['over'] as Record<string, unknown> | undefined;

    if (!over) continue;

    const name = extractFunctionName(expr).toUpperCase();

    const partitionBy = extractPartitionBy(over);
    const orderBy = extractWindowOrderBy(over);

    const args = expr['args'] as Record<string, unknown> | undefined;
    let field: string | undefined;
    let offset: number | undefined;

    if (args?.['expr']) {
      const argExpr = args['expr'] as Record<string, unknown>;
      if (argExpr['type'] === 'column_ref') {
        field = argExpr['column'] as string;
      }
    }

    // Handle LAG/LEAD offset
    if (name === 'LAG' || name === 'LEAD') {
      offset = 1;
      // args is { type: "expr_list", value: [column_ref, number] }
      if (args?.['type'] === 'expr_list') {
        const list = args['value'] as Array<Record<string, unknown>>;
        if (list && list.length >= 1) {
          field = (list[0] as Record<string, unknown>)?.['column'] as string;
        }
        if (list && list.length >= 2) {
          offset = (list[1] as Record<string, unknown>)?.['value'] as number ?? 1;
        }
      } else if (args?.['expr']) {
        // Single-arg form: LAG(total) — args.expr is the column_ref
        const argExpr = args['expr'] as Record<string, unknown>;
        if (argExpr['type'] === 'column_ref') {
          field = argExpr['column'] as string;
        }
      }
    }

    specs.push({
      func: name,
      field,
      alias: alias ?? name.toLowerCase(),
      partitionBy: partitionBy.length > 0 ? partitionBy : undefined,
      orderBy: orderBy.length > 0 ? orderBy : undefined,
      offset,
    });
  }

  return specs;
}

/**
 * Unwrap the over clause to get the window specification object.
 * node-sql-parser nests it as: over.as_window_specification.window_specification
 * but may also appear flat (over.partitionby, over.orderby) in some versions.
 */
function unwrapOver(over: Record<string, unknown>): Record<string, unknown> {
  const asWinSpec = over['as_window_specification'] as Record<string, unknown> | undefined;
  if (asWinSpec) {
    const winSpec = asWinSpec['window_specification'] as Record<string, unknown> | undefined;
    if (winSpec) return winSpec;
  }
  return over;
}

function extractPartitionBy(over: Record<string, unknown>): string[] {
  const spec = unwrapOver(over);
  const partitionBy = spec['partitionby'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(partitionBy)) return [];
  return partitionBy.map(p => {
    const expr = p['expr'] as Record<string, unknown> | undefined;
    if (expr?.['type'] === 'column_ref') return expr['column'] as string;
    return p['column'] as string ?? '';
  }).filter(Boolean);
}

function extractWindowOrderBy(over: Record<string, unknown>): Array<{ field: string; direction: 1 | -1 }> {
  const spec = unwrapOver(over);
  const orderBy = spec['orderby'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(orderBy)) return [];
  return orderBy.map(o => {
    const expr = o['expr'] as Record<string, unknown>;
    const dir = (o['type'] as string || 'ASC').toUpperCase();
    return {
      field: expr?.['column'] as string ?? '',
      direction: (dir === 'DESC' ? -1 : 1) as 1 | -1,
    };
  }).filter(o => o.field);
}

export interface GroupStageResult {
  groupStage: Record<string, unknown>;
  /** Computed fields that need $addFields BEFORE the $group (for complex GROUP BY expressions) */
  preComputedFields?: Record<string, unknown>;
}

/**
 * Build $group stage from GROUP BY + aggregate functions.
 */
export function buildGroupStage(
  groupBy: unknown,
  aggregateFields: AggregateField[],
  columns: unknown,
  tableAliases: Map<string, string>,
): GroupStageResult {
  const group: Record<string, unknown> = {};
  const preComputedFields: Record<string, unknown> = {};
  let preComputedIdx = 0;

  // Build _id
  if (!groupBy) {
    // Total aggregation (no GROUP BY)
    group['_id'] = null;
  } else {
    // node-sql-parser wraps GROUP BY as { columns: [...], modifiers: [...] }
    // but some internal callers may pass an array directly — handle both
    let items: Array<Record<string, unknown>>;
    const gb = groupBy as Record<string, unknown> | Array<Record<string, unknown>>;
    if (Array.isArray(gb)) {
      items = gb;
    } else if (gb['columns'] && Array.isArray(gb['columns'])) {
      items = gb['columns'] as Array<Record<string, unknown>>;
    } else {
      items = [gb as Record<string, unknown>];
    }

    if (items.length === 1) {
      const expr = items[0]!['expr'] as Record<string, unknown> ?? items[0]!;
      const resolved = resolveGroupByExpr(expr, tableAliases, preComputedFields, preComputedIdx);
      group['_id'] = resolved.ref;
      preComputedIdx = resolved.nextIdx;
    } else {
      const compoundId: Record<string, unknown> = {};
      for (const item of items) {
        const expr = item['expr'] as Record<string, unknown> ?? item;
        const resolved = resolveGroupByExpr(expr, tableAliases, preComputedFields, preComputedIdx);
        const fieldName = resolved.fieldName;
        compoundId[fieldName] = resolved.ref;
        preComputedIdx = resolved.nextIdx;
      }
      group['_id'] = compoundId;
    }
  }

  // Build accumulators
  for (const agg of aggregateFields) {
    group[agg.alias] = buildAccumulator(agg);
  }

  // Add non-aggregate, non-grouped columns with $first
  if (Array.isArray(columns)) {
    for (const col of columns) {
      const c = col as Record<string, unknown>;
      const expr = c['expr'] as Record<string, unknown>;
      if (expr?.['type'] === 'column_ref') {
        const field = resolveColumnRef(expr, tableAliases);
        const alias = c['as'] as string ?? field;
        // Don't overwrite existing group fields
        if (!group[alias] && !group[field]) {
          group[field] = { $first: `$${field}` };
        }
      }
    }
  }

  return {
    groupStage: { $group: group },
    preComputedFields: Object.keys(preComputedFields).length > 0 ? preComputedFields : undefined,
  };
}

function resolveGroupByExpr(
  expr: Record<string, unknown>,
  tableAliases: Map<string, string>,
  preComputedFields: Record<string, unknown>,
  idx: number,
): { ref: string; fieldName: string; nextIdx: number } {
  if (expr['type'] === 'column_ref') {
    const field = resolveColumnRef(expr, tableAliases);
    return { ref: `$${field}`, fieldName: field, nextIdx: idx };
  }

  // Complex expression — pre-compute as $addFields, then group on computed field
  const tempField = `_group_expr_${idx}`;
  if (expr['type'] === 'binary_expr') {
    preComputedFields[tempField] = astToMongoAggExpr(expr);
  } else {
    // CASE, function, etc. — store the raw AST for the planner to translate via translateFunction
    preComputedFields[tempField] = { __ast_expr: expr };
  }
  return { ref: `$${tempField}`, fieldName: tempField, nextIdx: idx + 1 };
}

function buildAccumulator(agg: AggregateField): Record<string, unknown> {
  switch (agg.func) {
    case 'COUNT':
      // COUNT(DISTINCT field) — use $addToSet, then $size in a post-group $addFields stage
      if (agg.distinct && agg.field !== '*') {
        return { $addToSet: `$${agg.field}` };
      }
      if (agg.field === '*') {
        return { $sum: 1 };
      }
      // COUNT(field) — count non-null values (0, false, "" are valid — only null/missing excluded)
      return {
        $sum: {
          $cond: {
            if: { $ne: [{ $type: `$${agg.field}` }, 'missing'] },
            then: { $cond: { if: { $ne: [`$${agg.field}`, null] }, then: 1, else: 0 } },
            else: 0,
          },
        },
      };
    case 'SUM':
      return { $sum: `$${agg.field}` };
    case 'AVG':
      return { $avg: `$${agg.field}` };
    case 'MIN':
      return { $min: `$${agg.field}` };
    case 'MAX':
      return { $max: `$${agg.field}` };
    case 'GROUP_CONCAT':
    case 'STRING_AGG':
    case 'LISTAGG':
      // Collect values into array — separator-based join needs post-processing
      return { $push: `$${agg.field}` };
    case 'ARRAY_AGG':
      return { $push: `$${agg.field}` };
    case 'STDDEV':
    case 'STDDEV_POP':
      return { $stdDevPop: `$${agg.field}` };
    case 'STDDEV_SAMP':
      return { $stdDevSamp: `$${agg.field}` };
    default:
      return { $sum: 1 };
  }
}

/**
 * Build $match stage for HAVING clause (placed after $group).
 * HAVING operates on aggregated values, so aggr_func references must be resolved
 * to their aliases from the $group stage (e.g., AVG(salary) → avg_sal).
 */
export function buildHavingStage(having: unknown, aggregateFields?: AggregateField[]): Record<string, unknown> | null {
  if (!having) return null;
  const match = translateHavingExpr(having as Record<string, unknown>, aggregateFields ?? []);
  if (Object.keys(match).length === 0) return null;
  return { $match: match };
}

function translateHavingExpr(node: Record<string, unknown>, aggFields: AggregateField[]): Record<string, unknown> {
  const type = node['type'] as string;
  if (type !== 'binary_expr') return translateWhere(node);

  const operator = (node['operator'] as string || '').toUpperCase();
  const left = node['left'] as Record<string, unknown>;
  const right = node['right'] as Record<string, unknown>;

  // Logical
  if (operator === 'AND') {
    return { $and: [translateHavingExpr(left, aggFields), translateHavingExpr(right, aggFields)] };
  }
  if (operator === 'OR') {
    return { $or: [translateHavingExpr(left, aggFields), translateHavingExpr(right, aggFields)] };
  }

  // If left side is an aggr_func, resolve to its alias
  const field = resolveHavingField(left, aggFields);
  const value = extractHavingValue(right);

  switch (operator) {
    case '>': return { [field]: { $gt: value } };
    case '>=': return { [field]: { $gte: value } };
    case '<': return { [field]: { $lt: value } };
    case '<=': return { [field]: { $lte: value } };
    case '=': return { [field]: value };
    case '!=':
    case '<>': return { [field]: { $ne: value } };
    default: return {};
  }
}

function resolveHavingField(node: Record<string, unknown>, aggFields: AggregateField[]): string {
  const type = node['type'] as string;

  if (type === 'column_ref') {
    return node['column'] as string;
  }

  if (type === 'aggr_func') {
    // Match this aggregate to its alias from the SELECT clause
    const funcName = extractFunctionName(node);
    const args = node['args'] as Record<string, unknown> | undefined;
    let argField = '*';
    if (args) {
      const expr = args['expr'] as Record<string, unknown> | undefined;
      if (expr?.['type'] === 'column_ref') {
        const table = expr['table'] as string | null;
        const col = expr['column'] as string;
        argField = table ? `${table}.${col}` : col;
      } else if (expr?.['type'] === 'star') {
        argField = '*';
      }
    }

    // Find matching aggregate field by function name and argument
    for (const agg of aggFields) {
      if (agg.func === funcName && (agg.field === argField || agg.field.endsWith(`.${argField}`))) {
        return agg.alias;
      }
    }
    // Fallback: construct a default alias
    return `${funcName.toLowerCase()}_${argField}`.replace('*', 'all');
  }

  return node['column'] as string ?? 'unknown';
}

function extractHavingValue(node: Record<string, unknown>): unknown {
  const type = node['type'] as string;
  if (type === 'number') {
    const val = node['value'];
    return typeof val === 'string' ? Number(val) : val;
  }
  if (type === 'string' || type === 'single_quote_string') return node['value'];
  if (type === 'bool') return node['value'];
  return node['value'];
}

/**
 * Build $setWindowFields stages for window functions.
 * Specs with different partitionBy/orderBy signatures get separate stages.
 */
export function buildWindowStages(specs: WindowSpec[]): Record<string, unknown>[] {
  // Group specs by their partitionBy+orderBy signature
  const groups = new Map<string, WindowSpec[]>();
  for (const spec of specs) {
    const key = JSON.stringify({ partitionBy: spec.partitionBy, orderBy: spec.orderBy });
    const group = groups.get(key) ?? [];
    group.push(spec);
    groups.set(key, group);
  }

  const stages: Record<string, unknown>[] = [];
  for (const groupSpecs of groups.values()) {
    stages.push(buildSingleWindowStage(groupSpecs));
  }
  return stages;
}

function buildSingleWindowStage(specs: WindowSpec[]): Record<string, unknown> {
  const partitionBy = specs[0]?.partitionBy;
  const sortBy: Record<string, 1 | -1> = {};
  const output: Record<string, unknown> = {};

  // Use orderBy from the first spec that has it
  for (const spec of specs) {
    if (spec.orderBy) {
      for (const ob of spec.orderBy) {
        sortBy[ob.field] = ob.direction;
      }
      break;
    }
  }

  for (const spec of specs) {
    switch (spec.func) {
      case 'ROW_NUMBER':
        output[spec.alias] = { $documentNumber: {} };
        break;
      case 'RANK':
        output[spec.alias] = { $rank: {} };
        break;
      case 'DENSE_RANK':
        output[spec.alias] = { $denseRank: {} };
        break;
      case 'LAG':
        output[spec.alias] = {
          $shift: {
            output: spec.field ? `$${spec.field}` : undefined,
            by: -(spec.offset ?? 1),
          },
        };
        break;
      case 'LEAD':
        output[spec.alias] = {
          $shift: {
            output: spec.field ? `$${spec.field}` : undefined,
            by: spec.offset ?? 1,
          },
        };
        break;
      case 'FIRST_VALUE':
        output[spec.alias] = { $first: spec.field ? `$${spec.field}` : undefined };
        break;
      case 'LAST_VALUE':
        output[spec.alias] = { $last: spec.field ? `$${spec.field}` : undefined };
        break;
      // Aggregate window functions
      case 'SUM':
        output[spec.alias] = { $sum: spec.field ? `$${spec.field}` : 1, window: { documents: ['unbounded', 'unbounded'] } };
        break;
      case 'AVG':
        output[spec.alias] = { $avg: spec.field ? `$${spec.field}` : undefined, window: { documents: ['unbounded', 'unbounded'] } };
        break;
      case 'COUNT':
        output[spec.alias] = { $sum: 1, window: { documents: ['unbounded', 'unbounded'] } };
        break;
      case 'MIN':
        output[spec.alias] = { $min: spec.field ? `$${spec.field}` : undefined, window: { documents: ['unbounded', 'unbounded'] } };
        break;
      case 'MAX':
        output[spec.alias] = { $max: spec.field ? `$${spec.field}` : undefined, window: { documents: ['unbounded', 'unbounded'] } };
        break;
    }
  }

  const stage: Record<string, unknown> = {
    $setWindowFields: {
      sortBy: Object.keys(sortBy).length > 0 ? sortBy : undefined,
      output,
    },
  };

  if (partitionBy && partitionBy.length === 1) {
    (stage['$setWindowFields'] as Record<string, unknown>)['partitionBy'] = `$${partitionBy[0]}`;
  } else if (partitionBy && partitionBy.length > 1) {
    const pb: Record<string, string> = {};
    for (const p of partitionBy) pb[p] = `$${p}`;
    (stage['$setWindowFields'] as Record<string, unknown>)['partitionBy'] = pb;
  }

  return stage;
}
