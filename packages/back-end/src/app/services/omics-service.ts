import {
  CreateWorkflowCommand,
  CreateWorkflowCommandInput,
  CreateWorkflowCommandOutput,
  CancelRunCommand,
  CancelRunCommandInput,
  CancelRunCommandOutput,
  GetConfigurationCommand,
  GetConfigurationCommandInput,
  GetConfigurationCommandOutput,
  GetRunCommand,
  GetRunCommandInput,
  GetRunCommandOutput,
  GetWorkflowCommand,
  GetWorkflowCommandInput,
  GetWorkflowCommandOutput,
  ListRunsCommand,
  ListRunsCommandInput,
  ListRunsCommandOutput,
  ListRunTasksCommand,
  ListRunTasksCommandInput,
  ListRunTasksCommandOutput,
  ListWorkflowsCommand,
  ListWorkflowsCommandInput,
  ListWorkflowsCommandOutput,
  ListWorkflowVersionsCommand,
  ListWorkflowVersionsCommandInput,
  ListWorkflowVersionsCommandOutput,
  ListSharesCommand,
  ListSharesCommandInput,
  ListSharesCommandOutput,
  OmicsClient,
  OmicsServiceException,
  StartRunCommand,
  StartRunCommandInput,
  StartRunCommandOutput,
  TagResourceCommand,
  TagResourceCommandInput,
  TagResourceCommandOutput,
  TaskListItem,
} from '@aws-sdk/client-omics';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

export enum OmicsCommand {
  CREATE_WORKFLOW = 'create-workflow',
  CANCEL_RUN = 'cancel-run',
  GET_CONFIGURATION = 'get-configuration',
  GET_RUN = 'get-run',
  GET_WORKFLOW = 'get-workflow',
  LIST_RUNS = 'list-runs',
  LIST_RUN_TASKS = 'list-run-tasks',
  LIST_WORKFLOWS = 'list-workflows',
  LIST_WORKFLOW_VERSIONS = 'list-workflow-versions',
  LIST_SHARED_WORKFLOWS = 'list-shared-workflows',
  START_RUN = 'start-run',
  TAG_RESOURCE = 'tag-resource',
}

export class OmicsService {
  private readonly omicsClient: OmicsClient;

  /**
   * @param credentials - Optional. When provided, all Omics API calls use these
   * credentials (e.g. lab-scoped session from STS AssumeRole). When omitted,
   * the default credential chain is used (e.g. Lambda execution role).
   */
  public constructor(credentials?: AwsCredentialIdentity) {
    this.omicsClient = credentials != null ? new OmicsClient({ credentials }) : new OmicsClient();
  }

  public cancelRun = async (cancelRunCommandInput: CancelRunCommandInput): Promise<CancelRunCommandOutput> => {
    return this.omicsRequest<CancelRunCommandInput, CancelRunCommandOutput>(
      OmicsCommand.CANCEL_RUN,
      cancelRunCommandInput,
    );
  };

  public createWorkflow = async (
    createWorkflowCommandInput: CreateWorkflowCommandInput,
  ): Promise<CreateWorkflowCommandOutput> => {
    return this.omicsRequest<CreateWorkflowCommandInput, CreateWorkflowCommandOutput>(
      OmicsCommand.CREATE_WORKFLOW,
      createWorkflowCommandInput,
    );
  };

  public getConfiguration = async (
    getConfigurationCommandInput: GetConfigurationCommandInput,
  ): Promise<GetConfigurationCommandOutput> => {
    return this.omicsRequest<GetConfigurationCommandInput, GetConfigurationCommandOutput>(
      OmicsCommand.GET_CONFIGURATION,
      getConfigurationCommandInput,
    );
  };

  public getRun = async (getRunCommandInput: GetRunCommandInput): Promise<GetRunCommandOutput> => {
    return this.omicsRequest<GetRunCommandInput, GetRunCommandOutput>(OmicsCommand.GET_RUN, getRunCommandInput);
  };

  public getWorkflow = async (getWorkflowCommandInput: GetWorkflowCommandInput): Promise<GetWorkflowCommandOutput> => {
    return this.omicsRequest<GetWorkflowCommandInput, GetWorkflowCommandOutput>(
      OmicsCommand.GET_WORKFLOW,
      getWorkflowCommandInput,
    );
  };

  public listRuns = async (listRunsCommandInput: ListRunsCommandInput): Promise<ListRunsCommandOutput> => {
    return this.omicsRequest<ListRunsCommandInput, ListRunsCommandOutput>(OmicsCommand.LIST_RUNS, listRunsCommandInput);
  };

