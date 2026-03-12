// request-search-bucket-objects API type definition
export type RequestSearchBucketObjects = {
  LaboratoryId: string;
  SearchQuery: string;
  S3Bucket?: string;
  S3Prefix?: string;
  MaxResults?: number;
};

export interface S3Object {
  Key: string;
  LastModified: string;
  ETag: string;
  Size: number;
  StorageClass: string;
}

export interface S3Prefix {
  Prefix: string;
}

export interface S3SearchResponse {
  $metadata: {
    httpStatusCode: number;
    requestId: string;
    extendedRequestId: string;
    attempts: number;
    totalRetryDelay: number;
  };
  Contents: S3Object[];
  CommonPrefixes?: S3Prefix[];
  IsTruncated: boolean;
}
