/**
 * Invokes a Lambda handler locally by dynamically importing the module and calling handler(event).
 */

import path from 'path';
import { pathToFileURL } from 'url';
import type { APIGatewayProxyWithCognitoAuthorizerEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * Dynamically import and run the Lambda handler at handlerPath.
 * handlerPath should be the absolute path to the .lambda.ts file.
 * Requires running with tsx (or similar) so that @BE/* and @SharedLib/* resolve via tsconfig paths.
 */
export async function invokeHandler(
  handlerPath: string,
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> {
  const resolvedPath = path.resolve(handlerPath);
  const moduleURL = pathToFileURL(resolvedPath).href;

  const mod = await import(moduleURL);
  if (typeof mod.handler !== 'function') {
    throw new Error(`Handler module at ${resolvedPath} did not export a function named "handler"`);
  }

  const result = await mod.handler(event);
  return result as APIGatewayProxyResult;
}
