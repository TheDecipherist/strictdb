/**
 * SQL Mode 2 — Function Translator
 *
 * String: UPPER, LOWER, TRIM, CONCAT, CONCAT_WS, LENGTH, SUBSTRING
 * Numeric: ROUND, ABS
 * Date: NOW, CURRENT_TIMESTAMP, EXTRACT, DATEDIFF, DATE_ADD, DATE_SUB, DATE_TRUNC, DATE_FORMAT, TIMESTAMPDIFF
 * Conditional: CASE WHEN, COALESCE, NULLIF, CAST, CONVERT
 */

/**
 * Translate a SQL function call to a MongoDB expression.
 * Returns the MongoDB expression object for use in $project or $addFields.
 */
export function translateFunction(expr: Record<string, unknown>): Record<string, unknown> | string {
  const type = expr['type'] as string;

  if (type === 'function') {
    return translateNamedFunction(expr);
  }

  if (type === 'case') {
    return translateCase(expr);
  }

  if (type === 'cast') {
    return translateCast(expr);
  }

  // Column reference — just return the field path
  if (type === 'column_ref') {
    return `$${expr['column'] as string}`;
  }

  // Literal value
  if (type === 'number' || type === 'string' || type === 'single_quote_string') {
    return expr['value'] as string;
  }

  return {};
}

function extractExprName(expr: Record<string, unknown>): string {
  const raw = expr['name'];
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    // node-sql-parser v5+ shape: { name: [{ type: "default", value: "RANK" }] }
    const nameArr = (raw as Record<string, unknown>)['name'];
    if (Array.isArray(nameArr) && nameArr.length > 0) {
      const first = nameArr[0] as Record<string, unknown>;
      if (typeof first['value'] === 'string') return first['value'];
    }
  }
  return '';
}

