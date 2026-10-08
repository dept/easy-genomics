import type { LaboratoryBucketObjectsResponse } from '@FE/repository/modules/data-collections';

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
      ? `No files found in ${searchedPath} before the listing stopped early — try a narrower prefix.`
      : `No files found in ${searchedPath} — check the bucket and prefix.`;
    return { kind: 'empty', message };
  }

  if (listing.ListingTruncated) {
    const returnedKeyCount = listing.ReturnedKeyCount ?? fileCount;
    return {
      kind: 'truncated',
      message: `Showing the first ${returnedKeyCount} files — the listing stopped early, so results are partial. Try a narrower prefix.`,
    };
  }

  return null;
}
