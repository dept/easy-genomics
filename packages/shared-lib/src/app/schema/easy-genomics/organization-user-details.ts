import { z } from 'zod';
import { OrganizationAccessSchema } from './user';

export const OrganizationUserDetailsSchema = z
  .object({
    UserId: z.string().uuid(),
    UserEmail: z.string().optional(),
    UserStatus: z.enum(['Active', 'Inactive', 'Invited']),
    Title: z.string().optional(),
    PreferredName: z.string().optional(),
    FirstName: z.string().optional(),
    LastName: z.string().optional(),
    OrganizationId: z.string().uuid(),
    OrganizationUserStatus: z.enum(['Active', 'Inactive', 'Invited']),
    OrganizationAdmin: z.boolean(),
    OrganizationAccess: OrganizationAccessSchema.optional(),
  })
  .strict();
export type OrganizationUserDetails = z.infer<typeof OrganizationUserDetailsSchema>;
