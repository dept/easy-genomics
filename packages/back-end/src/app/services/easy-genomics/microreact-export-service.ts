import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { InvalidRequestError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RequestRunMicroreactExport } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/workflow-key-outputs';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  MICROREACT_TREE_KEY_OUTPUTS_LIMIT,
  MicroreactExportStatus,
  RequestRunMicroreactExportResponse,
  WorkflowKeyOutput,
  WorkflowKeyOutputs,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-key-outputs';
import { isCompletedHealthOmicsWorkflowRun } from '@easy-genomics/shared-lib/src/app/utils/workflow-key-output-delivery';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { WorkflowKeyOutputsService } from '@BE/services/easy-genomics/workflow-key-outputs-service';
import { MicroreactService } from '@BE/services/microreact-service';
import { S3Service } from '@BE/services/s3-service';
import { SqsService } from '@BE/services/sqs-service';
import { SsmService } from '@BE/services/ssm-service';
import { buildMicroreactProject, microreactAccessTokenParameterName } from '@BE/utils/microreact-project';
import { filesMatchingKeyOutputs, KeyOutputDeliveryFile } from '@BE/utils/workflow-key-output-delivery';
import { runKeyOutputsRoot } from '@BE/utils/workflow-key-output-utils';

/** Files are embedded in the project document, so the Lambda holds them all in memory at once. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export type MicroreactDeliveryMessage = {
  LaboratoryId: string;
  RunId: string;
  /** Set by a manual send. Absent on the automatic run-completion delivery. */
  Target?: 'Microreact';
};

function failureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Invalid request: /, '');
}

function fileName(relativePath: string): string {
  return relativePath.split('/').pop() || relativePath;
}

/**
 * Creates a new private Microreact project from a completed run's key outputs,
 * in the account that owns the lab's Microreact access token.
 */
export class MicroreactExportService {
  private readonly laboratoryRunService = new LaboratoryRunService();
  private readonly workflowKeyOutputsService = new WorkflowKeyOutputsService();
  private readonly microreactService = new MicroreactService();
  private readonly s3Service = new S3Service();
  private readonly sqsService = new SqsService();
  private readonly ssmService = new SsmService();

  /** Queues a manual send. It always creates a new project, even when one already exists. */
  public requestExport = async (request: RequestRunMicroreactExport): Promise<RequestRunMicroreactExportResponse> => {
    const run = await this.laboratoryRunService.get(request.LaboratoryId, request.RunId);
    if (!isCompletedHealthOmicsWorkflowRun(run)) {
      throw new InvalidRequestError('Only completed HealthOmics runs can be sent to Microreact');
    }
    const definition = await this.workflowKeyOutputsService.get(run.LaboratoryId, run.WorkflowExternalId!);
    if (!definition?.Delivery?.Microreact?.MetadataKeyOutputId) {
      throw new InvalidRequestError('Choose a Microreact metadata key output on the delivery page first');
    }
    const queueUrl = process.env.SQS_KEY_OUTPUT_DELIVERY_QUEUE_URL;
    if (!queueUrl) {
      throw new InvalidRequestError('Microreact export is not configured for this deployment');
    }

    // Mark queued before enqueueing so a fast consumer's result is never overwritten by Queued.
    const requestedAt = new Date().toISOString();
    await this.laboratoryRunService.updateWithAttributeRemoval(
      { ...run, MicroreactStatus: 'Queued', MicroreactRequestedAt: requestedAt },
      ['MicroreactErrorMessage'],
    );
    const message: MicroreactDeliveryMessage = {
      LaboratoryId: run.LaboratoryId,
      RunId: run.RunId,
      Target: 'Microreact',
    };
    try {
      await this.sqsService.sendMessage({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        MessageGroupId: `deliver-key-outputs-${run.LaboratoryId}`,
        MessageDeduplicationId: `microreact-${run.RunId}-${requestedAt}`,
      });
    } catch (err) {
      await this.recordStatus(run, 'Failed', { MicroreactErrorMessage: 'Could not queue the export' });
      throw err;
    }
    return { RunId: run.RunId, MicroreactStatus: 'Queued' };
  };

  /**
   * Builds and sends the project. Every failure is recorded on the run rather
   * than thrown, so a queue retry never creates a duplicate project.
   */
  public exportRun = async (
    run: LaboratoryRun,
    definition: WorkflowKeyOutputs | undefined,
  ): Promise<MicroreactExportStatus> => {
    try {
      const projectUrl = await this.createProject(run, definition);
      await this.recordStatus(run, 'Succeeded', { MicroreactProjectUrl: projectUrl });
      console.info(`Sent key outputs for RunId=${run.RunId} to Microreact: ${projectUrl}`);
      return 'Succeeded';
    } catch (err) {
      console.error(`Microreact export failed for RunId=${run.RunId}:`, err);
      await this.recordStatus(run, 'Failed', { MicroreactErrorMessage: failureMessage(err) });
      return 'Failed';
    }
  };

