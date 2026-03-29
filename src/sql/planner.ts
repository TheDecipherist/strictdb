/**
 * SQL Mode 2 — Planner
 *
 * AST → ExecutionPlan with dependency graph.
 * Determines statement type, dependencies, pipeline structure, parallelism.
 */

import type { ExecutionPlan, Dependency, PipelineDef } from './types.js';
import { unsupportedError } from './errors.js';
import {
  buildSelectPipeline,
  extractCollection,
  buildTableAliases,
} from './translators/select.js';
import {
  hasAggregates,
  hasWindowFunctions,
  extractAggregateFields,
  extractWindowSpecs,
  buildGroupStage,
  buildHavingStage,
  buildWindowStages,
} from './translators/aggregates.js';
import { extractJoins, translateJoins, splitWhereByTable } from './translators/joins.js';
import { translateInsert, translateUpdate, translateDelete } from './translators/writes.js';
import { extractSubqueryDeps } from './translators/subqueries.js';
import { extractCTEs } from './translators/cte.js';
import { translateFunction } from './translators/functions.js';
import { translateWhere, translateOrderBy, translateLimit, translateColumns } from './translators/select.js';
import { checkSqlGuardrails, checkNullComparisons } from './guardrails.js';

/**
 * Build an ExecutionPlan from a parsed AST.
 */
export function buildExecutionPlan(ast: unknown, sql: string): ExecutionPlan {
  const node = ast as Record<string, unknown>;
  const stmtType = (node['type'] as string || '').toLowerCase();

  // Check guardrails
  checkSqlGuardrails(node as { type?: string; where?: unknown; limit?: unknown; from?: Array<{ table?: string }>; table?: Array<{ table?: string }> | string; columns?: unknown; set?: unknown }, sql);

  // Check for = NULL comparisons
  if (node['where']) {
    checkNullComparisons(node['where'], sql);
  }

  switch (stmtType) {
    case 'select':
      return planSelect(node, sql);
    case 'insert':
      return planInsert(node, sql);
    case 'update':
      return planUpdate(node, sql);
    case 'delete':
      return planDelete(node, sql);
    default:
      throw unsupportedError(`${stmtType.toUpperCase()} statements`, { sql });
  }
}

