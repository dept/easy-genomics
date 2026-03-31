import {
  GetSecretValueCommand,
  GetSecretValueCommandInput,
  GetSecretValueCommandOutput,
  SecretsManagerClient,
  SecretsManagerServiceException,
} from '@aws-sdk/client-secrets-manager';

enum SecretsManagerCommand {
  GET_SECRET_VALUE = 'get-secret-value',
}

export class SecretsManagerService {
  private readonly secretsManagerClient: SecretsManagerClient;

  public constructor() {
    this.secretsManagerClient = new SecretsManagerClient();
  }

  public getSecretValue = async (
    getSecretValueCommandInput: GetSecretValueCommandInput,
  ): Promise<GetSecretValueCommandOutput> => {
    return this.secretsManagerRequest<GetSecretValueCommandInput, GetSecretValueCommandOutput>(
      SecretsManagerCommand.GET_SECRET_VALUE,
      getSecretValueCommandInput,
    );
  };

  private secretsManagerRequest = async <RequestType, ResponseType>(
    command: SecretsManagerCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return (await this.secretsManagerClient.send(this.getSecretsManagerCommand(command, data))) as ResponseType;
    } catch (error: any) {
      console.error(
        `[secrets-manager-service : secretsManagerRequest] command: ${command} exception encountered:`,
        error,
      );
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): SecretsManagerServiceException => {
    return error as SecretsManagerServiceException;
  };

  private getSecretsManagerCommand = (command: SecretsManagerCommand, data: unknown): any => {
    switch (command) {
      case SecretsManagerCommand.GET_SECRET_VALUE:
        return new GetSecretValueCommand(data as GetSecretValueCommandInput);
      default:
        throw new Error(`Unsupported Secrets Manager Command '${command}'`);
    }
  };
}
