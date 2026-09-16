import { Laboratory } from "@SharedLib/types/easy-genomics/laboratory";
import { User } from "@SharedLib/types/easy-genomics/user";
import { LaboratoryUser } from "@SharedLib/types/easy-genomics/laboratory-user";
import { Organization } from "@SharedLib/types/easy-genomics/organization";
import { OrganizationUser } from "@SharedLib/types/easy-genomics/organization-user";
import { LaboratoryRun } from "@SharedLib/types/easy-genomics/laboratory-run";
import { QueuedUserInvitationRequest } from "./user-invitation";

export type SnsProcessingOperation = 'CREATE' | 'UPDATE' | 'DELETE';

export type SnsProcessingRecordType = 'Organization' | 'OrganizationUser' | 'Laboratory' | 'LaboratoryUser' | 'LaboratoryRun' | 'User' | 'UserInvite';

export type SnsProcessingTrigger = 'Automatic' | 'Manual';

export interface SnsProcessingEvent {
  Operation: SnsProcessingOperation,
  Type: SnsProcessingRecordType,
  Record: Organization | OrganizationUser | Laboratory | LaboratoryUser | LaboratoryRun | User | QueuedUserInvitationRequest,
  /** Absent means Automatic. Only the failure-classification consumer reads this. */
  Trigger?: SnsProcessingTrigger,
}
