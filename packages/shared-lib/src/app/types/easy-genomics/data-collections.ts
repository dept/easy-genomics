export type LaboratoryDataTagKind = 'standard' | 'batch';

export type LaboratoryDataTag = {
  TagId: string;
  Name: string;
  ColorHex: string;
  /** Omitted or `standard` for legacy tag rows. */
  Kind?: LaboratoryDataTagKind;
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
  /** Standard (non-batch) tags only. */
  TagIds: string[];
  /** At most one batch tag id if the file is assigned to a batch. */
  BatchTagId?: string;
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