function translateNamedFunction(expr: Record<string, unknown>): Record<string, unknown> | string {
  const name = extractExprName(expr).toUpperCase();
  const args = extractFunctionArgs(expr);

  switch (name) {
    // String functions
    case 'UPPER':
    case 'UCASE':
      return { $toUpper: args[0] ?? '' };
    case 'LOWER':
    case 'LCASE':
      return { $toLower: args[0] ?? '' };
    case 'TRIM':
      return { $trim: { input: args[0] ?? '' } };
    case 'LTRIM':
      return { $ltrim: { input: args[0] ?? '' } };
    case 'RTRIM':
      return { $rtrim: { input: args[0] ?? '' } };
    case 'CONCAT':
      return { $concat: args };
    case 'CONCAT_WS': {
      // CONCAT_WS(separator, str1, str2, ...)
      // MongoDB has no direct equivalent — use $reduce
      const sep = args[0];
      const strings = args.slice(1);
      if (strings.length === 0) return (sep as string) ?? '';
      return {
        $reduce: {
          input: strings.slice(1),
          initialValue: strings[0],
          in: { $concat: ['$$value', sep, '$$this'] },
        },
      };
    }
    case 'LENGTH':
    case 'CHAR_LENGTH':
    case 'CHARACTER_LENGTH':
      return { $strLenCP: args[0] ?? '' };
    case 'POSITION':
    case 'LOCATE':
      // POSITION(substr IN str) / LOCATE(substr, str) — args[0]=substr, args[1]=str
      return { $indexOfCP: [args[1] ?? '', args[0] ?? ''] };
    case 'INSTR':
      // INSTR(str, substr) — args[0]=str, args[1]=substr
      return { $indexOfCP: [args[0] ?? '', args[1] ?? ''] };
    case 'CHARINDEX':
      // CHARINDEX(substr, str) — args[0]=substr, args[1]=str
      return { $indexOfCP: [args[1] ?? '', args[0] ?? ''] };
    case 'SUBSTRING':
    case 'SUBSTR':
      return { $substrCP: [args[0] ?? '', (args[1] as number ?? 1) - 1, args[2] ?? 999999] };

    // Numeric functions
    case 'ROUND':
      return { $round: [args[0] ?? '', args[1] ?? 0] };
    case 'ABS':
      return { $abs: args[0] ?? '' };
    case 'CEIL':
    case 'CEILING':
      return { $ceil: args[0] ?? '' };
    case 'FLOOR':
      return { $floor: args[0] ?? '' };
    case 'TRUNC':
    case 'TRUNCATE':
      return { $trunc: args.length > 1 ? [args[0] ?? 0, args[1] ?? 0] : (args[0] ?? 0) };

    // Date functions
    case 'NOW':
    case 'CURRENT_TIMESTAMP':
      return '$$NOW';
    case 'EXTRACT':
      return translateExtract(expr);
    case 'DATEPART':
      return translateDatepart(expr);
    case 'DATEDIFF':
      return {
        $dateDiff: {
          startDate: args[0] ?? '',
          endDate: args[1] ?? '',
          unit: (args[2] as string) ?? 'day',
        },
      };
    case 'DATE_ADD':
    case 'DATEADD':
      // DATE_ADD(date, INTERVAL n unit) → $dateAdd
      return { $dateAdd: { startDate: args[0] ?? '$$NOW', unit: (args[2] as string) ?? 'day', amount: args[1] ?? 0 } };
    case 'DATE_SUB':
      return { $dateSubtract: { startDate: args[0] ?? '$$NOW', unit: (args[2] as string) ?? 'day', amount: args[1] ?? 0 } };
    case 'DATE_TRUNC':
      // DATE_TRUNC(unit, date) → $dateTrunc
      return { $dateTrunc: { date: args[1] ?? '$$NOW', unit: (args[0] as string) ?? 'day' } };
    case 'DATE_FORMAT':
    case 'TO_CHAR':
      // DATE_FORMAT(date, format) → $dateToString
      return { $dateToString: { date: args[0] ?? '$$NOW', format: (args[1] as string) ?? '%Y-%m-%d' } };
    case 'TIMESTAMPDIFF':
      // TIMESTAMPDIFF(unit, start, end)
      return { $dateDiff: { startDate: args[1] ?? '', endDate: args[2] ?? '', unit: (args[0] as string) ?? 'day' } };
    case 'STR_TO_DATE':
    case 'TO_DATE':
      return { $dateFromString: { dateString: args[0] ?? '' } };
    case 'DATE':
      return { $toDate: args[0] ?? '' };
    case 'YEAR': return { $year: args[0] ?? '' };
    case 'MONTH': return { $month: args[0] ?? '' };
    case 'DAY': return { $dayOfMonth: args[0] ?? '' };
    case 'HOUR': return { $hour: args[0] ?? '' };
    case 'MINUTE': return { $minute: args[0] ?? '' };
    case 'SECOND': return { $second: args[0] ?? '' };
    case 'DAYOFWEEK': return { $dayOfWeek: args[0] ?? '' };
    case 'DAYOFYEAR': return { $dayOfYear: args[0] ?? '' };
    case 'WEEK': return { $week: args[0] ?? '' };
    case 'CURRENT_DATE':
    case 'CURDATE':
      return '$$NOW';

    // Additional string functions
    case 'REPLACE':
      return { $replaceAll: { input: args[0] ?? '', find: args[1] ?? '', replacement: args[2] ?? '' } };
    case 'LEFT':
      return { $substrCP: [args[0] ?? '', 0, args[1] ?? 0] };
    case 'RIGHT':
      return { $substrCP: [args[0] ?? '', { $subtract: [{ $strLenCP: args[0] ?? '' }, args[1] ?? 0] }, args[1] ?? 0] };
    case 'REVERSE':
      return {
        $reduce: {
          input: { $range: [0, { $strLenCP: args[0] ?? '' }] },
          initialValue: '',
          in: { $concat: [{ $substrCP: [args[0] ?? '', { $subtract: [{ $subtract: [{ $strLenCP: args[0] ?? '' }, 1] }, '$$this'] }, 1] }, '$$value'] },
        },
      };

    // Additional numeric functions
    case 'POWER':
    case 'POW':
      return { $pow: [args[0] ?? 0, args[1] ?? 0] };
    case 'SQRT':
      return { $sqrt: args[0] ?? 0 };
    case 'EXP':
      return { $exp: args[0] ?? 0 };
    case 'LOG':
    case 'LN':
      return { $ln: args[0] ?? 0 };
    case 'LOG10':
      return { $log: [args[0] ?? 0, 10] };
    case 'LOG2':
      return { $log: [args[0] ?? 0, 2] };
    case 'RAND':
    case 'RANDOM':
      return { $rand: {} };
    case 'MOD':
      return { $mod: [args[0] ?? 0, args[1] ?? 1] };
    case 'GREATEST':
      return { $max: args };
    case 'LEAST':
      return { $min: args };

    // ID retrieval
    case 'LAST_INSERT_ID':
      // Returns a marker that the executor replaces with the actual last inserted ID
      return { __lastInsertId: true };

    // Conditional
    case 'COALESCE':
    case 'IFNULL':
      return buildCoalesce(args);
    case 'ISNULL':
      return buildCoalesce(args);
    case 'NULLIF':
      return {
        $cond: {
          if: { $eq: [args[0], args[1]] },
          then: null,
          else: args[0],
        },
      };
    case 'IF':
      return {
        $cond: {
          if: args[0],
          then: args[1],
          else: args[2] ?? null,
        },
      };
    case 'IIF':
      return { $cond: { if: args[0], then: args[1], else: args[2] ?? null } };

    // Type conversion
    case 'CONVERT': {
      // CONVERT(expr, type) or CONVERT(type, expr) depending on dialect
      // Treat same as CAST
      const input = args[0];
      const targetType = typeof args[1] === 'string' ? args[1] : 'string';
      const typeMap: Record<string, string> = {
        'int': 'int', 'integer': 'int', 'bigint': 'long', 'float': 'double',
        'double': 'double', 'decimal': 'decimal', 'varchar': 'string',
        'char': 'string', 'text': 'string', 'boolean': 'bool', 'bool': 'bool',
        'date': 'date', 'datetime': 'date', 'timestamp': 'date',
      };
      return { $convert: { input, to: typeMap[String(targetType).toLowerCase()] ?? 'string' } };
    }

    default:
      return {};
  }
}

