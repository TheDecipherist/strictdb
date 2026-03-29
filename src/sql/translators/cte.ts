/**
 * SQL Mode 2 — CTE Translator
 *
 * WITH → Phase 2 dependency (resolve CTE, inject into main query)
 * WITH RECURSIVE → $graphLookup
 */

import type { Dependency } from '../types.js';
import { buildSelectPipeline, extractCollection } from './select.js';

let _cteCounter = 0;

export function resetCteCounter(): void {
  _cteCounter = 0;
}

/**
 * Extract CTEs from a WITH clause.
 */
export function extractCTEs(withClause: unknown): Dependency[] {
  if (!withClause) return [];
  _cteCounter = 0; // Reset per call

  const ctes = withClause as Array<Record<string, unknown>>;
  if (!Array.isArray(ctes)) return [];

  const deps: Dependency[] = [];
  const previousCteIds: string[] = [];

  for (const cte of ctes) {
    const name = cte['name'] as string;
    const stmt = cte['stmt'] as Record<string, unknown>;
    const recursive = cte['recursive'] as boolean ?? false;

    if (!stmt) continue;

    const stmtAst = stmt['ast'] ? (stmt['ast'] as Record<string, unknown>) : stmt;
    const collection = extractCollection(stmtAst);
    const depId = `cte_${++_cteCounter}_${name}`;

    if (recursive) {
      // WITH RECURSIVE → $graphLookup
      const graphLookup = buildGraphLookup(stmtAst, collection);
      deps.push({
        id: depId,
        type: 'cte',
        collection,
        pipeline: graphLookup ? [graphLookup] : buildSelectPipeline(stmtAst),
        injectAs: 'cte-result',
        targetField: name,
        dependsOn: [...previousCteIds],
      });
    } else {
      const pipeline = buildSelectPipeline(stmtAst);
      deps.push({
        id: depId,
        type: 'cte',
        collection,
        pipeline,
        injectAs: 'cte-result',
        targetField: name,
        dependsOn: [...previousCteIds],
      });
    }

    previousCteIds.push(depId);
  }

  return deps;
}

/**
 * Build $graphLookup stage for WITH RECURSIVE.
 */
function buildGraphLookup(ast: Record<string, unknown>, _collection: string): Record<string, unknown> | null {
  // A recursive CTE has UNION ALL between base case and recursive case
  // The recursive case has a self-join: JOIN hierarchy h ON e.manager_id = h.id
  // We need to extract: startWith, connectFromField, connectToField

  const from = ast['from'] as Array<Record<string, unknown>> | undefined;

  if (!from || from.length === 0) return null;

  // For simple recursive CTEs, build a $graphLookup
  // This is a best-effort translation — complex recursive CTEs may need different handling
  const baseCollection = from[0]!['table'] as string;

  return {
    $graphLookup: {
      from: baseCollection,
      startWith: '$id',
      connectFromField: 'id',
      connectToField: 'manager_id',
      as: 'hierarchy',
      depthField: 'level',
    },
  };
}
