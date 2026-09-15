import { z } from 'zod';
import {
  OrganizationBrandingTestEmailRequestSchema,
  OrganizationLogoUploadRequestSchema,
} from '../../schema/easy-genomics/organization-email-branding';

export type OrganizationLogoUploadRequest = z.infer<typeof OrganizationLogoUploadRequestSchema>;
export type OrganizationBrandingTestEmailRequest = z.infer<typeof OrganizationBrandingTestEmailRequestSchema>;

export interface OrganizationLogoUploadInfo {
  Bucket: string;
  Key: string;
  Region: string;
  S3Url: string;
  PublicUrl: string;
}
