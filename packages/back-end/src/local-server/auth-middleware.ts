/**
 * Auth middleware for the local API server.
 * Validates Cognito JWT and attaches claims to the event, or returns 401.
 * Unauthenticated endpoints (invite confirm, forgot password) skip validation.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import type { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import type { Response } from 'express';

/** Paths that do not require a valid JWT (same as CDK NagSuppressions). */
export const UNAUTHENTICATED_PATHS = new Set<string>([
  'POST /easy-genomics/user/confirm-user-invitation-request',
  'POST /easy-genomics/user/create-user-forgot-password-request',
  'POST /easy-genomics/user/confirm-user-forgot-password-request',
]);

function getAuthKey(method: string, path: string): string {
  return `${method} ${path}`;
}

/** Normalize path: Express may give /read-organization/org-123, we need the pattern path for lookup. */
function normalizedPathForAuth(path: string, hasIdParam: boolean): string {
  if (hasIdParam && path.split('/').length > 0) {
    const parts = path.split('/');
    parts[parts.length - 1] = ':id';
    return parts.join('/');
  }
  return path;
}

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

function getVerifier(): ReturnType<typeof CognitoJwtVerifier.create> {
  if (verifier) return verifier;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_USER_POOL_CLIENT_ID;
  if (!userPoolId || !clientId) {
    throw new Error('COGNITO_USER_POOL_ID and COGNITO_USER_POOL_CLIENT_ID are required for JWT verification');
  }
  verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId,
  });
  return verifier;
}

/**
 * If SKIP_JWT_VERIFY is set, decode the JWT without verification and set claims (dev only).
 * Payload is not fully typed; we copy string/number claims into authorizer.claims.
 */
function decodeUnsafe(token: string): Record<string, string> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const claims: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === 'string' || typeof v === 'number') claims[k] = String(v);
  }
  return claims;
}

export interface AuthMiddlewareResult {
  authorized: true;
  claims: Record<string, string>;
}

export interface AuthMiddlewareUnauthorized {
  authorized: false;
  statusCode: number;
  body: string;
}

export type AuthResult = AuthMiddlewareResult | AuthMiddlewareUnauthorized;

/**
 * Run auth for the given method + path. If the route is unauthenticated, returns
 * authorized with empty claims. Otherwise validates Bearer token and returns claims or 401.
 */
export async function runAuth(
  method: string,
  path: string,
  hasIdParam: boolean,
  authHeader: string | undefined,
): Promise<AuthResult> {
  const pathForKey = normalizedPathForAuth(path, hasIdParam);
  const key = getAuthKey(method, pathForKey);

  if (UNAUTHENTICATED_PATHS.has(key)) {
    return { authorized: true, claims: {} };
  }

  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader;
  const debugAuth = process.env.DEBUG_AUTH === 'true' || process.env.DEBUG_AUTH === '1';

  if (!bearer) {
    if (debugAuth) {
      console.warn(`[auth-middleware] 401: no Bearer token for ${method} ${pathForKey}`);
    }
    return {
      authorized: false,
      statusCode: 401,
      body: JSON.stringify({ Error: 'Authorization header missing or invalid', ErrorCode: 'EG-101' }),
    };
  }

  const skipVerify = process.env.SKIP_JWT_VERIFY === 'true' || process.env.SKIP_JWT_VERIFY === '1';
  if (skipVerify) {
    console.warn('[auth-middleware] SKIP_JWT_VERIFY is set; decoding JWT without verification (dev only)');
    try {
      const claims = decodeUnsafe(bearer);
      return { authorized: true, claims };
    } catch (e) {
      return {
        authorized: false,
        statusCode: 401,
        body: JSON.stringify({ Error: 'Invalid or malformed token', ErrorCode: 'EG-101' }),
      };
    }
  }

  try {
    const payload = await getVerifier().verify(bearer);
    const claims: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === 'string' || typeof v === 'number') claims[k] = String(v);
    }
    return { authorized: true, claims };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    if (debugAuth) {
      console.warn(`[auth-middleware] 401: JWT verification failed for ${method} ${pathForKey}:`, err);
    }
    return {
      authorized: false,
      statusCode: 401,
      body: JSON.stringify({ Error: message, ErrorCode: 'EG-101' }),
    };
  }
}

/**
 * Attach auth claims to the event's requestContext.authorizer.
 * Call this after runAuth when authorized is true.
 */
export function attachClaimsToEvent(
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  claims: Record<string, string>,
): void {
  event.requestContext.authorizer.claims = claims;
}

/**
 * Send 401 response and return true so caller can short-circuit. Otherwise return false.
 */
export function sendUnauthorizedIfNeeded(res: Response, result: AuthResult): boolean {
  if (result.authorized) return false;
  res.status(result.statusCode).setHeader('Content-Type', 'application/json').send(result.body);
  return true;
}
