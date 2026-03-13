import { z } from 'zod';

export const LaboratoryAccessDetailsSchema = z.object({
  Status: z.enum(['Active', 'Inactive']),
  LabManager: z.boolean().optional(),
  LabTechnician: z.boolean().optional(),
});

export const LaboratoryAccessSchema = z.record(z.string(), LaboratoryAccessDetailsSchema);

export const OrganizationAccessDetailsSchema = z.object({
  Status: z.enum(['Active', 'Inactive', 'Invited']),
  OrganizationAdmin: z.boolean().optional(),
  LaboratoryAccess: LaboratoryAccessSchema.optional(),
});

export const OrganizationAccessSchema = z.record(z.string(), OrganizationAccessDetailsSchema);

export const UserSchema = z
  .object({
    UserId: z.string().uuid(),
    Email: z.string(),
    PreferredName: z.string().optional(),
    FirstName: z.string().optional(),
    LastName: z.string().optional(),
    Status: z.enum(['Active', 'Inactive', 'Invited']),
    DefaultOrganization: z.string().optional(),
    DefaultLaboratory: z.string().optional(),
    OrganizationAccess: OrganizationAccessSchema.optional(),
    SampleIdSplitPattern: z.string().optional(),
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();

export const CreateUserSchema = z
  .object({
    Email: z.string(),
    PreferredName: z.string().optional(),
    FirstName: z.string().optional(),
    LastName: z.string().optional(),
    DefaultOrganization: z.string().optional(),
  })
  .strict();
export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z
  .object({
    PreferredName: z.string().optional(),
    FirstName: z.string().optional(),
    LastName: z.string().optional(),
    SampleIdSplitPattern: z.string().optional(),
  })
  .strict();
export type UpdateUser = z.infer<typeof UpdateUserSchema>;

export const UpdateUserDefaultOrganizationSchema = z
  .object({
    DefaultOrganization: z.string().optional(),
  })
  .strict();
export type UpdateUserDefaultOrganization = z.infer<typeof UpdateUserDefaultOrganizationSchema>;

export const UpdateUserLastAccessedInfoSchema = z
  .object({
    OrganizationId: z.string().optional(),
    LaboratoryId: z.string().optional(),
  })
  .strict();
export type UpdateUserLastAccessedInfo = z.infer<typeof UpdateUserLastAccessedInfoSchema>;
