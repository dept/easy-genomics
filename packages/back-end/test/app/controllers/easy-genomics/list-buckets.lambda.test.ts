import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent } from 'aws-lambda';
import { handler } from '../../../../src/app/controllers/easy-genomics/list-buckets.lambda';

jest.mock('../../../../src/app/services/s3-service');

import { S3Service } from '../../../../src/app/services/s3-service';

const createMockEvent = (): APIGatewayProxyWithCognitoAuthorizerEvent => ({
  body: null,
  isBase64Encoded: false,
  httpMethod: 'GET',
  path: '/list-buckets',
  headers: {},
  requestContext: { authorizer: { claims: {} } } as any,
  resource: '',
  queryStringParameters: null,
  multiValueQueryStringParameters: null,
  pathParameters: null,
  stageVariables: null,
  multiValueHeaders: {},
});

describe('list-buckets Lambda', () => {
  let mockListBuckets: jest.Mock;
  let mockGetBucketTagging: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const MockS3Service = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBuckets = jest.fn();
    mockGetBucketTagging = jest.fn();
    MockS3Service.prototype.listBuckets = mockListBuckets;
    MockS3Service.prototype.getBucketTagging = mockGetBucketTagging;
  });

  describe('error handling', () => {
    it('returns buildErrorResponse with EG-100 when listBuckets throws', async () => {
      mockListBuckets.mockRejectedValue(new Error('S3 down'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = (await handler(createMockEvent(), {} as any, () => {})) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-100' });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('returns buildErrorResponse with EG-100 when Buckets is null', async () => {
      mockListBuckets.mockResolvedValue({ Buckets: null });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = (await handler(createMockEvent(), {} as any, () => {})) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body)).toMatchObject({ ErrorCode: 'EG-100' });
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('returns only buckets with the easy-genomics:s3-bucket-type data tag', async () => {
      mockListBuckets.mockResolvedValue({
        Buckets: [{ Name: 'my-data-bucket' }, { Name: 'other-bucket' }],
      });
      mockGetBucketTagging
        .mockResolvedValueOnce({ TagSet: [{ Key: 'easy-genomics:s3-bucket-type', Value: 'data' }] })
        .mockResolvedValueOnce({ TagSet: [{ Key: 'other-key', Value: 'other-value' }] });

      const result = (await handler(createMockEvent(), {} as any, () => {})) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual([{ Name: 'my-data-bucket' }]);
    });

    it('excludes CDK and Amplify buckets by name prefix', async () => {
      mockListBuckets.mockResolvedValue({
        Buckets: [{ Name: 'cdk-bootstrap-bucket' }, { Name: 'amplify-app-bucket' }, { Name: 'valid-bucket' }],
      });
      mockGetBucketTagging.mockResolvedValue({
        TagSet: [{ Key: 'easy-genomics:s3-bucket-type', Value: 'data' }],
      });

      const result = (await handler(createMockEvent(), {} as any, () => {})) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual([{ Name: 'valid-bucket' }]);
    });

    it('excludes cross-region buckets where getBucketTagging returns undefined', async () => {
      mockListBuckets.mockResolvedValue({
        Buckets: [{ Name: 'cross-region-bucket' }, { Name: 'local-bucket' }],
      });
      mockGetBucketTagging
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ TagSet: [{ Key: 'easy-genomics:s3-bucket-type', Value: 'data' }] });

      const result = (await handler(createMockEvent(), {} as any, () => {})) as APIGatewayProxyResult;

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body)).toEqual([{ Name: 'local-bucket' }]);
    });
  });
});
