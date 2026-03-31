/**
 * SQL Mode 2 — JOIN Translator
 *
 * INNER JOIN → $lookup + $unwind
 * LEFT JOIN → $lookup + $unwind (preserveNullAndEmptyArrays: true)
 * RIGHT JOIN → swap collections, LEFT JOIN
 * FULL OUTER JOIN → two pipelines merged
 * CROSS JOIN → $lookup with empty pipeline (cartesian product)
 */

import type { JoinInfo, JoinCondition, PipelineDef } from '../types.js';

export interface JoinResult {
  stages: Record<string, unknown>[];
  /** For FULL OUTER JOINs, the second pipelines (one per FULL OUTER JOIN) */
  secondPipelines?: PipelineDef[];
  /** The main collection (may be swapped for RIGHT JOIN) */
  mainCollection?: string;
}

/**
 * Extract JOIN info from AST FROM clause.
 */
export function extractJoins(from: unknown): JoinInfo[] {
  if (!Array.isArray(from)) return [];

  const joins: JoinInfo[] = [];
  for (let i = 1; i < from.length; i++) {
    const item = from[i] as Record<string, unknown>;
    const joinType = normalizeJoinType(item['join'] as string);
    const table = item['table'] as string;
    const alias = item['as'] as string | null;
    const on = item['on'] as Record<string, unknown> | null;

    // CROSS JOIN has no ON clause
    if (joinType === 'cross') {
      joins.push({
        type: 'cross',
        table,
        alias: alias ?? undefined,
        localField: '',
        foreignField: '',
      });
      continue;
    }

    if (on) {
      const conditions = extractJoinConditions(on, table, alias);

      if (conditions.length === 1) {
        // Single condition — use simple localField/foreignField
        joins.push({
          type: joinType,
          table,
          alias: alias ?? undefined,
          localField: conditions[0]!.localField,
          foreignField: conditions[0]!.foreignField,
        });
      } else {
        // Multi-condition ON — store all conditions
        joins.push({
          type: joinType,
          table,
          alias: alias ?? undefined,
          localField: conditions[0]!.localField,
          foreignField: conditions[0]!.foreignField,
          conditions,
        });
      }
    }
  }

  return joins;
}

/**
 * Extract all equality conditions from an ON clause (handles AND-chained conditions).
 * Returns an array of { localField, foreignField } pairs with correct local/foreign orientation.
 */
function extractJoinConditions(
  on: Record<string, unknown>,
  joinTable: string,
  joinAlias: string | null,
): JoinCondition[] {
  const rawPairs = collectEqualityPairs(on);
  const conditions: JoinCondition[] = [];

  for (const pair of rawPairs) {
    // Determine which side is local vs foreign
    let localField: string;
    let foreignField: string;
    if (pair.rightTable === joinTable || pair.rightTable === joinAlias) {
      localField = pair.leftField;
      foreignField = pair.rightField;
    } else if (pair.leftTable === joinTable || pair.leftTable === joinAlias) {
      localField = pair.rightField;
      foreignField = pair.leftField;
    } else {
      // Fallback: assume left=local, right=foreign
      localField = pair.leftField;
      foreignField = pair.rightField;
    }
    conditions.push({ localField, foreignField });
  }

  return conditions;
}

interface RawFieldPair {
  leftTable?: string;
  leftField: string;
  rightTable?: string;
  rightField: string;
}

/**
 * Recursively collect all equality pairs from an ON clause.
 * Handles: single `=` condition, or AND-chained conditions.
 */
function collectEqualityPairs(node: Record<string, unknown>): RawFieldPair[] {
  const operator = (node['operator'] as string || '').toUpperCase();

  if (operator === 'AND') {
    const left = node['left'] as Record<string, unknown>;
    const right = node['right'] as Record<string, unknown>;
    return [...collectEqualityPairs(left), ...collectEqualityPairs(right)];
  }

  if (operator === '=') {
    const left = node['left'] as Record<string, unknown>;
    const right = node['right'] as Record<string, unknown>;
    return [{
      leftTable: left?.['table'] as string | undefined,
      leftField: left?.['column'] as string ?? 'unknown',
      rightTable: right?.['table'] as string | undefined,
      rightField: right?.['column'] as string ?? 'unknown',
    }];
  }

  // Fallback for unknown structure
  return [{
    leftTable: (node['left'] as Record<string, unknown>)?.['table'] as string | undefined,
    leftField: (node['left'] as Record<string, unknown>)?.['column'] as string ?? 'unknown',
    rightTable: (node['right'] as Record<string, unknown>)?.['table'] as string | undefined,
    rightField: (node['right'] as Record<string, unknown>)?.['column'] as string ?? 'unknown',
  }];
}

