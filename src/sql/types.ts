/**
 * SQL Mode 2 — Types
 *
 * All types for the SQL execution engine.
 */

// ─── Public API Types ───────────────────────────────────────────────────────

export type SqlMode2Dialect = 'mysql' | 'postgresql' | 'mariadb' | 'sqlite' | 'bigquery';

export interface SqlOptions {
  /** Parameterized query values — supports both MySQL (?) and PostgreSQL ($1) style */
  params?: unknown[];
  /** SQL dialect for the parser — default: 'mysql' */
  dialect?: SqlMode2Dialect;
  /** Returns results AND full execution plan */
  explain?: boolean;
  /** SQL backends only — bypasses Mode 2, passes SQL directly to native driver */
  raw?: boolean;
}

export interface SqlMode2Result {
  data: Record<string, unknown>[];
  plan?: ExplainPlan;
}

// ─── Execution Plan Types ───────────────────────────────────────────────────

export interface ExplainPlan {
  phases: number;
  dependencies: DependencyInfo[];
  pipelines: PipelineInfo[];
  parallel: boolean;
  durationMs: number;
}

export interface DependencyInfo {
  type: 'subquery' | 'cte' | 'insert-select';
  collection: string;
  pipeline: Record<string, unknown>[];
  resultCount: number;
}

export interface PipelineInfo {
  collection: string;
  stages: Record<string, unknown>[];
}

// ─── Internal Execution Types ───────────────────────────────────────────────

export type SqlStatementType = 'select' | 'insert' | 'update' | 'delete' | 'transaction';

export interface ExecutionPlan {
  type: SqlStatementType;
  collection: string;
  dependencies: Dependency[];
  pipelines: PipelineDef[];
  parallel: boolean;
  isAggregate: boolean;
  isTransaction: boolean;
  statements?: ParsedStatement[];
  writeOps?: WriteOperation[];
}

export interface Dependency {
  id: string;
  type: 'subquery' | 'cte' | 'insert-select';
  collection: string;
  pipeline: Record<string, unknown>[];
  injectAs: 'in' | 'nin' | 'exists' | 'cte-result';
  targetField?: string;
  dependsOn?: string[];
}

export interface PipelineDef {
  collection: string;
  stages: Record<string, unknown>[];
}

export interface WriteOperation {
  type: 'insertOne' | 'insertMany' | 'updateOne' | 'updateMany' | 'deleteOne' | 'deleteMany';
  collection: string;
  document?: Record<string, unknown>;
  documents?: Record<string, unknown>[];
  filter?: Record<string, unknown>;
  update?: Record<string, unknown>;
}

export interface ParsedStatement {
  sql: string;
  type: SqlStatementType;
}

// ─── AST Helper Types ───────────────────────────────────────────────────────

export interface TableRef {
  table: string;
  alias?: string;
}

export interface ColumnRef {
  field: string;
  table?: string;
  alias?: string;
  expr?: unknown;
}

export interface JoinInfo {
  type: 'inner' | 'left' | 'right' | 'full';
  table: string;
  alias?: string;
  localField: string;
  foreignField: string;
}

export interface AggregateField {
  func: string;
  field: string;
  alias: string;
}

export interface WindowSpec {
  func: string;
  field?: string;
  alias: string;
  partitionBy?: string[];
  orderBy?: Array<{ field: string; direction: 1 | -1 }>;
  offset?: number;
}

// ─── SQL Error Extensions ───────────────────────────────────────────────────

export interface SqlErrorInfo {
  code: string;
  message: string;
  fix: string;
  sql: string;
}
