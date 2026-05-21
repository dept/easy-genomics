import { APIGatewayProxyWithCognitoAuthorizerEvent, Context } from 'aws-lambda';
import { handler } from '../../../../../src/app/controllers/easy-genomics/data-collections/request-laboratory-bucket-objects.lambda';

jest.mock('../../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../../src/app/services/s3-service');
jest.mock('../../../../../src/app/utils/auth-utils');

import { LaboratoryService } from '../../../../../src/app/services/easy-genomics/laboratory-service';
import { S3Service } from '../../../../../src/app/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '../../../../../src/app/utils/auth-utils';

describe('request-laboratory-bucket-objects Lambda', () => {
  let mockValidateSystemAdmin: jest.MockedFunction<typeof validateSystemAdminAccess>;
  let mockValidateOrgAdmin: jest.MockedFunction<typeof validateOrganizationAdminAccess>;
  let mockValidateLabManager: jest.MockedFunction<typeof validateLaboratoryManagerAccess>;
  let mockValidateLabTechnician: jest.MockedFunction<typeof validateLaboratoryTechnicianAccess>;
  let mockQueryByLaboratoryId: jest.Mock;
  let mockListBucketObjectsV2: jest.Mock;

  const labRoot = 'test-org-id/test-lab-id/';
  const platformPrefix = `${labRoot}aws-healthomics/`;
  const transactionPrefix = `${platformPrefix}txn-uuid-1/`;
  const resultsPrefix = `${transactionPrefix}results/`;

  const mockLaboratory = {
    OrganizationId: 'test-org-id',
    LaboratoryId: 'test-lab-id',
    S3Bucket: 'test-bucket',
  };

  const createMockEvent = (body: Record<string, unknown>): APIGatewayProxyWithCognitoAuthorizerEvent => ({
    body: JSON.stringify(body),
    isBase64Encoded: false,
    httpMethod: 'POST',
    path: '/data-collections/request-laboratory-bucket-objects',
    headers: {},
    requestContext: {
      requestId: 'request-id',
      extendedRequestId: 'extended-request-id',
      authorizer: { claims: { email: 'test@example.com' } },
    } as any,
    resource: '',
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    multiValueHeaders: {},
  });

  const createMockContext = (): Context => ({
    functionName: 'request-laboratory-bucket-objects',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:request-laboratory-bucket-objects',
    memoryLimitInMB: '128',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/request-laboratory-bucket-objects',
    logStreamName: '2026/03/17/[$LATEST]test',
    identity: undefined,
    clientContext: undefined,
    callbackWaitsForEmptyEventLoop: true,
    getRemainingTimeInMillis: () => 30000,
    done: jest.fn(),
    fail: jest.fn(),
    succeed: jest.fn(),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockValidateSystemAdmin = validateSystemAdminAccess as jest.MockedFunction<typeof validateSystemAdminAccess>;
    mockValidateOrgAdmin = validateOrganizationAdminAccess as jest.MockedFunction<
      typeof validateOrganizationAdminAccess
    >;
    mockValidateLabManager = validateLaboratoryManagerAccess as jest.MockedFunction<
      typeof validateLaboratoryManagerAccess
    >;
    mockValidateLabTechnician = validateLaboratoryTechnicianAccess as jest.MockedFunction<
      typeof validateLaboratoryTechnicianAccess
    >;

    mockValidateSystemAdmin.mockReturnValue(false);
    mockValidateOrgAdmin.mockReturnValue(false);
    mockValidateLabManager.mockReturnValue(false);
    mockValidateLabTechnician.mockReturnValue(false);

    const mockLaboratoryServiceInstance = LaboratoryService as jest.MockedClass<typeof LaboratoryService>;
    mockQueryByLaboratoryId = jest.fn();
    mockLaboratoryServiceInstance.prototype.queryByLaboratoryId = mockQueryByLaboratoryId;

    const mockS3ServiceInstance = S3Service as jest.MockedClass<typeof S3Service>;
    mockListBucketObjectsV2 = jest.fn();
    mockS3ServiceInstance.prototype.listBucketObjectsV2 = mockListBucketObjectsV2;
  });

  it('returns transaction-root input files and never lists objects under results/', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockListBucketObjectsV2.mockImplementation(async (params: { Prefix?: string }) => {
      const prefix = params.Prefix ?? '';
      if (prefix === labRoot) {
        return {
          Contents: [],
          CommonPrefixes: [{ Prefix: platformPrefix }],
          IsTruncated: false,
        };
      }
      if (prefix === platformPrefix) {
        return {
          Contents: [],
          CommonPrefixes: [{ Prefix: transactionPrefix }],
          IsTruncated: false,
        };
      }
      if (prefix === transactionPrefix) {
        return {
          Contents: [
            {
              Key: `${transactionPrefix}sample_R1.fastq.gz`,
              Size: 100,
              LastModified: new Date('2026-01-01'),
              ETag: '"abc"',
              StorageClass: 'STANDARD',
            },
          ],
          CommonPrefixes: [{ Prefix: resultsPrefix }],
          IsTruncated: false,
        };
      }
      if (prefix === resultsPrefix) {
        throw new Error('Should not list under results/');
      }
      throw new Error(`Unexpected prefix: ${prefix}`);
    });

    const response = await handler(createMockEvent({ LaboratoryId: 'test-lab-id' }), createMockContext(), jest.fn());

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const keys = (body.Contents || []).map((o: { Key: string }) => o.Key);
    expect(keys).toEqual([`${transactionPrefix}sample_R1.fastq.gz`]);
    expect(keys.some((k: string) => k.includes('/results/'))).toBe(false);
    expect(body.Recursive).toBeUndefined();
    expect(body.ListingTruncated).toBe(false);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalledWith(expect.objectContaining({ Prefix: resultsPrefix }));
  });

  it('skips workflow-definitions at lab root and does not list into it', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const workflowDefsPrefix = `${labRoot}workflow-definitions/`;

    mockListBucketObjectsV2.mockImplementation(async (params: { Prefix?: string }) => {
      const prefix = params.Prefix ?? '';
      if (prefix === labRoot) {
        return {
          Contents: [],
          CommonPrefixes: [{ Prefix: workflowDefsPrefix }, { Prefix: platformPrefix }],
          IsTruncated: false,
        };
      }
      if (prefix === platformPrefix) {
        return { Contents: [], CommonPrefixes: [], IsTruncated: false };
      }
      if (prefix === workflowDefsPrefix) {
        throw new Error('Should not list under workflow-definitions/');
      }
      throw new Error(`Unexpected prefix: ${prefix}`);
    });

    const response = await handler(createMockEvent({ LaboratoryId: 'test-lab-id' }), createMockContext(), jest.fn());

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.Contents || []).toHaveLength(0);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalledWith(expect.objectContaining({ Prefix: workflowDefsPrefix }));
  });

  it('sets ListingTruncated when MaxTotalKeys is reached', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    mockListBucketObjectsV2.mockImplementation(async (params: { Prefix?: string }) => {
      const prefix = params.Prefix ?? '';
      if (prefix === labRoot) {
        return {
          Contents: [],
          CommonPrefixes: [{ Prefix: platformPrefix }],
          IsTruncated: false,
        };
      }
      if (prefix === platformPrefix) {
        return {
          Contents: [],
          CommonPrefixes: [{ Prefix: transactionPrefix }, { Prefix: `${platformPrefix}txn-uuid-2/` }],
          IsTruncated: false,
        };
      }
      if (prefix.startsWith(platformPrefix)) {
        const suffix = prefix === transactionPrefix ? '1' : '2';
        return {
          Contents: [
            {
              Key: `${prefix}file${suffix}.fastq.gz`,
              Size: 1,
              LastModified: new Date('2026-01-01'),
              ETag: '"x"',
              StorageClass: 'STANDARD',
            },
            {
              Key: `${prefix}file${suffix}b.fastq.gz`,
              Size: 1,
              LastModified: new Date('2026-01-01'),
              ETag: '"y"',
              StorageClass: 'STANDARD',
            },
          ],
          CommonPrefixes: [],
          IsTruncated: false,
        };
      }
      throw new Error(`Unexpected prefix: ${prefix}`);
    });

    const response = await handler(
      createMockEvent({ LaboratoryId: 'test-lab-id', MaxTotalKeys: 2 }),
      createMockContext(),
      jest.fn(),
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ListingTruncated).toBe(true);
    expect(body.ReturnedKeyCount).toBe(2);
    expect((body.Contents || []).length).toBe(2);
  });

  it('rejects Recursive in request body', async () => {
    mockValidateOrgAdmin.mockReturnValue(true);
    mockQueryByLaboratoryId.mockResolvedValue(mockLaboratory);

    const response = await handler(
      createMockEvent({ LaboratoryId: 'test-lab-id', Recursive: true }),
      createMockContext(),
      jest.fn(),
    );

    expect(response.statusCode).not.toBe(200);
    expect(mockListBucketObjectsV2).not.toHaveBeenCalled();
  });
});