function normalizeJoinType(join: string | undefined): 'inner' | 'left' | 'right' | 'full' | 'cross' {
  if (!join) return 'inner';
  const upper = join.toUpperCase();
  if (upper.includes('CROSS')) return 'cross';
  if (upper.includes('LEFT')) return 'left';
  if (upper.includes('RIGHT')) return 'right';
  if (upper.includes('FULL') || upper.includes('OUTER')) return 'full';
  if (upper.includes('INNER') || upper.includes('JOIN')) return 'inner';
  return 'inner';
}

/**
 * Translate JOINs into pipeline stages.
 * @param pushdownFilters — optional map of join alias/table → MongoDB filter to push into $lookup pipeline
 */
export function translateJoins(
  from: unknown,
  mainCollection: string,
  pushdownFilters?: Map<string, Record<string, unknown>>,
): JoinResult {
  const joins = extractJoins(from);
  if (joins.length === 0) return { stages: [] };

  const stages: Record<string, unknown>[] = [];
  let currentMainCollection = mainCollection;
  // Track the current main table's alias (for RIGHT JOIN swap)
  const fromArr = from as Array<Record<string, unknown>> | undefined;
  let currentMainAlias = (fromArr?.[0]?.['as'] as string) ?? mainCollection;
  const secondPipelines: PipelineDef[] = [];

  for (const join of joins) {
    // Get any pushdown filter for this join table
    const pushdown = pushdownFilters?.get(join.alias ?? join.table);

    // CROSS JOIN: cartesian product via $lookup with empty pipeline
    if (join.type === 'cross') {
      stages.push({
        $lookup: {
          from: join.table,
          pipeline: [],
          as: join.alias ?? join.table,
        },
      });
      stages.push({ $unwind: `$${join.alias ?? join.table}` });
      continue;
    }

    if (join.type === 'right') {
      // RIGHT JOIN: swap collections, use LEFT JOIN logic
      // The original main (e.g. "users" aliased "u") becomes the looked-up table,
      // stored under its original alias so projections like u.name resolve correctly.
      const lookupStages = buildLookupStages(
        currentMainCollection, // The original main becomes the "from" in $lookup
        join.foreignField,
        join.localField,
        currentMainAlias,      // Store looked-up data under the original main's alias
        true, // preserveNullAndEmptyArrays for LEFT
        pushdown,
        join.conditions ? reverseConditions(join.conditions) : undefined,
      );
      // Swapped: main collection is now the join table
      currentMainCollection = join.table;
      currentMainAlias = join.alias ?? join.table;
      stages.push(...lookupStages);
      continue;
    }

    if (join.type === 'full') {
      // FULL OUTER JOIN: two pipelines
      // Pipeline 1: LEFT JOIN from main
      const leftStages = buildLookupStages(
        join.table,
        join.localField,
        join.foreignField,
        join.alias ?? join.table,
        true,
        pushdown,
        join.conditions,
      );
      stages.push(...leftStages);

      // Pipeline 2: right-only (documents in right with no match in left)
      const rightOnlyStages: Record<string, unknown>[] = [
        {
          $lookup: {
            from: currentMainCollection,
            localField: join.foreignField,
            foreignField: join.localField,
            as: `_left_match`,
          },
        },
        { $match: { _left_match: { $size: 0 } } },
        { $project: { _left_match: 0 } },
      ];

      secondPipelines.push({
        collection: join.table,
        stages: rightOnlyStages,
      });

      continue;
    }

    // INNER JOIN or LEFT JOIN
    const preserveNull = join.type === 'left';
    const lookupStages = buildLookupStages(
      join.table,
      join.localField,
      join.foreignField,
      join.alias ?? join.table,
      preserveNull,
      pushdown,
      join.conditions,
    );
    stages.push(...lookupStages);
  }

  return {
    stages,
    secondPipelines: secondPipelines.length > 0 ? secondPipelines : undefined,
    mainCollection: currentMainCollection,
  };
}

/**
 * Split a WHERE AST into conditions for the main table vs joined tables.
 * Returns main-table conditions and a map of joinAlias → conditions for pushdown.
 */
export function splitWhereByTable(
  where: unknown,
  mainAliases: Set<string>,
  joinAliases: Set<string>,
): { mainWhere: unknown; pushdownMap: Map<string, Record<string, unknown>> } {
  const pushdownMap = new Map<string, Record<string, unknown>>();
  const mainWhere = filterWhereNode(where as Record<string, unknown>, mainAliases, joinAliases, pushdownMap);
  return { mainWhere, pushdownMap };
}

/**
 * Recursively walk a WHERE AST, collecting join-table conditions into the pushdownMap.
 * Returns the filtered WHERE node with join-table conditions removed (or null if entirely consumed).
 */
