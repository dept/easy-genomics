import {
  CancelRunCommand,
  CancelRunCommandInput,
  CancelRunCommandOutput,
  GetRunCommand,
  GetRunCommandInput,
  GetRunCommandOutput,
  GetWorkflowCommand,
  GetWorkflowCommandInput,
  GetWorkflowCommandOutput,
  ListRunsCommand,
  ListRunsCommandInput,
  ListRunsCommandOutput,
  ListWorkflowsCommand,
  ListWorkflowsCommandInput,
  ListWorkflowsCommandOutput,
  ListSharesCommand,
  ListSharesCommandInput,
  ListSharesCommandOutput,
  OmicsClient,
  OmicsServiceException,
  StartRunCommand,
  StartRunCommandInput,
  StartRunCommandOutput,
} from '@aws-sdk/client-omics';

export enum OmicsCommand {
  CANCEL_RUN = 'cancel-run',
  GET_RUN = 'get-run',
  GET_WORKFLOW = 'get-workflow',
  LIST_RUNS = 'list-runs',
  LIST_WORKFLOWS = 'list-workflows',
  LIST_SHARED_WORKFLOWS = 'list-shared-workflows',
  START_RUN = 'start-run',
}

export class OmicsService {
  private readonly omicsClient;

  public constructor() {
    this.omicsClient = new OmicsClient();
  }

  public cancelRun = async (cancelRunCommandInput: CancelRunCommandInput): Promise<CancelRunCommandOutput> => {
    return this.omicsRequest<CancelRunCommandInput, CancelRunCommandOutput>(
      OmicsCommand.CANCEL_RUN,
      cancelRunCommandInput,
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

  public listWorkflows = async (
    listWorkflowsCommandInput: ListWorkflowsCommandInput,
  ): Promise<ListWorkflowsCommandOutput> => {
    return this.omicsRequest<ListWorkflowsCommandInput, ListWorkflowsCommandOutput>(
      OmicsCommand.LIST_WORKFLOWS,
      listWorkflowsCommandInput,
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

  private omicsRequest = async <RequestType, ResponseType>(
    command: OmicsCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return await this.omicsClient.send(this.getOmicsCommand(command, data));
    } catch (error: any) {
      console.error(`[omics-service : omicsRequest] command: ${command} exception encountered:`, error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): OmicsServiceException => {
    return error as OmicsServiceException; // Base Exception
  };

  private getOmicsCommand = <OmicsCommandInput>(command: OmicsCommand, data: OmicsCommandInput): any => {
    switch (command) {
      case OmicsCommand.CANCEL_RUN:
        return new CancelRunCommand(data);
      case OmicsCommand.GET_RUN:
        return new GetRunCommand(data);
      case OmicsCommand.GET_WORKFLOW:
        return new GetWorkflowCommand(data);
      case OmicsCommand.LIST_RUNS:
        return new ListRunsCommand(data);
      case OmicsCommand.LIST_WORKFLOWS:
        return new ListWorkflowsCommand(data);
      case OmicsCommand.LIST_SHARED_WORKFLOWS:
        return new ListSharesCommand(data);
      case OmicsCommand.START_RUN:
        return new StartRunCommand(data);
      default:
        throw new Error(`Unsupported Omics Management Command '${command}'`);
    }
  };
}
