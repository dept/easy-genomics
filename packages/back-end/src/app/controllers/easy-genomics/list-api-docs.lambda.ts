import { readFileSync } from 'fs';
import { join } from 'path';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import apiSpec from '@easy-genomics/shared-lib/src/app/openapi/easy-genomics-api.json';
import { renderSwaggerHtml } from '@easy-genomics/shared-lib/src/app/openapi/swagger-ui';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { getAbsoluteFSPath } from 'swagger-ui-dist';

/**
 * Public (unauthenticated) endpoint that serves a Swagger UI page for the Easy
 * Genomics OpenAPI spec, so external stakeholders (CDC, WSLH, integration teams)
 * get a browsable API reference without provisioning a Cognito user.
 *
 * Uses the 'list-' verb prefix because it is the convention's parameter-less GET.
 * Assets are self-hosted (swagger-ui-dist is shipped in this Lambda) and inlined —
 * no external CDN — and served under a strict CSP that forbids any external source.
 * "Try it out" is restricted to read-only methods (see renderSwaggerHtml).
 */

// Read the self-hosted Swagger UI assets once per cold start.
const SWAGGER_UI_DIST = getAbsoluteFSPath();
const SWAGGER_UI_CSS = readFileSync(join(SWAGGER_UI_DIST, 'swagger-ui.css'), 'utf-8');
const SWAGGER_UI_JS = readFileSync(join(SWAGGER_UI_DIST, 'swagger-ui-bundle.js'), 'utf-8');

// Everything is inlined and same-origin, so no external source is ever needed.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    // Deployed: API Gateway sets domainName + stage. Local dev server omits domainName,
    // so fall back to the Host header (e.g. http://localhost:3001) for "Try it out".
    const { domainName, stage } = event.requestContext;
    const baseUrl: string = domainName
      ? `https://${domainName}/${stage}`
      : `http://${event.headers?.Host ?? event.headers?.host}`;
    const html: string = renderSwaggerHtml(apiSpec as Record<string, unknown>, baseUrl, {
      css: SWAGGER_UI_CSS,
      js: SWAGGER_UI_JS,
    });
    const response: APIGatewayProxyResult = buildResponse(200, html, event);
    response.headers = {
      ...response.headers,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    };
    return response;
  } catch (err: any) {
    return buildErrorResponse(err, event);
  }
};
