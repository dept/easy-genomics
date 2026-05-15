const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /authorization|cookie|token|password|email/i;

function redactKeys(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map(redactKeys);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = SENSITIVE_KEY_PATTERN.test(k) ? REDACTED : redactKeys(v);
    }
    return result;
  }
  return value;
}

export function logSafeEvent(event: unknown): void {
  const safe = redactKeys(event);
  // Redact Cognito claims wholesale — contains email, sub, phone_number, cognito:username, UserId
  if (safe?.requestContext?.authorizer !== undefined) {
    safe.requestContext.authorizer = REDACTED;
  }
  console.log('EVENT: \n' + JSON.stringify(safe, null, 2));
}