function filterWhereNode(
  node: Record<string, unknown> | undefined | null,
  mainAliases: Set<string>,
  joinAliases: Set<string>,
  pushdownMap: Map<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null;

  const type = node['type'] as string;
  if (type !== 'binary_expr') return node;

  const operator = (node['operator'] as string || '').toUpperCase();

  // For AND, split left and right independently
  if (operator === 'AND') {
    const left = filterWhereNode(node['left'] as Record<string, unknown>, mainAliases, joinAliases, pushdownMap);
    const right = filterWhereNode(node['right'] as Record<string, unknown>, mainAliases, joinAliases, pushdownMap);
    if (!left && !right) return null;
    if (!left) return right;
    if (!right) return left;
    return { ...node, left, right };
  }

  // For OR, we can't split — keep as main WHERE
  if (operator === 'OR') return node;

  // Check if this condition references a join table
  // IS NULL / IS NOT NULL on joined fields = anti-join pattern → keep as post-join filter
  if (operator === 'IS' || operator === 'IS NOT') {
    return node; // Never push down IS NULL checks — they're anti-join patterns
  }

  const joinAlias = getConditionJoinAlias(node, joinAliases);
  if (joinAlias) {
    // Collect this condition for pushdown — strip the table prefix from the field
    const stripped = stripTablePrefix(node, joinAlias);
    const existing = pushdownMap.get(joinAlias);
    if (existing) {
      pushdownMap.set(joinAlias, { $and: [existing, stripped] });
    } else {
      pushdownMap.set(joinAlias, stripped);
    }
    return null; // Remove from main WHERE
  }

  return node;
}

/**
 * Check if a binary_expr condition exclusively references a join table.
 * Returns the join alias if so, undefined otherwise.
 */
function getConditionJoinAlias(
  node: Record<string, unknown>,
  joinAliases: Set<string>,
): string | undefined {
  const left = node['left'] as Record<string, unknown>;
  if (left?.['type'] === 'column_ref') {
    const table = left['table'] as string | null;
    if (table && joinAliases.has(table)) return table;
  }
  return undefined;
}

/**
 * Strip the table prefix from a condition's column_ref so it works inside a $lookup pipeline.
 * E.g., o.status = 'delivered' → status = 'delivered' (since inside $lookup, fields are local).
 */
function stripTablePrefix(node: Record<string, unknown>, _alias: string): Record<string, unknown> {
  const left = node['left'] as Record<string, unknown>;
  if (left?.['type'] === 'column_ref' && left['table']) {
    return { ...node, left: { ...left, table: null } };
  }
  return node;
}

/**
 * Reverse conditions (swap local/foreign) for RIGHT JOIN collection swap.
 */
function reverseConditions(conditions: JoinCondition[]): JoinCondition[] {
  return conditions.map(c => ({ localField: c.foreignField, foreignField: c.localField }));
}

function buildLookupStages(
  fromCollection: string,
  localField: string,
  foreignField: string,
  asField: string,
  preserveNull: boolean,
  pushdownFilter?: Record<string, unknown>,
  conditions?: JoinCondition[],
): Record<string, unknown>[] {
  const stages: Record<string, unknown>[] = [];

  // Multi-condition ON: always use pipeline form
  if (conditions && conditions.length > 1) {
    const letVars: Record<string, string> = {};
    const matchExprs: Record<string, unknown>[] = [];

    for (const cond of conditions) {
      const varName = `local_${cond.localField.replace(/\./g, '_')}`;
      letVars[varName] = `$${cond.localField}`;
      matchExprs.push({ $eq: [`$${cond.foreignField}`, `$$${varName}`] });
    }

    const pipelineStages: Record<string, unknown>[] = [
      { $match: { $expr: matchExprs.length === 1 ? matchExprs[0] : { $and: matchExprs } } },
    ];

    if (pushdownFilter && Object.keys(pushdownFilter).length > 0) {
      pipelineStages.push({ $match: pushdownFilter });
    }

    stages.push({
      $lookup: {
        from: fromCollection,
        let: letVars,
        pipeline: pipelineStages,
        as: asField,
      },
    });
  } else if (pushdownFilter && Object.keys(pushdownFilter).length > 0) {
    // Use pipeline form of $lookup for filter pushdown
    stages.push({
      $lookup: {
        from: fromCollection,
        let: { [`local${localField.charAt(0).toUpperCase()}${localField.slice(1)}`]: `$${localField}` },
        pipeline: [
          { $match: { $expr: { $eq: [`$${foreignField}`, `$$local${localField.charAt(0).toUpperCase()}${localField.slice(1)}`] } } },
          { $match: pushdownFilter },
        ],
        as: asField,
      },
    });
  } else {
    stages.push({
      $lookup: {
        from: fromCollection,
        localField,
        foreignField,
        as: asField,
      },
    });
  }

  if (preserveNull) {
    stages.push({
      $unwind: {
        path: `$${asField}`,
        preserveNullAndEmptyArrays: true,
      },
    });
  } else {
    stages.push({ $unwind: `$${asField}` });
  }

  return stages;
}
