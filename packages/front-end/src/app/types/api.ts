import { z } from 'zod';

export const ErrorResponseSchema = z.object({
  Status: z.enum(['Error']),
});
export const DeletedResponseSchema = z.object({
  Status: z.enum(['Success']),
});
export const EditUserResponseSchema = z.object({
  Status: z.enum(['Success']),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type DeletedResponse = z.infer<typeof DeletedResponseSchema>;
export type EditUserResponse = z.infer<typeof EditUserResponseSchema>;
export const LaboratoryUserBulkResultSchema = z.object({
  UserId: z.string(),
  Outcome: z.enum(['Added', 'Skipped', 'Failed']),
  Reason: z.string().optional(),
});
export type LaboratoryUserBulkResult = z.infer<typeof LaboratoryUserBulkResultSchema>;
