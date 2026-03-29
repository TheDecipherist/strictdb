/**
 * SQL Mode 2 — Explain
 *
 * Formats execution plans for developer inspection.
 */

import type { ExplainPlan, ExecutionPlan } from './types.js';

/**
 * Build an explain plan from an execution plan (without actually executing).
 */
export function buildExplainPlan(plan: ExecutionPlan): ExplainPlan {
  return {
    phases: plan.dependencies.length > 0 ? 2 : 1,
    dependencies: plan.dependencies.map(d => ({
      type: d.type,
      collection: d.collection,
      pipeline: d.pipeline,
      resultCount: 0, // Not yet executed
    })),
    pipelines: plan.pipelines.map(p => ({
      collection: p.collection,
      stages: p.stages,
    })),
    parallel: plan.parallel,
    durationMs: 0,
  };
}
