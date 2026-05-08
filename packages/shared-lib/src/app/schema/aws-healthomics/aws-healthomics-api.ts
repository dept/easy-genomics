import { z } from 'zod';

/**
 * The following Zod schema is a customized definition for Easy Genomics based
 * upon the AWS HealthOmics StartRun interface:
 *
 * The fields marked as optional can be ignored or overridden by a supplied
 * value if required.
 *
 * The roleArn is marked optional, so it can be overridden by the Easy Genomics
 * implementation with the appropriate RoleArn value for the deployment.
 */
export const CreateRunRequestSchema = z
  .object({
    workflowId: z.string(),
    name: z.string(),
    parameters: z.string(),
    roleArn: z.string().optional(), // 'easy-genomics-healthomics-workflow-run-role'
    workflowType: z.enum(['READY2RUN', 'PRIVATE']).optional(),
    outputUri: z.string().optional(),
    cacheId: z.string().optional(),
    cacheBehavior: z.enum(['CACHE_ON_FAILURE', 'CACHE_ALWAYS']).optional(),
    runGroupId: z.string().optional(),
    priority: z.number().optional(),
    storageCapacity: z.number().optional(),
    logLevel: z.enum(['ALL', 'ERROR', 'FATAL', 'OFF']).optional(),
    requestId: z.string().optional(), // unique id to prevent multiple runs
    retentionMode: z.enum(['RETAIN', 'REMOVE']).optional(),
    storageType: z.enum(['STATIC', 'DYNAMIC']).optional(),
    workflowOwnerId: z.string().optional(),
    workflowVersionName: z.string().min(1).max(64).optional(),
  })
  .strict();

export const CreateWorkflowRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    engine: z.enum(['WDL', 'NEXTFLOW', 'CWL']),
    definitionUri: z.string().trim().min(1).max(2048),
    main: z.string().trim().min(1).max(2048),
    requestId: z.string().trim().min(1).max(127),
    description: z.string().max(256).optional(),
    parameterTemplate: z
      .record(z.object({ description: z.string().optional(), optional: z.boolean().optional() }))
      .optional(),
    storageCapacity: z.number().int().positive().max(100000).optional(),
    storageType: z.enum(['STATIC', 'DYNAMIC']).optional(),
  })
  .strict();
