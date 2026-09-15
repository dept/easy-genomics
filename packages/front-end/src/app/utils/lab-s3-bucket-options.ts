export interface LabS3BucketOptionsApi {
  listGrantedBuckets(laboratoryId: string): Promise<{ buckets: string[] }>;
  listCatalog(organizationId: string): Promise<{ buckets: { name: string }[] }>;
}

/**
 * Loads S3 bucket names for the lab settings dropdown.
 * Create mode uses the org-wide data-tagged catalog; edit mode uses effective granted buckets for the lab.
 */
export async function fetchLabS3BucketOptions(params: {
  isCreateMode: boolean;
  labId?: string;
  orgId?: string | null;
  api: LabS3BucketOptionsApi;
}): Promise<string[]> {
  if (!params.isCreateMode && params.labId) {
    const granted = await params.api.listGrantedBuckets(params.labId);
    return granted.buckets;
  }

  if (!params.orgId) {
    return [];
  }

  const catalog = await params.api.listCatalog(params.orgId);
  return catalog.buckets.map((bucket) => bucket.name);
}
