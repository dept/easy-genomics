export type LaboratoryDataTag = {
  TagId: string;
  Name: string;
  ColorHex: string;
  FileCount: number;
  CreatedAt?: string;
  CreatedBy?: string;
  ModifiedAt?: string;
  ModifiedBy?: string;
};

export type ListLaboratoryDataTagsResponse = {
  Tags: LaboratoryDataTag[];
};

export type FileTagAssignment = {
  Key: string;
  TagIds: string[];
};

export type ListFileTagsResponse = {
  Files: FileTagAssignment[];
};

export type S3TaggedObjectRef = {
  Bucket: string;
  Key: string;
};

export type ListFilesByTagResponse = {
  Files: S3TaggedObjectRef[];
  NextCursor?: string;
};
