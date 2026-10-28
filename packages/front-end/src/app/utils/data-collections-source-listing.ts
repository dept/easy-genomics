import { hasFastaButNoFastq } from '@easy-genomics/shared-lib/src/app/utils/sample-regex-grouping';
import type { LaboratoryBucketObjectsResponse } from '@FE/repository/modules/data-collections';
import { basenameFromS3Key } from '@FE/utils/data-collections-file-type';

export type SourceListingSummary = Pick<
  LaboratoryBucketObjectsResponse,
  'Contents' | 'S3Bucket' | 'ResolvedPrefix' | 'ListingTruncated' | 'ReturnedKeyCount'
>;

export type SourceListingNotice = { kind: 'empty' | 'truncated'; message: string };

/**
 * What the import wizard tells the user about a source listing. The path is the one the
 * server searched, so it can differ from the client-side "Searches" preview — that difference
 * is the diagnosis.
 */
export function describeSourceListing(listing: SourceListingSummary): SourceListingNotice | null {
  const searchedPath = `s3://${listing.S3Bucket}/${listing.ResolvedPrefix}`;
  const fileCount = listing.Contents?.length ?? 0;

  if (fileCount === 0) {
    const message = listing.ListingTruncated
      ? `No files found in ${searchedPath} before the listing stopped early — try a more specific folder.`
      : `No files found in ${searchedPath} — check the bucket and folder.`;
    return { kind: 'empty', message };
  }

  if (listing.ListingTruncated) {
    const returnedKeyCount = listing.ReturnedKeyCount ?? fileCount;
    return {
      kind: 'truncated',
      message: `Showing the first ${returnedKeyCount} files — the listing stopped early, so results are partial. Try a more specific folder.`,
    };
  }

  return null;
}

/**
 * A listing of FASTA files with no FASTQ is grouped one sample per file, so the import wizard skips its
 * grouping step. A truncated listing never skips: the keys past the cut may be FASTQ.
 */
export function skipsGroupingStep(fileNames: string[], notice: SourceListingNotice | null): boolean {
  return notice?.kind !== 'truncated' && hasFastaButNoFastq(fileNames);
}

export type SharedFastaLocation = { name: string; uri: string };

export type ImportedFileSource =
  | { kind: 's3'; bucket: string }
  | { kind: 'upload'; bucket: string; uploadedKeysByName: Record<string, string> };

/**
 * Where each shared FASTA can be read by a run. An S3 import leaves it at its listed key in the source bucket; an
 * upload already put it in the lab bucket, under the key the upload manifest recorded for its file name.
 */
export function locateSharedFasta(sharedFasta: string[], source: ImportedFileSource): SharedFastaLocation[] {
  const locations: SharedFastaLocation[] = [];
  for (const fileName of sharedFasta) {
    const key = source.kind === 'upload' ? source.uploadedKeysByName[fileName] : fileName;
    if (key) {
      locations.push({ name: basenameFromS3Key(fileName), uri: `s3://${source.bucket}/${key}` });
    }
  }
  return locations;
}
