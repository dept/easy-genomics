import { z } from 'zod';
import {
  WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH,
  WORKFLOW_RUN_PRESET_SCOPES,
} from '../../types/easy-genomics/workflow-run-preset';

export const WorkflowRunPresetScopeSchema = z.enum(WORKFLOW_RUN_PRESET_SCOPES);

/** HealthOmics parameter templates are flat maps of scalars; reject nested structures. */
export const WorkflowRunPresetParamsSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const WorkflowRunPresetNameSchema = z.string().trim().min(1).max(WORKFLOW_RUN_PRESET_NAME_MAX_LENGTH);

export const WorkflowRunPresetSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    PresetKey: z.string(),
    PresetId: z.string().uuid(),
    Scope: WorkflowRunPresetScopeSchema,
    WorkflowId: z.string().min(1),
    Name: WorkflowRunPresetNameSchema,
    Params: WorkflowRunPresetParamsSchema,
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    CreatedByEmail: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();

export const CreateWorkflowRunPresetSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    WorkflowId: z.string().min(1),
    Scope: WorkflowRunPresetScopeSchema,
    Name: WorkflowRunPresetNameSchema,
    Params: WorkflowRunPresetParamsSchema,
  })
  .strict();
export type CreateWorkflowRunPreset = z.infer<typeof CreateWorkflowRunPresetSchema>;

/**
 * LaboratoryId, WorkflowId and Scope are required alongside the path PresetId because
 * they are all components of the DynamoDB sort key.
 */
export const UpdateWorkflowRunPresetSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    WorkflowId: z.string().min(1),
    Scope: WorkflowRunPresetScopeSchema,
    Name: WorkflowRunPresetNameSchema.optional(),
    Params: WorkflowRunPresetParamsSchema.optional(),
  })
  .strict();
export type UpdateWorkflowRunPreset = z.infer<typeof UpdateWorkflowRunPresetSchema>;
