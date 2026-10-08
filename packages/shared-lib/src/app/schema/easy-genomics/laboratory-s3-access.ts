import { z } from 'zod';

export const ALLOWED_S3_PREFIX_MAX_LENGTH = 512;

// Every tenant folder starts `{OrganizationId}/`, and organization ids are UUIDs. Rejecting a UUID-shaped first
// segment keeps an allowed prefix out of every organization's and laboratory's own tree.
const TENANT_FOLDER_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function folderSegments(prefix: string): string[] {
  return prefix.replace(/\/$/, '').split('/');
}

/** A folder outside `{OrganizationId}/{LaboratoryId}/`, from the bucket root, that a laboratory may also read. */
export const AllowedS3PrefixSchema = z
  .string()
  .min(1)
  .max(ALLOWED_S3_PREFIX_MAX_LENGTH)
  .refine((prefix) => !prefix.startsWith('/'), { message: 'Allowed folder must not start with "/"' })
  .refine(
    (prefix) => folderSegments(prefix).every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
    {
      message: 'Allowed folder must not contain empty, "." or ".." folders',
    },
  )
  .refine((prefix) => !TENANT_FOLDER_SEGMENT.test(folderSegments(prefix)[0]), {
    message: "Allowed folder must not be inside an organization's folder",
  });

const batchAssignmentSchema = z.object({
  laboratoryId: z.string().min(1),
  bucketName: z.string().min(1),
  granted: z.boolean(),
  allowedPrefix: AllowedS3PrefixSchema.optional(),
});

export const BatchUpdateLaboratoryS3AccessRequestSchema = z.object({
  assignments: z.array(batchAssignmentSchema),
});

export type BatchUpdateLaboratoryS3AccessRequestValidated = z.infer<typeof BatchUpdateLaboratoryS3AccessRequestSchema>;
