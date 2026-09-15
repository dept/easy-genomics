import { ClassificationResult, FailureOwner } from '@easy-genomics/shared-lib/src/app/utils/failure-classifier';

const VALID_OWNERS: ReadonlySet<FailureOwner> = new Set<FailureOwner>(['Lab', 'Bioinformatician', 'AWS', 'Ambiguous']);

/**
 * Extract the JSON classification object from an LLM completion. Shared across
 * all providers because the system prompt instructs every provider to emit the
 * same JSON shape. Returns null when the response is unparseable; the caller
 * falls back to an ambiguous default.
 *
 * Exported for unit testing.
 */
export function parseClassificationResponse(responseText: string): ClassificationResult | null {
  if (!responseText) return null;
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const owner = obj.owner;
  const summary = obj.summary;
  const action = obj.action;
  if (typeof owner !== 'string' || !VALID_OWNERS.has(owner as FailureOwner)) return null;
  if (typeof summary !== 'string' || !summary) return null;
  if (typeof action !== 'string' || !action) return null;
  return {
    owner: owner as FailureOwner,
    summary: summary.slice(0, 200),
    action: action.slice(0, 300),
  };
}