function planSelect(ast: Record<string, unknown>, _sql: string): ExecutionPlan {
  const collection = extractCollection(ast);
  const tableAliases = buildTableAliases(ast['from']);
  const dependencies: Dependency[] = [];
  const pipelines: PipelineDef[] = [];
  let parallel = false;

  // 1. Extract CTEs (WITH clause)
  const withClause = ast['with'] as unknown;
  if (withClause) {
    const cteDeps = extractCTEs(withClause);
    dependencies.push(...cteDeps);
  }

  // 2. Extract subquery dependencies from WHERE
  const { deps: subDeps, modifiedWhere } = extractSubqueryDeps(ast['where']);
  dependencies.push(...subDeps);

  // 3. Check for JOINs
  const from = ast['from'] as Array<Record<string, unknown>> | undefined;
  const joins = from ? extractJoins(from) : [];
  const hasJoins = joins.length > 0;

  // 4. Build the main pipeline
  const stages: Record<string, unknown>[] = [];

  // Split WHERE conditions for join filter pushdown
  const whereSource = subDeps.length > 0 ? modifiedWhere : ast['where'];
  let mainWhere: unknown = whereSource;
  let pushdownFilters: Map<string, Record<string, unknown>> | undefined;

  if (hasJoins && whereSource && subDeps.length === 0) {
    // Build alias sets for main table and joined tables
    const mainAliases = new Set<string>();
    if (from && from.length > 0) {
      const mainTable = from[0] as Record<string, unknown>;
      mainAliases.add(mainTable['table'] as string);
      if (mainTable['as']) mainAliases.add(mainTable['as'] as string);
    }
    const joinAliases = new Set<string>();
    for (const j of joins) {
      joinAliases.add(j.table);
      if (j.alias) joinAliases.add(j.alias);
    }

    const split = splitWhereByTable(whereSource, mainAliases, joinAliases);
    mainWhere = split.mainWhere;

    // Convert pushdown conditions from AST to MongoDB filter via translateWhere
    if (split.pushdownMap.size > 0) {
      pushdownFilters = new Map<string, Record<string, unknown>>();
      for (const [alias, astFilter] of split.pushdownMap) {
        pushdownFilters.set(alias, translateWhere(astFilter));
      }
    }
  }

  // JOIN stages first
  if (hasJoins && from) {
    const joinResult = translateJoins(from, collection, pushdownFilters);
    stages.push(...joinResult.stages);

    // FULL OUTER JOIN produces a second pipeline
    if (joinResult.secondPipeline) {
      pipelines.push(joinResult.secondPipeline);
      parallel = true;
    }
  }

  // WHERE → $match (remaining main-table conditions)
  if (mainWhere) {
    const match = subDeps.length > 0
      ? translateModifiedWhere(mainWhere as Record<string, unknown>, subDeps)
      : translateWhere(mainWhere);
    if (Object.keys(match).length > 0) {
      stages.push({ $match: match });
    }
  }

  // Check for aggregates
  const columns = ast['columns'];
  const groupBy = ast['groupby'] ?? ast['groupBy'];
  const isAggregate = hasAggregates(columns) || groupBy !== undefined;
  const isWindow = hasWindowFunctions(columns);

  if (isAggregate) {
    const aggFields = extractAggregateFields(columns);
    const groupResult = buildGroupStage(groupBy, aggFields, columns, tableAliases);

    // If GROUP BY has complex expressions, add $addFields before $group
    if (groupResult.preComputedFields) {
      const addFields: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(groupResult.preComputedFields)) {
        if (value && typeof value === 'object' && (value as Record<string, unknown>)['__ast_expr']) {
          // Resolve CASE/function AST expressions via translateFunction
          addFields[key] = translateFunction((value as Record<string, unknown>)['__ast_expr'] as Record<string, unknown>);
        } else {
          addFields[key] = value;
        }
      }
      stages.push({ $addFields: addFields });
    }

    stages.push(groupResult.groupStage);

    // HAVING → $match after $group
    const having = ast['having'];
    const havingStage = buildHavingStage(having, aggFields);
    if (havingStage) stages.push(havingStage);
  }

  if (isWindow) {
    const windowSpecs = extractWindowSpecs(columns);
    if (windowSpecs.length > 0) {
      const windowStages = buildWindowStages(windowSpecs);
      stages.push(...windowStages);
    }
  }

  // Add function expressions in SELECT to $addFields (BEFORE sort/limit so aliases are available)
  if (!isAggregate && !isWindow && Array.isArray(columns)) {
    const addFields: Record<string, unknown> = {};
    for (const col of columns) {
      const c = col as Record<string, unknown>;
      const expr = c['expr'] as Record<string, unknown>;
      const alias = c['as'] as string | null;
      if (expr?.['type'] === 'function' && alias) {
        addFields[alias] = translateFunction(expr);
      }
      if (expr?.['type'] === 'case' && alias) {
        addFields[alias] = translateFunction(expr);
      }
      if (expr?.['type'] === 'cast' && alias) {
        addFields[alias] = translateFunction(expr);
      }
    }
    if (Object.keys(addFields).length > 0) {
      stages.push({ $addFields: addFields });
    }
  }

  // ORDER BY → $sort (may need $addFields for computed sort expressions)
  const orderByResult = translateOrderBy(ast['orderby'] ?? ast['orderBy'], tableAliases);
  if (orderByResult) {
    if (orderByResult.computedFields) {
      stages.push({ $addFields: orderByResult.computedFields });
    }
    stages.push({ $sort: orderByResult.sort });
  }

  // LIMIT/OFFSET → $skip/$limit
  const { skip, limit } = translateLimit(ast['limit']);
  if (skip) stages.push({ $skip: skip });
  if (limit) stages.push({ $limit: limit });

  // SELECT columns → $project (skip for aggregates that already define output)
  if (!isAggregate && !isWindow) {
    const distinctVal = ast['distinct'];
    const distinct =
      (typeof distinctVal === 'string' && distinctVal.toUpperCase() === 'DISTINCT') ||
      distinctVal === true;
    if (!distinct) {
      const project = translateColumns(columns, tableAliases);
      if (project) stages.push({ $project: project });
    }
  }

  // Main pipeline
  const mainPipeline: PipelineDef = { collection, stages };
  pipelines.unshift(mainPipeline);

  return {
    type: 'select',
    collection,
    dependencies,
    pipelines,
    parallel,
    isAggregate,
    isTransaction: false,
  };
}