function extractFunctionArgs(expr: Record<string, unknown>): (unknown)[] {
  const args = expr['args'] as Record<string, unknown> | undefined;
  if (!args) return [];

  // node-sql-parser v5+: args IS the expr_list directly: { type: 'expr_list', value: [...] }
  if (args['type'] === 'expr_list') {
    const values = args['value'] as Array<Record<string, unknown>>;
    return values?.map(v => argToMongoExpr(v)) ?? [];
  }

  const exprArg = args['expr'] as Record<string, unknown> | Array<Record<string, unknown>> | undefined;
  if (!exprArg) return [];

  // Single argument
  if (!Array.isArray(exprArg)) {
    if (exprArg['type'] === 'expr_list') {
      const values = exprArg['value'] as Array<Record<string, unknown>>;
      return values?.map(v => argToMongoExpr(v)) ?? [];
    }
    return [argToMongoExpr(exprArg)];
  }

  // Multiple arguments
  return exprArg.map(a => argToMongoExpr(a));
}

function argToMongoExpr(node: Record<string, unknown>): unknown {
  const type = node['type'] as string;
  if (type === 'column_ref') return `$${node['column'] as string}`;
  if (type === 'number') {
    // node-sql-parser may return decimal numbers as strings — ensure they're numeric
    const val = node['value'];
    return typeof val === 'string' ? Number(val) : val;
  }
  if (type === 'string' || type === 'single_quote_string') return node['value'];
  if (type === 'function') return translateNamedFunction(node);
  if (type === 'null') return null;
  if (type === 'binary_expr') return translateBinaryArithExpr(node);
  return node['value'];
}

