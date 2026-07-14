import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import apiSpec from '@easy-genomics/shared-lib/src/app/openapi/easy-genomics-api.json';
import { renderSwaggerHtml } from '@easy-genomics/shared-lib/src/app/openapi/swagger-ui';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';

/**
 * Public (unauthenticated) endpoint that serves a Swagger UI page for the Easy
 * Genomics OpenAPI spec, so external stakeholders (CDC, WSLH, integration teams)
 * get a browsable API reference without provisioning a Cognito user.
 *
 * Uses the 'list-' verb prefix because it is the convention's parameter-less GET
 * (a 'read-' route would require an /{id} path parameter).
 *
 * The spec's `servers` URL is rewritten to this API Gateway's live URL so the
 * "Try it out" feature targets the real backend when a JWT is supplied.
 */
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
    const response: APIGatewayProxyResult = buildResponse(
      200,
      renderSwaggerHtml(apiSpec as Record<string, unknown>, baseUrl),
      event,
    );
    response.headers = { ...response.headers, 'Content-Type': 'text/html; charset=utf-8' };
    return response;
  } catch (err: any) {
    return buildErrorResponse(err, event);
  }
};
