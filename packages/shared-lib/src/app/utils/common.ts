import { aws_apigateway } from 'aws-cdk-lib';
import { APIGatewayProxyWithCognitoAuthorizerEvent, APIGatewayProxyResult, APIGatewayProxyEvent } from 'aws-lambda';
import HttpError from './HttpError';

/**
 * This defines the HTTP Request types supported for the REST APIs.
 */
export type HttpRequest = 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * This defines the allowed access control headers.
 */
export const ACCESS_CONTROL_ALLOW_HEADERS = [
  'Access-Control-Allow-Credentials',
  'Access-Control-Allow-Origin',
  'Authorization',
  'Content-Type',
  'X-Amz-Date',
  'X-Amz-Security-Token',
  'X-Api-Key',
];

export function buildResponse(
  statusCode: number,
  body: string,
  event?: APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyEvent,
): APIGatewayProxyResult {
  return {
    statusCode,
    body,
    headers: {
      'Access-Control-Allow-Origin': event?.headers?.origin || '*',
      'Access-Control-Allow-Methods': aws_apigateway.Cors.ALL_METHODS.join(','),
      'Access-Control-Allow-Headers': ACCESS_CONTROL_ALLOW_HEADERS.join(','),
    },
  };
}

export function buildErrorResponse(
  error: Error,
  event?: APIGatewayProxyWithCognitoAuthorizerEvent | APIGatewayProxyEvent,
): APIGatewayProxyResult {
  let statusCode: number = 400;
  let errorCode: string = 'EG-100';
  let message: string = error.message;

  if (error instanceof HttpError) {
    errorCode = error.errorCode;
    statusCode = error.statusCode;
  }

  const body = JSON.stringify({
    Error: message,
    ErrorCode: errorCode,
  });
  return {
    statusCode,
    body,
    headers: {
      'Access-Control-Allow-Origin': event?.headers?.origin || '*',
      'Access-Control-Allow-Methods': aws_apigateway.Cors.ALL_METHODS.join(','),
      'Access-Control-Allow-Headers': ACCESS_CONTROL_ALLOW_HEADERS.join(','),
    },
  };
}

// Generic associative array
export interface AssociativeArray<Type> {
  [key: string]: Type;
}

/**
 * Make all properties in T optional except for keys U
 *
 * @typeParam T - The object to make partial
 * @typeParam U - The keys of T for which to keep previous optionality
 */
export type SomePartial<T extends Record<string, any>, U extends keyof T> = Pick<T, U> & Partial<Omit<T, U>>;
