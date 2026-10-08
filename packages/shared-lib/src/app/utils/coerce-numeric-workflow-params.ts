/**
 * HealthOmics parameterTemplate fields are untyped (description + optional only).
 * The run-workflow form therefore collects every value as a string. Workflows that
 * expect a JSON number (Nextflow `val` ints, WDL Int/Float, etc.) then fail because
 * StartRun receives `"42"` instead of `42`.
 *
 * Callers that have a JSON Schema may pass `types` to pin a field to `string` so
 * numeric-looking IDs stay strings. Untyped fields, and fields typed as number or
 * integer, are coerced when the value is an unambiguous numeric literal.
 *
 * Two-part dotted values such as `5.3` are decimals (coerced to numbers).
 * Version-like values need at least two separators (`5.3.7`). A decimal that
 * ends in `0` (`1.10`, `2.0`) stays a string: that trailing zero is a version
 * signal, and converting it would drop the spelling.
 */

const NUMERIC_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** Dotted versions such as `5.3.7` (at least two separators), not decimals like `3.14`. */
const VERSION_LIKE = /^\d+(?:\.\d+){2,}$/;

export function isVersionLikeParam(value: unknown): boolean {
  return typeof value === 'string' && VERSION_LIKE.test(value.trim());
}

/** `1.10` and `2.0`. Integers such as `10` are not included. */
export function isTrailingZeroDecimalParam(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return NUMERIC_STRING.test(trimmed) && trimmed.includes('.') && trimmed.endsWith('0');
}

/**
 * Converts a single parameter value to a number when it is safe to do so.
 * Leaves version-like values (`5.3.7`), decimals with a trailing zero (`1.10`, `2.0`),
 * leading-zero IDs (`007`), and explicit string-typed fields unchanged.
 */
export function coerceNumericParamValue(value: unknown, type?: string): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed === '') return value;
  if (type === 'string' || type === 'boolean') return value;
  if (isVersionLikeParam(trimmed) || isTrailingZeroDecimalParam(trimmed)) return trimmed;
  if (!NUMERIC_STRING.test(trimmed)) return value;

  const num = Number(trimmed);
  if (!Number.isFinite(num)) return value;
  if (type === 'integer' && !Number.isInteger(num)) return value;

  return num;
}

export function coerceNumericWorkflowParams(
  params: Record<string, unknown>,
  types?: Record<string, string | undefined>,
): Record<string, unknown> {
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    coerced[key] = coerceNumericParamValue(value, types?.[key]);
  }
  return coerced;
}

/** Required-field / empty-filter helper: keep numeric 0 and boolean false. */
export function isBlankWorkflowParam(value: unknown): boolean {
  return value === '' || value === undefined || value === null;
}

export function omitEmptyWorkflowParams(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (!isBlankWorkflowParam(value)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Launch payload: drop blank fields, then coerce unambiguous numeric literals.
 * Use this at the FE launch boundary (cost estimate, StartRun, Settings).
 */
export function prepareWorkflowLaunchParams(
  params: unknown,
  types?: Record<string, string | undefined>,
): Record<string, unknown> {
  return coerceNumericWorkflowParams(omitEmptyWorkflowParams(params), types);
}