function translateBinaryArithExpr(node: Record<string, unknown>): Record<string, unknown> {
  const op = node['operator'] as string;
  const left = argToMongoExpr(node['left'] as Record<string, unknown>);
  const right = argToMongoExpr(node['right'] as Record<string, unknown>);

  switch (op) {
    case '+': return { $add: [left, right] };
    case '-': return { $subtract: [left, right] };
    case '*': return { $multiply: [left, right] };
    case '/': return { $divide: [left, right] };
    case '%': return { $mod: [left, right] };
    // Comparison operators (used in IF/CASE conditions)
    case '>': return { $gt: [left, right] };
    case '>=': return { $gte: [left, right] };
    case '<': return { $lt: [left, right] };
    case '<=': return { $lte: [left, right] };
    case '=': return { $eq: [left, right] };
    case '!=':
    case '<>': return { $ne: [left, right] };
    default: return { $add: [left, right] };
  }
}

function translateExtract(expr: Record<string, unknown>): Record<string, unknown> {
  const args = expr['args'] as Record<string, unknown>;
  // EXTRACT(part FROM field)
  const source = args?.['source'] as Record<string, unknown> | undefined;
  const part = (args?.['field'] as string || 'year').toLowerCase();
  const field = source?.['type'] === 'column_ref' ? `$${source['column'] as string}` : '';

  const partMap: Record<string, string> = {
    year: '$year',
    month: '$month',
    day: '$dayOfMonth',
    hour: '$hour',
    minute: '$minute',
    second: '$second',
    dayofweek: '$dayOfWeek',
    dayofyear: '$dayOfYear',
    week: '$week',
  };

  const op = partMap[part];
  if (op) return { [op]: field };
  return { $year: field };
}

function translateDatepart(expr: Record<string, unknown>): Record<string, unknown> {
  // DATEPART(part, field) — MSSQL/T-SQL syntax
  // AST: { type: 'function', name: 'DATEPART', args: { type: 'expr_list', value: [partNode, fieldNode] } }
  const args = expr['args'] as Record<string, unknown> | undefined;
  let partStr = 'year';
  let field = '';

  if (args?.['type'] === 'expr_list') {
    const values = args['value'] as Array<Record<string, unknown>>;
    const partNode = values?.[0];
    const fieldNode = values?.[1];

    // Part may come in as { type: 'origin', value: 'year' } or { type: 'column_ref', column: 'year' } etc.
    if (partNode) {
      const raw = (partNode['value'] ?? partNode['column'] ?? '') as string;
      partStr = raw.toLowerCase();
    }

    if (fieldNode) {
      if (fieldNode['type'] === 'column_ref') {
        field = `$${fieldNode['column'] as string}`;
      } else {
        field = (fieldNode['value'] as string) ?? '';
      }
    }
  }

  const partMap: Record<string, string> = {
    year: '$year',
    month: '$month',
    day: '$dayOfMonth',
    hour: '$hour',
    minute: '$minute',
    second: '$second',
  };

  const op = partMap[partStr] ?? '$year';
  return { [op]: field };
}

