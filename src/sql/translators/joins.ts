/**
 * SQL Mode 2 — JOIN Translator
 *
 * INNER JOIN → $lookup + $unwind
 * LEFT JOIN → $lookup + $unwind (preserveNullAndEmptyArrays: true)
 * RIGHT JOIN → swap collections, LEFT JOIN
 * FULL OUTER JOIN → two pipelines merged
 */

import type { JoinInfo, PipelineDef } from '../types.js';

export interface JoinResult {
  stages: Record<string, unknown>[];
  /** For FULL OUTER JOIN, the second pipeline */
  secondPipeline?: PipelineDef;
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
    const on = item['on'] as Record<string, unknown>;

    if (on) {
      const { leftTable, leftField, rightTable, rightField } = extractJoinFields(on);

      // Determine which side is local vs foreign by checking which table
      // reference matches the joined table (handles reversed ON clauses like ON b.id = a.fk)
      let localField: string;
      let foreignField: string;
      if (rightTable === table || rightTable === alias) {
        // Right side references the join table → left is local, right is foreign
        localField = leftField;
        foreignField = rightField;
      } else if (leftTable === table || leftTable === alias) {
        // Left side references the join table → right is local, left is foreign
        localField = rightField;
        foreignField = leftField;
      } else {
        // Fallback: assume left=local, right=foreign (original behavior)
        localField = leftField;
        foreignField = rightField;
      }

      joins.push({
        type: joinType,
        table,
        alias: alias ?? undefined,
        localField,
        foreignField,
      });
    }
  }

  return joins;
}

function normalizeJoinType(join: string | undefined): 'inner' | 'left' | 'right' | 'full' {
  if (!join) return 'inner';
  const upper = join.toUpperCase();
  if (upper.includes('LEFT')) return 'left';
  if (upper.includes('RIGHT')) return 'right';
  if (upper.includes('FULL') || upper.includes('OUTER')) return 'full';
  if (upper.includes('INNER') || upper.includes('JOIN')) return 'inner';
  return 'inner';
}

function extractJoinFields(on: Record<string, unknown>): { leftTable?: string; leftField: string; rightTable?: string; rightField: string } {
  const left = on['left'] as Record<string, unknown>;
  const right = on['right'] as Record<string, unknown>;
  return {
    leftTable: left?.['table'] as string | undefined,
    leftField: left?.['column'] as string ?? 'unknown',
    rightTable: right?.['table'] as string | undefined,
    rightField: right?.['column'] as string ?? 'unknown',
  };
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
  let secondPipeline: PipelineDef | undefined;

  for (const join of joins) {
    // Get any pushdown filter for this join table
    const pushdown = pushdownFilters?.get(join.alias ?? join.table);

    if (join.type === 'right') {
      // RIGHT JOIN: swap collections, use LEFT JOIN logic
      const lookupStages = buildLookupStages(
        currentMainCollection, // The original main becomes the "foreign"
        join.foreignField,
        join.localField,
        join.table,
        true, // preserveNullAndEmptyArrays for LEFT
        pushdown,
      );
      // Swapped: main collection is now the join table
      currentMainCollection = join.table;
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

      secondPipeline = {
        collection: join.table,
        stages: rightOnlyStages,
      };

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
    );
    stages.push(...lookupStages);
  }

  return { stages, secondPipeline, mainCollection: currentMainCollection };
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

function buildLookupStages(
  fromCollection: string,
  localField: string,
  foreignField: string,
  asField: string,
  preserveNull: boolean,
  pushdownFilter?: Record<string, unknown>,
): Record<string, unknown>[] {
  const stages: Record<string, unknown>[] = [];

  if (pushdownFilter && Object.keys(pushdownFilter).length > 0) {
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
