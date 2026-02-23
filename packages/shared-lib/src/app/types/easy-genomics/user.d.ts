/**
 * The following User model represents the data stored in the user-table for
 * an EasyGenomics User's account details & preferences.
 *
 * The UserId serves as the Hash Key and is unique, and cannot be modified
 * after creation.
 *
 * The User Email is modifiable but it is enforced to be unique via a
 * transaction that checks the 'unique-reference-table' for uniqueness.
 *
 * {
 *   UserId: <string>,
 *   Email: <string>,
 *   PreferredName?: <string>,
 *   FirstName?: <string>,
 *   LastName?: <string>,
 *   Status: 'Active' | 'Inactive' | 'Invited',
 *   DefaultOrganization?: <string>, // User chosen Default Organization
 *   OrganizationAccess?: <OrganizationAccess>,
 *   CreatedAt?: <string>,
 *   CreatedBy?: <string>,
 *   ModifiedAt?: <string>,
 *   ModifiedBy?: <string>,
 * }
 */
import { BaseAttributes, OrgUserStatus, Status, UserStatus } from "../base-entity";

export interface User extends BaseAttributes {
  UserId: string; // DynamoDB Partition Key (String)
  Email: string;
  PreferredName?: string;
  FirstName?: string;
  LastName?: string;
  Status: UserStatus;
  DefaultOrganization?: string; // User last accessed Organization
  DefaultLaboratory?: string; // User last accessed Laboratory
  OrganizationAccess?: OrganizationAccess;
  SampleIdSplitPattern?: string; // User preference for splitting sample IDs from filenames
}

export type OrganizationAccess = Record<string, OrganizationAccessDetails>;

export type OrganizationAccessDetails = {
  Status: OrgUserStatus,
  OrganizationAdmin?: boolean,
  LaboratoryAccess?: LaboratoryAccess,
};

export type LaboratoryAccess = Record<string, LaboratoryAccessDetails>;

export type LaboratoryAccessDetails = {
  Status: Status,
  LabManager?: boolean,
  LabTechnician?: boolean,
};
