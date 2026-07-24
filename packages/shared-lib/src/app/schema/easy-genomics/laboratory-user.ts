import { z } from 'zod';

export const LaboratoryUserSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    UserId: z.string().uuid(),
    OrganizationId: z.string().uuid(),
    Status: z.enum(['Active', 'Inactive']),
    LabManager: z.boolean(),
    LabTechnician: z.boolean(),
    /** Per-membership opt-in: email this user for every run in this lab, regardless of owner. */
    NotifyOnLabRuns: z.boolean().optional(),
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();

export const AddLaboratoryUserSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    UserId: z.string().uuid(),
    Status: z.enum(['Active', 'Inactive']),
    LabManager: z.boolean(),
    LabTechnician: z.boolean(),
  })
  .strict();

export const EditLaboratoryUserSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    UserId: z.string().uuid(),
    Status: z.enum(['Active', 'Inactive']),
    LabManager: z.boolean(),
    LabTechnician: z.boolean(),
  })
  .strict();
export type EditLaboratoryUser = z.infer<typeof EditLaboratoryUserSchema>;

export const RemoveLaboratoryUserSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    UserId: z.string().uuid(),
  })
  .strict();

export const RequestLaboratoryUserSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    UserId: z.string().uuid(),
  })
  .strict();

export const AddBulkLaboratoryUsersSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    Users: z
      .array(
        z.object({
          UserId: z.string().uuid(),
          LabManager: z.boolean(),
          LabTechnician: z.boolean(),
        }),
      )
      .min(1),
  })
  .strict();
export type AddBulkLaboratoryUsers = z.infer<typeof AddBulkLaboratoryUsersSchema>;

export const UpdateLaboratoryUserNotificationPreferenceSchema = z
  .object({
    NotifyOnLabRuns: z.boolean(),
  })
  .strict();
export type UpdateLaboratoryUserNotificationPreference = z.infer<
  typeof UpdateLaboratoryUserNotificationPreferenceSchema
>;
