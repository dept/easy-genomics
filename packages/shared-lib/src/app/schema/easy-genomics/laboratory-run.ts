import { z } from 'zod';

const literalSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof literalSchema>;
type Json = Literal | { [key: string]: Json } | Json[];
const jsonSchema: z.ZodType<Json> = z.lazy(() => z.union([literalSchema, z.array(jsonSchema), z.record(jsonSchema)]));

export const LaboratoryRunSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().uuid(),
    UserId: z.string().uuid(),
    OrganizationId: z.string().uuid(),
    RunName: z.string(),
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    PlatformApiBaseUrl: z.string().optional(),
    Status: z.string(),
    Owner: z.string(),
    WorkflowName: z.string().optional(),
    ExternalRunId: z.string().optional(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();

export const ReadLaboratoryRunSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().uuid(),
    UserId: z.string().uuid(),
    OrganizationId: z.string().uuid(),
    RunName: z.string(),
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    PlatformApiBaseUrl: z.string().optional(), // Used if Laboratory uses alternative Seqera Platform API Base URL
    Status: z.string(),
    Owner: z.string(), // User Email for display purposes
    WorkflowName: z.string().optional(), // Seqera Pipeline Name or AWS HealthOmics Workflow Name
    ExternalRunId: z.string().optional(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
    CreatedAt: z.string().optional(),
    CreatedBy: z.string().optional(),
    ModifiedAt: z.string().optional(),
    ModifiedBy: z.string().optional(),
  })
  .strict();
export type ReadLaboratoryRun = z.infer<typeof ReadLaboratoryRunSchema>;

export const AddLaboratoryRunSchema = z
  .object({
    LaboratoryId: z.string().uuid(),
    RunId: z.string().uuid(),
    RunName: z.string(),
    Platform: z.enum(['AWS HealthOmics', 'Seqera Cloud']),
    PlatformApiBaseUrl: z.string().optional(),
    Status: z.string(),
    WorkflowName: z.string().optional(), // Seqera Pipeline Name or AWS HealthOmics Workflow Name
    ExternalRunId: z.string().optional(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
  })
  .strict();
export type AddLaboratoryRun = z.infer<typeof AddLaboratoryRunSchema>;

export const EditLaboratoryRunSchema = z
  .object({
    Status: z.string(),
    InputS3Url: z.string().optional(),
    OutputS3Url: z.string().optional(),
    SampleSheetS3Url: z.string().optional(),
    Settings: z.union([z.string(), z.record(z.string(), z.any())]).optional(), // JSON string
  })
  .strict();
export type EditLaboratoryRun = z.infer<typeof EditLaboratoryRunSchema>;
