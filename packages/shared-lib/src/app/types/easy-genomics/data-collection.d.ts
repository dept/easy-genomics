/**
 * Data Collections — lab-wide tags and S3 object tag assignments (DynamoDB).
 */

export interface DataCollectionTag {
  TagId: string;
  Name: string;
  /** Hex color e.g. #5B4FD4 */
  Color: string;
  CreatedAt?: string;
  ModifiedAt?: string;
}

export interface ListDataCollectionTagsRequest {
  LaboratoryId: string;
}

export interface ListDataCollectionTagsResponse {
  Tags: DataCollectionTag[];
}

export interface CreateDataCollectionTagRequest {
  LaboratoryId: string;
  Name: string;
  Color: string;
}

export interface CreateDataCollectionTagResponse {
  Tag: DataCollectionTag;
}

export interface UpdateDataCollectionTagRequest {
  LaboratoryId: string;
  TagId: string;
  Name: string;
  Color: string;
}

export interface UpdateDataCollectionTagResponse {
  Tag: DataCollectionTag;
}

export interface DeleteDataCollectionTagRequest {
  LaboratoryId: string;
  TagId: string;
}

export interface DeleteDataCollectionTagResponse {
  Deleted: boolean;
}

export interface BatchGetDataCollectionFileTagsRequest {
  LaboratoryId: string;
  S3Keys: string[];
}

export interface S3KeyTagAssignment {
  S3Key: string;
  TagIds: string[];
}

export interface BatchGetDataCollectionFileTagsResponse {
  Assignments: S3KeyTagAssignment[];
}

export interface BatchSetDataCollectionFileTagsRequest {
  LaboratoryId: string;
  /** Replace tag set per key (empty array clears tags for that file). */
  Items: S3KeyTagAssignment[];
}

export interface BatchSetDataCollectionFileTagsResponse {
  Updated: number;
}
