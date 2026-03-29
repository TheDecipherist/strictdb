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
    data = [receipt as unknown as Record<string, unknown>];
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

  // For IN/NIN subqueries, extract the values from the first field of each result
  let injectedValues: unknown[];
  if (dep.injectAs === 'in' || dep.injectAs === 'nin') {
    injectedValues = depResults.map(r => {
      const keys = Object.keys(r).filter(k => k !== '_id');
      return keys.length > 0 ? r[keys[0]!] : r['_id'];
    });
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
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const inner = value as Record<string, unknown>;
      // Check for __depRef marker
      if (inner['__depRef']) {
        const depId = inner['__depRef'] as string;
        const vals = resolved.get(depId) ?? [];
        result[key] = vals;
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
