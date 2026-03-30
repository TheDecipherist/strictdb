/**
 * StrictDB Filter Translator — backward-compatible re-export barrel
 *
 * All implementation has moved to src/translators/*.ts modules.
 * This file re-exports everything so existing imports keep working.
 */

// SQL filter translation, helpers, and utilities
export {
  translateToSQL,
  translateSortToSQL,
  translateUpdateToSQL,
  translateProjectionToSQL,
  getExcludedFields,
  quoteIdentifier,
  placeholder,
} from './translators/sql-filter.js';
export type { SqlUpdateTranslation } from './translators/sql-filter.js';

// SQL query builders
export {
  buildSelectSQL,
  buildInsertSQL,
  buildBatchInsertSQL,
  buildUpdateSQL,
  buildDeleteSQL,
  buildCountSQL,
} from './translators/sql-builder.js';
export type { FullSqlQuery } from './translators/sql-builder.js';

// Elasticsearch filter translation
export {
  translateToElastic,
  translateSortToElastic,
  translateUpdateToElastic,
} from './translators/elastic-filter.js';
export type { PainlessScript } from './translators/elastic-filter.js';

// Pipeline translators
export { translatePipelineToSQL } from './translators/pipeline-sql.js';
export { translatePipelineToElastic } from './translators/pipeline-elastic.js';