  private createProject = async (run: LaboratoryRun, definition: WorkflowKeyOutputs | undefined): Promise<string> => {
    const config = definition?.Delivery?.Microreact;
    const declared = new Map((definition?.KeyOutputs ?? []).map((output) => [output.KeyOutputId, output]));
    const metadataOutput = config?.MetadataKeyOutputId ? declared.get(config.MetadataKeyOutputId) : undefined;
    if (!metadataOutput) {
      throw new InvalidRequestError(
        'The Microreact metadata key output is no longer declared for this workflow. Choose it again on the delivery page.',
      );
    }
    const treeOutputs = (config?.TreeKeyOutputIds ?? []).map((id) => declared.get(id));
    if (treeOutputs.some((output) => !output)) {
      throw new InvalidRequestError(
        'A Microreact tree key output is no longer declared for this workflow. Choose the trees again on the delivery page.',
      );
    }

    const accessToken = await this.readAccessToken(run);
    const root = runKeyOutputsRoot(run);
    if (!root) {
      throw new InvalidRequestError('The run has no output location inside its laboratory folder');
    }
    const listed = await this.s3Service.listAllObjectsUnderPrefix(root.bucket, root.prefix);
    const matching = (output: WorkflowKeyOutput) =>
      filesMatchingKeyOutputs(listed, root.prefix, [output.Pattern]).sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath),
      );

    const [metadataFile] = matching(metadataOutput);
    if (!metadataFile) {
      throw new InvalidRequestError(
        `No file on this run matches the metadata key output "${metadataOutput.Label}" (${metadataOutput.Pattern})`,
      );
    }
    const treeFiles = (treeOutputs as WorkflowKeyOutput[]).flatMap(matching);
    if (treeFiles.length > MICROREACT_TREE_KEY_OUTPUTS_LIMIT) {
      throw new InvalidRequestError(
        `The tree key outputs match ${treeFiles.length} files. Microreact export supports up to ${MICROREACT_TREE_KEY_OUTPUTS_LIMIT}.`,
      );
    }
    this.assertEmbeddable([metadataFile, ...treeFiles]);

    const read = async (file: KeyOutputDeliveryFile) => ({
      fileName: fileName(file.relativePath),
      content: await this.readText(root.bucket, file.key),
    });
    const project = buildMicroreactProject({
      name: `${run.WorkflowName || definition?.WorkflowName || 'Workflow'} / ${run.RunName}`,
      metadata: await read(metadataFile),
      trees: await Promise.all(treeFiles.map(read)),
    });
    return this.microreactService.createProject(project, accessToken);
  };

  private assertEmbeddable(files: KeyOutputDeliveryFile[]): void {
    const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      throw new InvalidRequestError(
        `${tooLarge.relativePath} is larger than 10 MB, the most a Microreact export embeds per file`,
      );
    }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_TOTAL_BYTES) {
      throw new InvalidRequestError('The Microreact files on this run total more than 25 MB, the export limit');
    }
  }

  private readAccessToken = async (run: LaboratoryRun): Promise<string> => {
    try {
      const output = await this.ssmService.getParameter({
        Name: microreactAccessTokenParameterName(run.OrganizationId, run.LaboratoryId),
        WithDecryption: true,
      });
      const token = output.Parameter?.Value;
      if (!token) {
        throw new InvalidRequestError('Add a Microreact access token in the laboratory settings');
      }
      return token;
    } catch (err) {
      if (err instanceof ParameterNotFound) {
        throw new InvalidRequestError('Add a Microreact access token in the laboratory settings');
      }
      throw err;
    }
  };

  private readText = async (bucket: string, key: string): Promise<string> => {
    const object = await this.s3Service.getObject({ Bucket: bucket, Key: key });
    if (!object.Body) {
      throw new InvalidRequestError(`Could not read s3://${bucket}/${key}`);
    }
    return object.Body.transformToString('utf-8');
  };

  private recordStatus = async (
    run: LaboratoryRun,
    status: MicroreactExportStatus,
    fields: Pick<LaboratoryRun, 'MicroreactProjectUrl' | 'MicroreactErrorMessage'>,
  ): Promise<void> => {
    const latest = await this.laboratoryRunService.get(run.LaboratoryId, run.RunId);
    await this.laboratoryRunService.updateWithAttributeRemoval(
      { ...latest, ...fields, MicroreactStatus: status },
      status === 'Succeeded' ? ['MicroreactErrorMessage'] : [],
    );
  };
}
