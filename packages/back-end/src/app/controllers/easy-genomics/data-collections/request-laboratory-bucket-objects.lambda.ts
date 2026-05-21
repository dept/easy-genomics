import { ListObjectsV2CommandOutput, _Object } from '@aws-sdk/client-s3';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestLaboratoryBucketObjectsSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/data-collections/request-laboratory-bucket-objects';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { S3Service } from '@BE/services/s3-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
  validateSystemAdminAccess,
} from '@BE/utils/auth-utils';

const laboratoryService = new LaboratoryService();
const s3Service = new S3Service();

const DEFAULT_MAX_TOTAL_KEYS = 15_000;
const DEFAULT_MAX_TRANSACTION_FOLDERS = 10_000;
const LIST_CONCURRENCY = 15;

function isFileObjectKey(key: string | undefined): boolean {
  return !!key && !key.endsWith('/');
}

function lastPathSegment(prefix: string): string {
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/** Do not descend into workflow output/work dirs or Omics workflow-definition uploads. */
function shouldSkipDescentPrefix(prefix: string): boolean {
  const segment = lastPathSegment(prefix);
  return segment === 'results' || segment === 'work' || segment === 'workflow-definitions';
}

async function listOneLevel(
  bucket: string,
  prefix: string,
  pageSize: number,
): Promise<{ contents: _Object[]; commonPrefixes: string[] }> {
  const contents: _Object[] = [];
  const commonPrefixes: string[] = [];
  let continuationToken: string | undefined;
  let isTruncated = true;

  while (isTruncated) {
    const response: ListObjectsV2CommandOutput = await s3Service.listBucketObjectsV2({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: '/',
      MaxKeys: pageSize,
      ContinuationToken: continuationToken,
    });

    if (response.Contents) {
      contents.push(...response.Contents);
    }

    if (response.CommonPrefixes) {
      for (const cp of response.CommonPrefixes) {
        if (cp.Prefix) {
          commonPrefixes.push(cp.Prefix);
        }
      }
    }

    isTruncated = !!response.IsTruncated;
    continuationToken = response.NextContinuationToken;
  }

  return { contents, commonPrefixes };
}

function appendFileObjects(target: _Object[], objects: _Object[], maxTotalKeys: number): boolean {
  for (const obj of objects) {
    if (!isFileObjectKey(obj.Key)) {
      continue;
    }
    if (target.length >= maxTotalKeys) {
      return true;
    }
    target.push(obj);
  }
  return target.length >= maxTotalKeys;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

type ListTransactionInputsOptions = {
  bucket: string;
  labPrefix: string;
  pageSize: number;
  maxTotalKeys: number;
  maxTransactionFolders: number;
};

type ListTransactionInputsResult = {
  contents: _Object[];
  listingTruncated: boolean;
};

/**
 * Lists input files for Data Collections by walking org/lab → platform → transaction
 * with S3 delimiter "/", never descending into results/, work/, or workflow-definitions/.
 */
async function listTransactionInputs(options: ListTransactionInputsOptions): Promise<ListTransactionInputsResult> {
  const { bucket, labPrefix, pageSize, maxTotalKeys, maxTransactionFolders } = options;
  const allContents: _Object[] = [];
  let listingTruncated = false;

  const addLevel = (contents: _Object[]): boolean => {
    if (appendFileObjects(allContents, contents, maxTotalKeys)) {
      listingTruncated = true;
      return true;
    }
    return false;
  };

  const labLevel = await listOneLevel(bucket, labPrefix, pageSize);
  if (addLevel(labLevel.contents)) {
    return { contents: allContents, listingTruncated: true };
  }

  const platformPrefixes = labLevel.commonPrefixes.filter((p) => !shouldSkipDescentPrefix(p));

  const platformResults = await mapWithConcurrency(platformPrefixes, LIST_CONCURRENCY, async (platformPrefix) => {
    const platformLevel = await listOneLevel(bucket, platformPrefix, pageSize);
    const txnPrefixes = platformLevel.commonPrefixes.filter((p) => !shouldSkipDescentPrefix(p));
    return { contents: platformLevel.contents, transactionPrefixes: txnPrefixes };
  });

  const transactionPrefixes: string[] = [];
  for (const { contents, transactionPrefixes: txnPrefixes } of platformResults) {
    if (addLevel(contents)) {
      return { contents: allContents, listingTruncated: true };
    }
    transactionPrefixes.push(...txnPrefixes);
  }

  if (listingTruncated) {
    return { contents: allContents, listingTruncated: true };
  }

  let transactionPrefixesToWalk = transactionPrefixes;
  if (transactionPrefixes.length > maxTransactionFolders) {
    listingTruncated = true;
    transactionPrefixesToWalk = transactionPrefixes.slice(0, maxTransactionFolders);
  }

  await mapWithConcurrency(transactionPrefixesToWalk, LIST_CONCURRENCY, async (transactionPrefix) => {
    if (listingTruncated) {
      return;
    }

    const transactionLevel = await listOneLevel(bucket, transactionPrefix, pageSize);
    // Inputs live at the transaction root; do not descend into results/, work/, etc.
    if (addLevel(transactionLevel.contents)) {
      listingTruncated = true;
    }
  });

  return { contents: allContents, listingTruncated };
}

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const body = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);
    if (!RequestLaboratoryBucketObjectsSchema.safeParse(body).success) {
      throw new InvalidRequestError();
    }

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(body.LaboratoryId);
    if (
      !(
        validateSystemAdminAccess(event) ||
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const s3Bucket = laboratory.S3Bucket || '';
    if (!s3Bucket) {
      throw new InvalidRequestError('Laboratory has no S3 bucket configured');
    }

    const labRoot = `${laboratory.OrganizationId}/${laboratory.LaboratoryId}/`;
    const relative = (body.RelativePrefix || '').replace(/^\/*/, '');
    let normalizedPrefix = `${labRoot}${relative}`;
    if (!normalizedPrefix.endsWith('/')) {
      normalizedPrefix = `${normalizedPrefix}/`;
    }
    if (!normalizedPrefix.startsWith(labRoot)) {
      throw new UnauthorizedAccessError();
    }

    const pageSize = Math.min(body.MaxKeys ?? 1000, 1000);
    const maxTotalKeys = Math.min(body.MaxTotalKeys ?? DEFAULT_MAX_TOTAL_KEYS, 50000);
    const maxTransactionFolders = Math.min(body.MaxTransactionFolders ?? DEFAULT_MAX_TRANSACTION_FOLDERS, 50000);

    const { contents: allContents, listingTruncated } = await listTransactionInputs({
      bucket: s3Bucket,
      labPrefix: normalizedPrefix,
      pageSize,
      maxTotalKeys,
      maxTransactionFolders,
    });

    return buildResponse(
      200,
      JSON.stringify({
        $metadata: {
          httpStatusCode: 200,
          requestId: event.requestContext.requestId,
          extendedRequestId: event.requestContext.extendedRequestId || 'unknown',
          attempts: 1,
          totalRetryDelay: 0,
        },
        Contents: allContents,
        CommonPrefixes: [],
        IsTruncated: listingTruncated,
        S3Bucket: s3Bucket,
        ResolvedPrefix: normalizedPrefix,
        ListingTruncated: listingTruncated,
        ReturnedKeyCount: allContents.length,
      }),
      event,
    );
  } catch (error: any) {
    console.error('ERROR: ' + JSON.stringify(error));
    return buildErrorResponse(error, event);
  }
};
