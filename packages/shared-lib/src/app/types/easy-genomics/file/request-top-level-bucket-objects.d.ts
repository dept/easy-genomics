// request-top-level-bucket-objects API type definition
export type RequestTopLevelBucketObjects = {
  LaboratoryId: string;
  S3Bucket?: string;
  S3Prefix?: string;
  MaxKeys?: number;
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

export interface S3TopLevelResponse {
  $metadata: {
    httpStatusCode: number;
    requestId: string;
    extendedRequestId: string;
    attempts: number;
    totalRetryDelay: number;
  };
  Contents?: S3Object[];
  CommonPrefixes?: S3Prefix[];
  IsTruncated: boolean;
}