/**
 * Translate a WHERE clause that contains subquery dependency placeholders.
 * Placeholders are { _depPlaceholder: depId, field: 'userId', op: '$in' }.
 * These are stored in the $match stage and replaced by the executor at runtime.
 */
function translateModifiedWhere(node: Record<string, unknown>, deps: Dependency[]): Record<string, unknown> {
  if (!node || typeof node !== 'object') return {};

  // Check if this IS a placeholder
  if (node['_depPlaceholder']) {
    const depId = node['_depPlaceholder'] as string;
    const field = node['field'] as string;
    const op = node['op'] as string;
    // Store a marker the executor can find and replace
    return { [field]: { [op]: { __depRef: depId } } };
  }

  // Otherwise, translate normally but recurse for nested AND/OR
  const type = node['type'] as string;
  if (type === 'binary_expr') {
    const operator = (node['operator'] as string || '').toUpperCase();
    if (operator === 'AND') {
      const left = translateModifiedWhere(node['left'] as Record<string, unknown>, deps);
      const right = translateModifiedWhere(node['right'] as Record<string, unknown>, deps);
      return { $and: [left, right] };
    }
    if (operator === 'OR') {
      const left = translateModifiedWhere(node['left'] as Record<string, unknown>, deps);
      const right = translateModifiedWhere(node['right'] as Record<string, unknown>, deps);
      return { $or: [left, right] };
    }
  }

  // Fall back to normal WHERE translation for non-placeholder parts
  return translateWhere(node);
}

function planInsert(ast: Record<string, unknown>, _sql: string): ExecutionPlan {
  const writeOps = translateInsert(ast);
  // For INSERT...SELECT, writeOps may be empty — extract collection from table directly
  const tableArr = ast['table'] as Array<Record<string, unknown>> | undefined;
  const tableFromAst = tableArr && tableArr.length > 0 ? tableArr[0]!['table'] as string : undefined;
  const collection = writeOps[0]?.collection ?? tableFromAst ?? 'unknown';

  // Check for INSERT INTO ... SELECT
  // node-sql-parser puts the SELECT inside ast['values'] when type === 'select'
  const rawValues = ast['values'] as Record<string, unknown> | undefined;
  const valuesIsSelect = rawValues?.['type'] === 'select';
  const select = ast['select'] ?? ast['query'] ?? (valuesIsSelect ? rawValues : undefined) as Record<string, unknown> | undefined;
  const dependencies: Dependency[] = [];

  if (select) {
    const selectAst = (select as Record<string, unknown>)['ast'] ?? select;
    const subCollection = extractCollection(selectAst as Record<string, unknown>);
    const subPipeline = buildSelectPipeline(selectAst as Record<string, unknown>);
    dependencies.push({
      id: 'insert_select',
      type: 'insert-select',
      collection: subCollection,
      pipeline: subPipeline,
      injectAs: 'cte-result',
      targetField: collection,
    });
  }

  return {
    type: 'insert',
    collection,
    dependencies,
    pipelines: [],
    parallel: false,
    isAggregate: false,
    isTransaction: false,
    writeOps,
  };
}

function planUpdate(ast: Record<string, unknown>, _sql: string): ExecutionPlan {
  const writeOps = translateUpdate(ast);
  const collection = writeOps[0]?.collection ?? 'unknown';

  return {
    type: 'update',
    collection,
    dependencies: [],
    pipelines: [],
    parallel: false,
    isAggregate: false,
    isTransaction: false,
    writeOps,
  };
}

function planDelete(ast: Record<string, unknown>, _sql: string): ExecutionPlan {
  const writeOps = translateDelete(ast);
  const collection = writeOps[0]?.collection ?? 'unknown';

  return {
    type: 'delete',
    collection,
    dependencies: [],
    pipelines: [],
    parallel: false,
    isAggregate: false,
    isTransaction: false,
    writeOps,
  };
}
