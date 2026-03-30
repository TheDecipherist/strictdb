/**
 * Elasticsearch Pipeline Translation — MongoDB-style aggregation pipeline → ES search body
 */

import { StrictDBError } from '../errors.js';
import { translateToElastic, translateSortToElastic } from './elastic-filter.js';

// ─── Pipeline Translation (Elasticsearch) ────────────────────────────────────

/**
 * Translate a MongoDB-style aggregation pipeline to an Elasticsearch search body.
 *
 * Supported stages: $match, $sort, $limit, $skip, $project, $group, $count.
 * Unsupported stages throw PIPELINE_STAGE_UNSUPPORTED.
 */
export function translatePipelineToElastic(
  pipeline: Record<string, unknown>[],
): { body: Record<string, unknown>; countOnly?: boolean } {
  const body: Record<string, unknown> = {};
  let countOnly = false;

  for (const stage of pipeline) {
    const keys = Object.keys(stage);
    if (keys.length === 0) continue;
    const stageName = keys[0]!;
    const stageValue = stage[stageName];

    switch (stageName) {
      case '$match': {
        const filter = stageValue as Record<string, unknown>;
        body['query'] = translateToElastic(filter);
        break;
      }

      case '$sort': {
        const sort = stageValue as Record<string, unknown>;
        body['sort'] = translateSortToElastic(sort);
        break;
      }

      case '$limit': {
        body['size'] = Number(stageValue);
        break;
      }

      case '$skip': {
        body['from'] = Number(stageValue);
        break;
      }

      case '$project': {
        const proj = stageValue as Record<string, unknown>;
        const included = Object.entries(proj).filter(([, v]) => v === 1).map(([f]) => f);
        const excluded = Object.entries(proj).filter(([, v]) => v === 0).map(([f]) => f);
        if (included.length > 0) {
          body['_source'] = { includes: included };
        } else if (excluded.length > 0) {
          body['_source'] = { excludes: excluded };
        }
        break;
      }

      case '$group': {
        const group = stageValue as Record<string, unknown>;
        const idField = group['_id'];
        const aggs: Record<string, unknown> = {};

        // _id → terms aggregation
        if (idField !== null && idField !== undefined && idField !== '') {
          if (typeof idField === 'string' && idField.startsWith('$')) {
            const field = idField.slice(1);
            aggs['_group'] = { terms: { field } };

            // Sub-aggregations for accumulators
            const subAggs: Record<string, unknown> = {};
            for (const [accField, accum] of Object.entries(group)) {
              if (accField === '_id') continue;
              const accumObj = accum as Record<string, unknown>;
              const accumOp = Object.keys(accumObj)[0];
              const accumArg = accumObj[accumOp ?? ''];

              switch (accumOp) {
                case '$sum':
                  if (accumArg === 1 || accumArg === '1') {
                    // COUNT(*) — terms bucket already has doc_count, but add value_count for clarity
                    subAggs[accField] = { value_count: { field: field } };
                  } else if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                    subAggs[accField] = { sum: { field: accumArg.slice(1) } };
                  }
                  break;
                case '$avg':
                  if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                    subAggs[accField] = { avg: { field: accumArg.slice(1) } };
                  }
                  break;
                case '$min':
                  if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                    subAggs[accField] = { min: { field: accumArg.slice(1) } };
                  }
                  break;
                case '$max':
                  if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                    subAggs[accField] = { max: { field: accumArg.slice(1) } };
                  }
                  break;
              }
            }

            if (Object.keys(subAggs).length > 0) {
              (aggs['_group'] as Record<string, unknown>)['aggs'] = subAggs;
            }
          }
        } else {
          // _id: null → global metric aggregations
          for (const [accField, accum] of Object.entries(group)) {
            if (accField === '_id') continue;
            const accumObj = accum as Record<string, unknown>;
            const accumOp = Object.keys(accumObj)[0];
            const accumArg = accumObj[accumOp ?? ''];

            switch (accumOp) {
              case '$sum':
                if (accumArg === 1 || accumArg === '1') {
                  aggs[accField] = { value_count: { field: '_id' } };
                } else if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                  aggs[accField] = { sum: { field: accumArg.slice(1) } };
                }
                break;
              case '$avg':
                if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                  aggs[accField] = { avg: { field: accumArg.slice(1) } };
                }
                break;
              case '$min':
                if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                  aggs[accField] = { min: { field: accumArg.slice(1) } };
                }
                break;
              case '$max':
                if (typeof accumArg === 'string' && accumArg.startsWith('$')) {
                  aggs[accField] = { max: { field: accumArg.slice(1) } };
                }
                break;
            }
          }
        }

        if (Object.keys(aggs).length > 0) {
          body['aggs'] = aggs;
          // For aggregations, we don't need hits
          body['size'] = body['size'] ?? 0;
        }
        break;
      }

      case '$count': {
        // $count: 'fieldName' → use count API, return { fieldName: N }
        countOnly = true;
        (body as Record<string, unknown>)['_countField'] = stageValue as string;
        break;
      }

      default:
        throw new StrictDBError({
          code: 'PIPELINE_STAGE_UNSUPPORTED',
          message: `Pipeline stage "${stageName}" is not supported for Elasticsearch backends.`,
          fix: `Connect to MongoDB for full pipeline support. Supported Elasticsearch stages: $match, $sort, $limit, $skip, $project, $group, $count.`,
          backend: 'elastic',
        });
    }
  }

  return { body, countOnly };
}
