export type S3FolderStats = {
  fileCount: number;
  totalSize: number;
};

/** Recursive folder totals from a flat list-bucket-objects Contents array. */
export function folderStatsFromListContents(
  contents: Array<{ Key?: string; Size?: number }> | undefined,
): S3FolderStats {
  const files = (contents ?? []).filter((item) => item.Key && !item.Key.endsWith('/'));
  return {
    fileCount: files.length,
    totalSize: files.reduce((sum, item) => sum + (item.Size ?? 0), 0),
  };
}