  /**
   * List all tasks for a HealthOmics run, paginating through `nextToken` until exhausted.
   */
  public listRunTasks = async (runId: string): Promise<TaskListItem[]> => {
    const items: TaskListItem[] = [];
    let startingToken: string | undefined;

    do {
      const response = await this.omicsRequest<ListRunTasksCommandInput, ListRunTasksCommandOutput>(
        OmicsCommand.LIST_RUN_TASKS,
        {
          id: runId,
          startingToken,
          maxResults: 100,
        },
      );
      if (response.items?.length) {
        items.push(...response.items);
      }
      startingToken = response.nextToken;
    } while (startingToken);

    return items;
  };

  public listWorkflows = async (
    listWorkflowsCommandInput: ListWorkflowsCommandInput,
  ): Promise<ListWorkflowsCommandOutput> => {
    return this.omicsRequest<ListWorkflowsCommandInput, ListWorkflowsCommandOutput>(
      OmicsCommand.LIST_WORKFLOWS,
      listWorkflowsCommandInput,
    );
  };

  public listWorkflowVersions = async (
    input: ListWorkflowVersionsCommandInput,
  ): Promise<ListWorkflowVersionsCommandOutput> => {
    return this.omicsRequest<ListWorkflowVersionsCommandInput, ListWorkflowVersionsCommandOutput>(
      OmicsCommand.LIST_WORKFLOW_VERSIONS,
      input,
    );
  };

  public listSharedWorkflows = async (
    listSharesCommandInput: ListSharesCommandInput,
  ): Promise<ListSharesCommandOutput> => {
    return this.omicsRequest<ListSharesCommandInput, ListSharesCommandOutput>(
      OmicsCommand.LIST_SHARED_WORKFLOWS,
      listSharesCommandInput,
    );
  };

  public startRun = async (startRunCommandInput: StartRunCommandInput): Promise<StartRunCommandOutput> => {
    return this.omicsRequest<StartRunCommandInput, StartRunCommandOutput>(OmicsCommand.START_RUN, startRunCommandInput);
  };

  public tagResource = async (tagResourceCommandInput: TagResourceCommandInput): Promise<TagResourceCommandOutput> => {
    return this.omicsRequest<TagResourceCommandInput, TagResourceCommandOutput>(
      OmicsCommand.TAG_RESOURCE,
      tagResourceCommandInput,
    );
  };

  private omicsRequest = async <RequestType, ResponseType>(
    command: OmicsCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return (await this.omicsClient.send(this.getOmicsCommand(command, data))) as ResponseType;
    } catch (error: any) {
      console.error(`[omics-service : omicsRequest] command: ${command} exception encountered:`, error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): OmicsServiceException => {
    return error as OmicsServiceException; // Base Exception
  };

  private getOmicsCommand = (command: OmicsCommand, data: unknown): any => {
    switch (command) {
      case OmicsCommand.CREATE_WORKFLOW:
        return new CreateWorkflowCommand(data as CreateWorkflowCommandInput);
      case OmicsCommand.CANCEL_RUN:
        return new CancelRunCommand(data as CancelRunCommandInput);
      case OmicsCommand.GET_CONFIGURATION:
        return new GetConfigurationCommand(data as GetConfigurationCommandInput);
      case OmicsCommand.GET_RUN:
        return new GetRunCommand(data as GetRunCommandInput);
      case OmicsCommand.GET_WORKFLOW:
        return new GetWorkflowCommand(data as GetWorkflowCommandInput);
      case OmicsCommand.LIST_RUNS:
        return new ListRunsCommand(data as ListRunsCommandInput);
      case OmicsCommand.LIST_RUN_TASKS:
        return new ListRunTasksCommand(data as ListRunTasksCommandInput);
      case OmicsCommand.LIST_WORKFLOWS:
        return new ListWorkflowsCommand(data as ListWorkflowsCommandInput);
      case OmicsCommand.LIST_WORKFLOW_VERSIONS:
        return new ListWorkflowVersionsCommand(data as ListWorkflowVersionsCommandInput);
      case OmicsCommand.LIST_SHARED_WORKFLOWS:
        return new ListSharesCommand(data as ListSharesCommandInput);
      case OmicsCommand.START_RUN:
        return new StartRunCommand(data as StartRunCommandInput);
      case OmicsCommand.TAG_RESOURCE:
        return new TagResourceCommand(data as TagResourceCommandInput);
      default:
        throw new Error(`Unsupported Omics Management Command '${command}'`);
    }
  };
}
