/**
 * Builds an API Gateway proxy event (Cognito authorizer shape) from an Express request.
 * Auth middleware populates requestContext.authorizer.claims.
 */

import { randomUUID } from 'crypto';
import type { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import type { Request } from 'express';

export interface BuildEventOptions {
  /** Raw request body string. If not provided, req.body is used (stringified if object). */
  rawBody?: string;
}

/**
 * Convert Express req to APIGatewayProxyWithCognitoAuthorizerEvent.
 * Path parameters (e.g. id) and authorizer.claims are set by the caller (auth middleware fills claims).
 */
export function buildApiGatewayEvent(
  req: Request,
  pathParams: { id?: string },
  options?: BuildEventOptions,
): APIGatewayProxyWithCognitoAuthorizerEvent {
  const requestId = randomUUID();
  const path = req.path;
  const httpMethod = req.method as APIGatewayProxyWithCognitoAuthorizerEvent['httpMethod'];

  // API Gateway passes query string as a single string and also as key-value object
  const queryStringParameters: Record<string, string> | null =
    req.query && Object.keys(req.query).length > 0
      ? (Object.fromEntries(
          Object.entries(req.query).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v ?? '')]),
        ) as Record<string, string>)
      : null;

  const pathParameters = pathParams.id != null ? { id: pathParams.id } : null;

  // Headers: API Gateway uses lowercase keys; multi-value headers may be comma-joined
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) {
      headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  let body: string | null = null;
  if (options?.rawBody !== undefined) {
    body = options.rawBody;
  } else if (req.body !== undefined && req.body !== null) {
    body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  const event: APIGatewayProxyWithCognitoAuthorizerEvent = {
    httpMethod,
    path,
    pathParameters,
    queryStringParameters,
    multiValueQueryStringParameters: null,
    headers,
    multiValueHeaders: {},
    body,
    isBase64Encoded: false,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      authorizer: {
        claims: {},
      },
      protocol: req.protocol ?? 'HTTP/1.1',
      httpMethod,
      path,
      stage: 'local',
      requestId,
      extendedRequestId: `local-${requestId}`,
      requestTimeEpoch: Date.now(),
      resourceId: 'local',
      resourcePath: path,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: req.ip ?? req.socket?.remoteAddress ?? '127.0.0.1',
        user: null,
        userAgent: req.get('user-agent') ?? '',
        userArn: null,
      },
    },
    resource: path,
  };

  return event;
}
