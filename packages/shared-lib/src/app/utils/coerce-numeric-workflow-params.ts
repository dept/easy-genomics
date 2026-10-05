/**
 * HealthOmics parameterTemplate fields are untyped (description + optional only).
 * The run-workflow form therefore collects every value as a string. Workflows that
 * expect a JSON number (Nextflow `val` ints, WDL Int/Float, etc.) then fail because
 * StartRun receives `"42"` instead of `42`.
 *
 * When a Nextflow JSON Schema is present, `types` can pin a field to `string` so
 * numeric-looking IDs stay strings. Untyped fields, and fields typed as number or
 * integer, are coerced when the value is an unambiguous numeric literal.
 */

const NUMERIC_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** Dotted versions such as `5.3.7` (at least two separators), not decimals like `3.14`. */
const VERSION_LIKE = /^\d+(?:\.\d+){2,}$/;

export function isVersionLikeParam(value: unknown): boolean {
  return typeof value === 'string' && VERSION_LIKE.test(value.trim());
}

/**
 * Converts a single parameter value to a number when it is safe to do so.
 * Leaves version-like values (`5.3.7`), leading-zero IDs (`007`), and explicit
 * string-typed fields unchanged.
 */
export function coerceNumericParamValue(value: unknown, type?: string): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (trimmed === '') return value;
  if (type === 'string' || type === 'boolean') return value;
  if (isVersionLikeParam(trimmed)) return trimmed;
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