function translateCase(expr: Record<string, unknown>): Record<string, unknown> {
  // node-sql-parser v5+: args is array of { type: 'when', cond, result } and { type: 'else', result }
  const args = expr['args'] as Array<Record<string, unknown>> | undefined;

  if (args && args.length > 0) {
    const whenClauses = args.filter(a => a['type'] === 'when');
    const elseClause = args.find(a => a['type'] === 'else');
    const elseResult = elseClause ? argToMongoExpr(elseClause['result'] as Record<string, unknown>) : null;

    if (whenClauses.length === 1) {
      return {
        $cond: {
          if: translateCaseCondition(whenClauses[0]!['cond'] as Record<string, unknown>),
          then: argToMongoExpr(whenClauses[0]!['result'] as Record<string, unknown>),
          else: elseResult,
        },
      };
    }

    if (whenClauses.length > 1) {
      return {
        $switch: {
          branches: whenClauses.map(w => ({
            case: translateCaseCondition(w['cond'] as Record<string, unknown>),
            then: argToMongoExpr(w['result'] as Record<string, unknown>),
          })),
          default: elseResult,
        },
      };
    }
  }

  // Fallback: try alternate AST shape (when/else as direct fields)
  const whenList = expr['when'] as Array<Record<string, unknown>> | undefined;
  const elseExpr = expr['else'] as Record<string, unknown> | undefined;

  if (whenList && whenList.length === 1) {
    return {
      $cond: {
        if: translateCaseCondition(whenList[0]!['cond'] as Record<string, unknown>),
        then: argToMongoExpr(whenList[0]!['result'] as Record<string, unknown>),
        else: elseExpr ? argToMongoExpr(elseExpr) : null,
      },
    };
  }

  if (whenList && whenList.length > 1) {
    return {
      $switch: {
        branches: whenList.map(w => ({
          case: translateCaseCondition(w['cond'] as Record<string, unknown>),
          then: argToMongoExpr(w['result'] as Record<string, unknown>),
        })),
        default: elseExpr ? argToMongoExpr(elseExpr) : null,
      },
    };
  }

  return {};
}

function translateCaseCondition(cond: Record<string, unknown>): Record<string, unknown> {
  if (!cond) return {};
  const type = cond['type'] as string;
  if (type === 'binary_expr') {
    const op = (cond['operator'] as string || '').toUpperCase();
    const left = argToMongoExpr(cond['left'] as Record<string, unknown>);
    const right = cond['right'] as Record<string, unknown>;

    // IN operator — { $in: [field, [values]] }
    if (op === 'IN' || op === 'NOT IN') {
      const values = extractCaseInValues(right);
      const inExpr = { $in: [left, values] };
      return op === 'NOT IN' ? { $not: inExpr } : inExpr;
    }

    const rightVal = argToMongoExpr(right);
    switch (op) {
      case '=': return { $eq: [left, rightVal] };
      case '!=':
      case '<>': return { $ne: [left, rightVal] };
      case '>': return { $gt: [left, rightVal] };
      case '>=': return { $gte: [left, rightVal] };
      case '<': return { $lt: [left, rightVal] };
      case '<=': return { $lte: [left, rightVal] };
      default: return {};
    }
  }
  return {};
}

function extractCaseInValues(node: Record<string, unknown>): unknown[] {
  if (node['type'] === 'expr_list') {
    const values = node['value'] as Array<Record<string, unknown>>;
    return values?.map(v => argToMongoExpr(v)) ?? [];
  }
  return [];
}

function translateCast(expr: Record<string, unknown>): Record<string, unknown> {
  const castExpr = expr['expr'] as Record<string, unknown>;
  const target = expr['target'] as Record<string, unknown>;
  const dataType = (target?.['dataType'] as string || '').toUpperCase();

  const input = argToMongoExpr(castExpr);

  const typeMap: Record<string, string> = {
    INT: 'int',
    INTEGER: 'int',
    BIGINT: 'long',
    FLOAT: 'double',
    DOUBLE: 'double',
    DECIMAL: 'decimal',
    VARCHAR: 'string',
    CHAR: 'string',
    TEXT: 'string',
    BOOLEAN: 'bool',
    BOOL: 'bool',
    DATE: 'date',
    DATETIME: 'date',
    TIMESTAMP: 'date',
  };

  const to = typeMap[dataType] ?? 'string';

  return { $convert: { input, to } };
}

function buildCoalesce(args: unknown[]): Record<string, unknown> {
  if (args.length === 2) {
    return { $ifNull: [args[0], args[1]] };
  }
  // Chain $ifNull for 3+ args
  if (args.length > 2) {
    let result: unknown = args[args.length - 1];
    for (let i = args.length - 2; i >= 0; i--) {
      result = { $ifNull: [args[i], result] };
    }
    return result as Record<string, unknown>;
  }
  return { $ifNull: [args[0] ?? null, null] };
}
