import { APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { buildErrorResponse, buildResponse } from '../../../src/app/utils/common';
import { NotFoundError, InvalidRequestError } from '../../../src/app/utils/HttpError';

const createMockEvent = (): APIGatewayProxyWithCognitoAuthorizerEvent => ({
  body: null,
  isBase64Encoded: false,
  httpMethod: 'GET',
  path: '/test',
  headers: {},
  requestContext: { authorizer: { claims: {} } } as any,
  resource: '',
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  multiValueHeaders: {},
});

describe('buildErrorResponse', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns correct statusCode and ErrorCode for an HttpError without logging', () => {
    const result = buildErrorResponse(new NotFoundError(), createMockEvent());

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-101' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('returns correct statusCode and ErrorCode for an InvalidRequestError without logging', () => {
    const result = buildErrorResponse(new InvalidRequestError(), createMockEvent());

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-102' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('returns 400 with EG-100 and calls console.error for a plain Error', () => {
    const err = new Error('boom');
    const result = buildErrorResponse(err, createMockEvent());

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-100' });
    expect(consoleSpy).toHaveBeenCalledWith('Unexpected error:', err);
  });
});

describe('buildResponse', () => {
  it('returns the given statusCode, body, and CORS headers', () => {
    const body = JSON.stringify({ ok: true });
    const result = buildResponse(200, body, createMockEvent());

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(body);
    expect(result.headers).toMatchObject({ 'Access-Control-Allow-Origin': '*' });
  });
});
