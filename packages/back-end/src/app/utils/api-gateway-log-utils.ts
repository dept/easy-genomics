import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';

/** Logs the API Gateway event with write-only secrets replaced so CloudWatch never stores them. */
export function logApiGatewayEventWithoutSecrets(event: APIGatewayProxyWithCognitoAuthorizerEvent): void {
  try {
    const raw = event.body ? (event.isBase64Encoded ? atob(event.body) : event.body) : '{}';
    const body = JSON.parse(raw) as Record<string, unknown>;
    const redacted: Record<string, unknown> = { ...body };
    for (const key of Object.keys(redacted)) {
      if (/(AccessToken|ApiKey)$/.test(key) && redacted[key]) {
        redacted[key] = '[REDACTED]';
      }
    }
    console.log('EVENT: \n' + JSON.stringify({ ...event, body: JSON.stringify(redacted) }, null, 2));
  } catch {
    console.log('EVENT: \n' + JSON.stringify({ ...event, body: '[unparseable]' }, null, 2));
  }
}
