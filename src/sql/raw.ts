/**
 * SQL Mode 2 — Raw Passthrough
 *
 * When connected to a SQL backend and { raw: true } is passed,
 * the SQL string bypasses Mode 2 and goes directly to the native driver.
 */

import { rawUnavailableError, suggestRawError, modeUnavailableError } from './errors.js';
import type { Backend } from '../types.js';

/**
 * Validate raw mode. Throws if the combination is invalid.
 */
export function validateSqlMode(
  backend: Backend,
  raw: boolean | undefined,
  sql: string,
): 'mode2' | 'raw' {
  if (backend === 'elastic') {
    throw modeUnavailableError('elasticsearch', { sql });
  }

  if (backend === 'mongo') {
    if (raw) {
      throw rawUnavailableError({ sql });
    }
    return 'mode2';
  }

  // SQL backend
  if (!raw) {
    throw suggestRawError(backend, { sql });
  }

  return 'raw';
}
