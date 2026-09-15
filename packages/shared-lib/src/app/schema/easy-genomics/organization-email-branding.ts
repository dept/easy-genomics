import { z } from 'zod';

// The OrganizationId travels in the request body rather than the URL path: the 'create-'
// Lambda filename verb never registers a path-level {id} resource (only read-/update-/
// cancel-/patch-/delete- do — see route-schemas.ts's ROUTE_SCHEMAS and verb-operations.ts),
// so this mirrors the existing LaboratoryId-in-body pattern used by create-file-upload-request.
export const OrganizationLogoUploadRequestSchema = z
  .object({
    OrganizationId: z.string(),
    ContentType: z.enum(['image/png', 'image/jpeg']),
    ContentLength: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 * 1024), // 2MB
  })
  .strict();

export const OrganizationBrandingTestEmailRequestSchema = z
  .object({
    OrganizationId: z.string(),
    EmailBrandingLogoUrl: z.string().url().optional(),
  })
  .strict();
