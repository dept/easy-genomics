import {
  DeleteParameterCommand,
  DeleteParameterCommandInput,
  DeleteParameterCommandOutput,
  GetParameterCommand,
  GetParameterCommandInput,
  GetParameterCommandOutput,
  PutParameterCommand,
  PutParameterCommandInput,
  PutParameterCommandOutput,
  SSMClient,
  SSMServiceException,
} from '@aws-sdk/client-ssm';

export enum SsmCommand {
  DELETE_PARAMETER = 'delete-parameter',
  GET_PARAMETER = 'get-parameter',
  PUT_PARAMETER = 'put-parameter',
}

export class SsmService {
  private readonly ssmClient;

  public constructor() {
    this.ssmClient = new SSMClient();
  }

  public deleteParameter = async (
    deleteParameterCommandInput: DeleteParameterCommandInput,
  ): Promise<DeleteParameterCommandOutput> => {
    return this.ssmRequest<DeleteParameterCommandInput, DeleteParameterCommandOutput>(
      SsmCommand.DELETE_PARAMETER,
      deleteParameterCommandInput,
    );
  };

  public getParameter = async (
    getParameterCommandInput: GetParameterCommandInput,
  ): Promise<GetParameterCommandOutput> => {
    return this.ssmRequest<GetParameterCommandInput, GetParameterCommandOutput>(
      SsmCommand.GET_PARAMETER,
      getParameterCommandInput,
    );
  };

  public putParameter = async (
    putParameterCommandInput: PutParameterCommandInput,
  ): Promise<PutParameterCommandOutput> => {
    return this.ssmRequest<PutParameterCommandInput, PutParameterCommandOutput>(
      SsmCommand.PUT_PARAMETER,
      putParameterCommandInput,
    );
  };

  private ssmRequest = async <RequestType, ResponseType>(
    command: SsmCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return (await this.ssmClient.send(this.getSsmCommand(command, data))) as ResponseType;
    } catch (error: any) {
      console.error(`[ssm-service : ssmRequest] command: ${command} exception encountered:`, error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): SSMServiceException => {
    return error as SSMServiceException; // Base Exception
  };

  private getSsmCommand = (command: SsmCommand, data: unknown): any => {
    switch (command) {
      case SsmCommand.DELETE_PARAMETER:
        return new DeleteParameterCommand(data as DeleteParameterCommandInput);
      case SsmCommand.GET_PARAMETER:
        return new GetParameterCommand(data as GetParameterCommandInput);
      case SsmCommand.PUT_PARAMETER:
        return new PutParameterCommand(data as PutParameterCommandInput);
      default:
        throw new Error(`Unsupported SSM Management Command '${command}'`);
    }
  };
}
