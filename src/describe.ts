/**
 * StrictDB Schema Discovery — db.describe()
 *
 * AI calls this before writing any query. No hallucinating column names.
 * No guessing field types. The exampleFilter gives the AI a working starting point.
 *
 * Data sources:
 * - With Zod schemas registered: Returns exact schema definition
 * - Without Zod schemas:
 *   - MongoDB: $sample + type detection
 *   - SQL: information_schema.columns
 *   - Elasticsearch: GET /{index}/_mapping
 *
 * NOTE: This module is integrated directly into strictdb.ts describe() method.
 * This file exists as documentation and for any standalone utility needs.
 */

export { } // Module declaration — actual implementation in strictdb.ts
