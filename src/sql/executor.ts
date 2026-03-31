/**
 * SQL Mode 2 — Executor
 *
 * Three-phase execution engine:
 * Phase 1: Parse + Plan (done before executor)
 * Phase 2: Resolve Dependencies (subqueries, CTEs)
 * Phase 3: Build & Execute pipelines
 */

import type { ExecutionPlan, Dependency, DependencyInfo, SqlMode2Result, WriteOperation } from './types.js';
import type { OperationReceipt } from '../types.js';

/**
 * Adapter interface for the executor — abstracts away the actual MongoDB calls.
 */
export interface SqlExecutorAdapter {
  aggregate(collection: string, pipeline: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;
  bulkWrite(collection: string, ops: WriteOperation[]): Promise<OperationReceipt>;
  /** Mutable — set by executor after INSERT to scope last insert ID per instance. */
  lastInsertId?: string;
  /** Guardrail config — passed from StrictDB instance */
  guardrails?: {
    limitRequired: boolean;
    emptyFilter: boolean;
    nullComparison: boolean;
  };
}

/** Get the last inserted ID for the given adapter (for LAST_INSERT_ID() function). */
export function getLastInsertId(adapter: SqlExecutorAdapter): string | undefined {
  return adapter.lastInsertId;
}

/**
 * Execute a plan against a database adapter.
 */
export async function executePlan(
  plan: ExecutionPlan,
  adapter: SqlExecutorAdapter,
  explain: boolean = false,
): Promise<SqlMode2Result> {
  const startTime = Date.now();
  const depInfos: DependencyInfo[] = [];

  // Phase 2: Resolve dependencies
  const resolvedDeps = new Map<string, unknown[]>();

  if (plan.dependencies.length > 0) {
    await resolveDependencies(plan.dependencies, adapter, resolvedDeps, depInfos);
  }

  // Phase 3: Execute
  let data: Record<string, unknown>[];

  if (plan.type === 'select') {
    data = await executeSelect(plan, adapter, resolvedDeps);
  } else {
    // Write operations
    const receipt = await executeWrite(plan, adapter, resolvedDeps);

    // Track last insert ID for LAST_INSERT_ID() support (scoped to this adapter instance)
    const receiptObj = receipt as unknown as Record<string, unknown>;
    if (receiptObj['insertedId']) {
      adapter.lastInsertId = receiptObj['insertedId'] as string;
    }

    // Handle RETURNING clause — query back the inserted row(s)
    const writeOps = plan.writeOps ?? [];
    const returningCols = writeOps[0]?.returning;
    if (returningCols && receiptObj['insertedId']) {
      const insertedId = receiptObj['insertedId'] as string;
      const pipeline: Record<string, unknown>[] = [
        { $match: { _id: { $oid: insertedId } } },
      ];
      if (returningCols[0] !== '*') {
        const project: Record<string, unknown> = { _id: 0 };
        for (const col of returningCols) project[col] = 1;
        pipeline.push({ $project: project });
      }
      data = await adapter.aggregate(plan.collection, pipeline);
    } else if (returningCols && receiptObj['insertedIds']) {
      // insertMany with RETURNING — query back all inserted docs
      const ids = receiptObj['insertedIds'] as string[];
      const pipeline: Record<string, unknown>[] = [
        { $match: { _id: { $in: ids.map(id => ({ $oid: id })) } } },
      ];
      if (returningCols[0] !== '*') {
        const project: Record<string, unknown> = { _id: 0 };
        for (const col of returningCols) project[col] = 1;
        pipeline.push({ $project: project });
      }
      data = await adapter.aggregate(plan.collection, pipeline);
    } else {
      data = [receiptObj];
    }
  }

  // Replace __lastInsertId markers with actual value (for SELECT LAST_INSERT_ID())
  if (data.length > 0) {
    for (const row of data) {
      for (const [key, val] of Object.entries(row)) {
        if (val && typeof val === 'object' && (val as Record<string, unknown>)['__lastInsertId']) {
          row[key] = adapter.lastInsertId ?? null;
        }
      }
    }
  }

  // Strip MongoDB _id from SQL results when it's not a real document field:
  // - null (aggregate without GROUP BY)
  // - duplicated by another column (GROUP BY key aliased in SELECT)
  // Keep it when it's a real ObjectId from SELECT *
  if (plan.type === 'select' && data.length > 0) {
    for (const row of data) {
      if (!('_id' in row)) continue;
      const id = row['_id'];
      if (id === null) {
        delete row['_id'];
      } else if (typeof id !== 'object') {
        // Primitive _id (string/number from GROUP BY) — remove if another field has the same value
        const otherValues = Object.entries(row).filter(([k]) => k !== '_id').map(([, v]) => v);
        if (otherValues.includes(id)) {
          delete row['_id'];
        }
      }
    }
  }

  const durationMs = Date.now() - startTime;

  const result: SqlMode2Result = { data };

  if (explain) {
    // Show the resolved pipeline (with actual dependency values injected)
    const resolvedStages = plan.pipelines.map(p => ({
      collection: p.collection,
      stages: injectDepValues(p.stages, resolvedDeps),
    }));

    result.plan = {
      phases: plan.dependencies.length > 0 ? 2 : 1,
      dependencies: depInfos,
      pipelines: resolvedStages,
      parallel: plan.parallel,
      durationMs,
    };
  }

  return result;
}

async function resolveDependencies(
  deps: Dependency[],
  adapter: SqlExecutorAdapter,
  results: Map<string, unknown[]>,
  infos: DependencyInfo[],
): Promise<void> {
  // Sort dependencies — those with dependsOn must wait
  const resolved = new Set<string>();
  const pending = [...deps];

  while (pending.length > 0) {
    // Find deps that can be resolved now (no unresolved dependencies)
    const ready = pending.filter(d =>
      !d.dependsOn || d.dependsOn.every(id => resolved.has(id)),
    );

    if (ready.length === 0) {
      // Circular dependency or missing dep — resolve remaining sequentially
      for (const dep of pending) {
        await resolveSingleDep(dep, adapter, results, infos);
        resolved.add(dep.id);
      }
      break;
    }

    // Resolve ready deps in parallel
    await Promise.all(ready.map(async (dep) => {
      await resolveSingleDep(dep, adapter, results, infos);
      resolved.add(dep.id);
    }));

    // Remove resolved from pending
    for (const r of ready) {
      const idx = pending.indexOf(r);
      if (idx >= 0) pending.splice(idx, 1);
    }
  }
}

async function resolveSingleDep(
  dep: Dependency,
  adapter: SqlExecutorAdapter,
  results: Map<string, unknown[]>,
  infos: DependencyInfo[],
): Promise<void> {
  const depResults = await adapter.aggregate(dep.collection, dep.pipeline);

  // Extract values based on injection type
  let injectedValues: unknown[];
  if (dep.injectAs === 'in' || dep.injectAs === 'nin') {
    // IN/NIN: extract the target field value from each result row
    injectedValues = depResults.map(r => {
      const keys = Object.keys(r).filter(k => k !== '_id');
      return keys.length > 0 ? r[keys[0]!] : r['_id'];
    });
  } else if (dep.injectAs === 'scalar') {
    // Scalar subquery: extract a single value from the first result
    // e.g., SELECT AVG(age) → [{ _id: null, avg: 48.4 }] → [48.4]
    if (depResults.length > 0) {
      const row = depResults[0]!;
      const keys = Object.keys(row).filter(k => k !== '_id');
      const scalarValue = keys.length > 0 ? row[keys[0]!] : row['_id'];
      injectedValues = [scalarValue];
    } else {
      injectedValues = [null];
    }
  } else {
    injectedValues = depResults;
  }

  results.set(dep.id, injectedValues);

  infos.push({
    type: dep.type,
    collection: dep.collection,
    pipeline: dep.pipeline,
    resultCount: depResults.length,
  });
}

async function executeSelect(
  plan: ExecutionPlan,
  adapter: SqlExecutorAdapter,
  resolvedDeps: Map<string, unknown[]>,
): Promise<Record<string, unknown>[]> {
  if (plan.pipelines.length === 0) return [];

  // Inject resolved dependency values into pipeline stages
  const resolvedPipelines = plan.pipelines.map(p => ({
    ...p,
    stages: injectDepValues(p.stages, resolvedDeps),
  }));

  if (plan.parallel && resolvedPipelines.length > 1) {
    const allResults = await Promise.all(
      resolvedPipelines.map(p => adapter.aggregate(p.collection, p.stages)),
    );
    return allResults.flat();
  }

  const mainPipeline = resolvedPipelines[0]!;
  return adapter.aggregate(mainPipeline.collection, mainPipeline.stages);
}

/**
 * Walk pipeline stages and replace { __depRef: depId } markers with actual resolved values.
 */
function injectDepValues(stages: Record<string, unknown>[], resolved: Map<string, unknown[]>): Record<string, unknown>[] {
  if (resolved.size === 0) return stages;
  return stages.map(stage => injectInObject(stage, resolved));
}

function injectInObject(obj: Record<string, unknown>, resolved: Map<string, unknown[]>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Top-level EXISTS/NOT EXISTS markers (the key IS the marker)
  if (obj['__existsDepRef']) {
    const depId = obj['__existsDepRef'] as string;
    const vals = resolved.get(depId) ?? [];
    if (vals.length > 0) return {}; // EXISTS = true → empty match (match all)
    return { _id: { $type: 'undefined' } }; // EXISTS = false → match nothing
  }
  if (obj['__notExistsDepRef']) {
    const depId = obj['__notExistsDepRef'] as string;
    const vals = resolved.get(depId) ?? [];
    if (vals.length === 0) return {}; // NOT EXISTS = true → empty match (match all)
    return { _id: { $type: 'undefined' } }; // NOT EXISTS = false → match nothing
  }

  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const inner = value as Record<string, unknown>;
      // Check for __depRef marker (array injection for IN/NIN)
      if (inner['__depRef']) {
        const depId = inner['__depRef'] as string;
        const vals = resolved.get(depId) ?? [];
        result[key] = vals;
      } else if (inner['__scalarDepRef']) {
        const depId = inner['__scalarDepRef'] as string;
        const vals = resolved.get(depId) ?? [null];
        result[key] = vals[0] ?? null;
      } else if (inner['__existsDepRef']) {
        // EXISTS: resolve to true/false based on whether dependency returned results
        const depId = inner['__existsDepRef'] as string;
        const vals = resolved.get(depId) ?? [];
        if (vals.length > 0) {
          // EXISTS = true → match all (skip this condition)
          // Don't add anything to result — effectively a no-op filter
        } else {
          // EXISTS = false → match nothing
          result['_id'] = { $type: 'undefined' };
        }
      } else if (inner['__notExistsDepRef']) {
        // NOT EXISTS: inverted logic — true when subquery returns no results
        const depId = inner['__notExistsDepRef'] as string;
        const vals = resolved.get(depId) ?? [];
        if (vals.length === 0) {
          // NOT EXISTS = true (no results) → match all (skip this condition)
          // Don't add anything to result — effectively a no-op filter
        } else {
          // NOT EXISTS = false (results exist) → match nothing
          result['_id'] = { $type: 'undefined' };
        }
      } else {
        result[key] = injectInObject(inner, resolved);
      }
    } else if (Array.isArray(value)) {
      result[key] = value.map(v =>
        v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
          ? injectInObject(v as Record<string, unknown>, resolved)
          : v,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function executeWrite(
  plan: ExecutionPlan,
  adapter: SqlExecutorAdapter,
  resolvedDeps: Map<string, unknown[]>,
): Promise<OperationReceipt> {
  const writeOps = plan.writeOps ?? [];

  // For INSERT INTO ... SELECT, the resolved dep contains the documents
  if (plan.dependencies.length > 0) {
    for (const dep of plan.dependencies) {
      if (dep.type === 'insert-select') {
        const docs = resolvedDeps.get(dep.id) ?? [];
        const insertOps: WriteOperation[] = docs.map(doc => ({
          type: 'insertOne' as const,
          collection: plan.collection,
          document: doc as Record<string, unknown>,
        }));
        return adapter.bulkWrite(plan.collection, insertOps);
      }
    }
  }

  return adapter.bulkWrite(plan.collection, writeOps);
}
