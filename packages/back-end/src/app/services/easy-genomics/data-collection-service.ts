import { ListObjectsV2CommandOutput, _Object } from '@aws-sdk/client-s3';
import { S3Service } from '../s3-service';

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

export type ListTransactionInputsOptions = {
  bucket: string;
  labPrefix: string;
  pageSize: number;
  maxTotalKeys?: number;
  maxTransactionFolders?: number;
};

export type ListTransactionInputsResult = {
  contents: _Object[];
  listingTruncated: boolean;
};

export class DataCollectionService {
  private readonly s3Service: S3Service;

  public constructor(s3Service?: S3Service) {
    this.s3Service = s3Service ?? new S3Service();
  }

  private async listOneLevel(
    bucket: string,
    prefix: string,
    pageSize: number,
  ): Promise<{ contents: _Object[]; commonPrefixes: string[] }> {
    const contents: _Object[] = [];
    const commonPrefixes: string[] = [];
    let continuationToken: string | undefined;
    let isTruncated = true;

    while (isTruncated) {
      const response: ListObjectsV2CommandOutput = await this.s3Service.listBucketObjectsV2({
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

  /**
   * Lists input files for Data Collections by walking org/lab → platform → transaction
   * with S3 delimiter "/", never descending into results/, work/, or workflow-definitions/.
   */
  public async listTransactionInputs(options: ListTransactionInputsOptions): Promise<ListTransactionInputsResult> {
    const {
      bucket,
      labPrefix,
      pageSize,
      maxTotalKeys = DEFAULT_MAX_TOTAL_KEYS,
      maxTransactionFolders = DEFAULT_MAX_TRANSACTION_FOLDERS,
    } = options;
    const allContents: _Object[] = [];
    let listingTruncated = false;

    const addLevel = (contents: _Object[]): boolean => {
      if (appendFileObjects(allContents, contents, maxTotalKeys)) {
        listingTruncated = true;
        return true;
      }
      return false;
    };

    const labLevel = await this.listOneLevel(bucket, labPrefix, pageSize);
    if (addLevel(labLevel.contents)) {
      return { contents: allContents, listingTruncated: true };
    }

    const platformPrefixes = labLevel.commonPrefixes.filter((p) => !shouldSkipDescentPrefix(p));

    const platformResults = await mapWithConcurrency(platformPrefixes, LIST_CONCURRENCY, async (platformPrefix) => {
      const platformLevel = await this.listOneLevel(bucket, platformPrefix, pageSize);
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

      const transactionLevel = await this.listOneLevel(bucket, transactionPrefix, pageSize);
      // Inputs live at the transaction root; do not descend into results/, work/, etc.
      if (addLevel(transactionLevel.contents)) {
        listingTruncated = true;
      }
    });

    return { contents: allContents, listingTruncated };
  }
}
