import { ZodIssue, ZodSchema } from 'zod';

const REQUEST_ERROR_PREFIX = 'Request error: ';

/**
 * Extracts the underlying API error message from an Error thrown by HttpFactory.performRequest,
 * which wraps every failure (including the backend's specific `Error` field) as `Request error: <message>`.
 * Returns undefined if the error doesn't carry a usable message, so callers can fall back to a generic string.
 */
export function extractApiErrorMessage(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : undefined;
  if (!message) return undefined;

  const stripped = message.startsWith(REQUEST_ERROR_PREFIX) ? message.slice(REQUEST_ERROR_PREFIX.length) : message;
  return stripped.trim().length > 0 ? stripped : undefined;
}

/**
 * Turns Zod safeParse issues into a single human-readable string naming each failing field,
 * so a client-side validation failure can tell the user which field(s) to fix instead of a
 * generic "failed to validate" message. `fieldLabels` maps a schema field name to a UI-facing
 * label (e.g. "AI Failure Analysis – Model ID"); fields not in the map fall back to their raw name.
 */
export function formatValidationIssues(issues: ZodIssue[], fieldLabels: Record<string, string> = {}): string {
  return issues
    .map((issue) => {
      const field = issue.path.join('.');
      const label = fieldLabels[field] ?? field;
      return `${label}: ${issue.message}`;
    })
    .join('; ');
}

export function validateApiResponse<T>(schema: ZodSchema<T>, data: any) {
  const validation = schema.safeParse(data);

  if (!validation.success) {
    console.error('Validation error details:', validation.error.issues);
    throw new Error('Failed to validate API response: ' + validation.error.message);
  }
}

/**
 * Strip null properties from an array of objects - example usage might be to remove null properties from
 * a Seqera API response to allow the Zod schema to validate the response
 * @param items
 */
export function stripNullProperties(items: Array<any>): Array<any> {
  return items.map((item) => {
    return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== null));
  });
}
