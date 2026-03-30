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
 *
 * A recursive CTE has UNION ALL between a base case and a recursive case.
 * The recursive case has a self-join: JOIN hierarchy h ON e.manager_id = h.id
 * We extract connectFromField / connectToField from that JOIN ON clause.
 *
 * If the recursive part has a JOIN but the ON clause fields can't be determined,
 * we throw a descriptive error rather than producing wrong hardcoded values.
 * If the AST is too minimal to contain a JOIN (e.g. simple base-case-only SELECT),
 * we fall back to extracting field names from the SELECT columns, or use generic defaults.
 */
function buildGraphLookup(ast: Record<string, unknown>, _collection: string): Record<string, unknown> | null {
  const from = ast['from'] as Array<Record<string, unknown>> | undefined;
  if (!from || from.length === 0) return null;

  const baseCollection = from[0]!['table'] as string;

  // Try to extract fields from the UNION ALL recursive structure.
  const result = tryExtractRecursiveJoinFields(ast);

  if (result.type === 'error') {
    // Found a recursive JOIN structure but couldn't extract fields — throw a clear error
    throw new Error(
      'WITH RECURSIVE: Cannot extract connectFromField/connectToField from the recursive CTE. ' +
      'The recursive part must have a self-JOIN with an ON clause (e.g. ON e.manager_id = h.id). ' +
      'Ensure the recursive CTE follows the standard pattern: base case UNION ALL recursive case with self-join.',
    );
  }

  const connectFields = result.type === 'found' ? result.fields : extractFieldsFromColumns(ast);

  return {
    $graphLookup: {
      from: baseCollection,
      startWith: `$${connectFields.connectFromField}`,
      connectFromField: connectFields.connectFromField,
      connectToField: connectFields.connectToField,
      as: 'hierarchy',
      depthField: 'level',
    },
  };
}

type ExtractResult =
  | { type: 'found'; fields: { connectFromField: string; connectToField: string } }
  | { type: 'not-found' } // No join structure found — use fallback
  | { type: 'error' };   // Join found but fields couldn't be extracted

/**
 * Try to extract connectFromField and connectToField from a recursive CTE's AST.
 *
 * Returns:
 *   - 'found' with fields extracted from the JOIN ON clause
 *   - 'not-found' if no join structure exists (use column-based fallback)
 *   - 'error' if a join exists but fields can't be determined (throw)
 *
 * For a pattern like:
 *   SELECT e.id, e.name, e.manager_id FROM employees e JOIN hierarchy h ON e.manager_id = h.id
 * connectToField = 'manager_id' (child's linking field, references the CTE alias)
 * connectFromField = 'id' (parent's field, referenced by connectToField)
 */
function tryExtractRecursiveJoinFields(ast: Record<string, unknown>): ExtractResult {
  const candidate = findRecursivePart(ast);
  if (!candidate) return { type: 'not-found' };

  const from = candidate['from'] as Array<Record<string, unknown>> | undefined;
  if (!from || from.length < 2) return { type: 'not-found' };

  // Look through join entries for a JOIN with an ON clause
  for (let i = 1; i < from.length; i++) {
    const joinEntry = from[i] as Record<string, unknown>;
    const on = joinEntry['on'] as Record<string, unknown> | undefined;
    if (!on) continue;

    // Extract the ON clause fields: ON e.manager_id = h.id
    const left = on['left'] as Record<string, unknown> | undefined;
    const right = on['right'] as Record<string, unknown> | undefined;
    if (!left || !right) return { type: 'error' };

    const leftField = left['column'] as string | undefined;
    const rightField = right['column'] as string | undefined;
    const leftTable = left['table'] as string | undefined;
    const rightTable = right['table'] as string | undefined;

    if (!leftField || !rightField) return { type: 'error' };

    // The CTE self-reference alias is in joinEntry['table'] or joinEntry['as']
    const joinTable = joinEntry['table'] as string | undefined;
    const joinAlias = joinEntry['as'] as string | undefined;
    const cteRef = joinAlias ?? joinTable;

    // Determine which side references the CTE alias (the "parent" side → connectFromField)
    // and which side is the child's linking field (connectToField)
    if (cteRef && (rightTable === cteRef)) {
      // right side = CTE (parent), left side = child's linking field
      // ON e.manager_id = h.id → connectToField = manager_id, connectFromField = id
      return { type: 'found', fields: { connectFromField: rightField, connectToField: leftField } };
    } else if (cteRef && (leftTable === cteRef)) {
      // left side = CTE (parent), right side = child's linking field
      // ON h.id = e.manager_id → connectToField = manager_id, connectFromField = id
      return { type: 'found', fields: { connectFromField: leftField, connectToField: rightField } };
    } else {
      // Fallback: can't determine CTE alias — use positional assumption
      // Left is typically the main table's field (connectToField), right is CTE's field (connectFromField)
      return { type: 'found', fields: { connectFromField: rightField, connectToField: leftField } };
    }
  }

  // Has joins but none with an ON clause we can parse
  return { type: 'error' };
}

/**
 * Fallback: extract field names from SELECT columns when no JOIN is available.
 * For minimal ASTs, picks the first two column names or returns generic defaults.
 */
function extractFieldsFromColumns(ast: Record<string, unknown>): { connectFromField: string; connectToField: string } {
  const columns = ast['columns'] as Array<Record<string, unknown>> | undefined;
  const fieldNames: string[] = [];

  if (Array.isArray(columns)) {
    for (const col of columns) {
      const expr = col['expr'] as Record<string, unknown> | undefined;
      if (expr?.['type'] === 'column_ref') {
        const colName = expr['column'] as string | undefined;
        if (colName && colName !== '*') fieldNames.push(colName);
      }
      const alias = col['as'] as string | undefined;
      if (alias) fieldNames.push(alias);
    }
  }

  // Use first column as connectFromField, second as connectToField if available
  const connectFromField = fieldNames[0] ?? 'id';
  const connectToField = fieldNames[1] ?? 'parent_id';
  return { connectFromField, connectToField };
}

/**
 * Find the recursive SELECT part of a UNION ALL structure.
 * In a recursive CTE: base_case UNION ALL recursive_case
 * The recursive part is the one that contains a JOIN back to the CTE.
 */
function findRecursivePart(ast: Record<string, unknown>): Record<string, unknown> | null {
  // If this node has a '_next' property, it's part of a UNION ALL chain
  const unionNext = ast['_next'] as Record<string, unknown> | undefined;
  const unionVal = ast['union'] as Record<string, unknown> | undefined;

  if (unionNext) {
    // Try the second part of the union first (recursive part)
    const from = unionNext['from'] as Array<Record<string, unknown>> | undefined;
    if (from && from.length > 1) return unionNext;
    // Otherwise try this node
    const thisFrom = ast['from'] as Array<Record<string, unknown>> | undefined;
    if (thisFrom && thisFrom.length > 1) return ast;
    return null;
  }

  if (unionVal) {
    const from = unionVal['from'] as Array<Record<string, unknown>> | undefined;
    if (from && from.length > 1) return unionVal;
  }

  // Direct AST — check if it has a join
  const from = ast['from'] as Array<Record<string, unknown>> | undefined;
  if (from && from.length > 1) return ast;

  return null;
}
