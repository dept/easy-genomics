import {
  PublishCommand,
  PublishCommandInput,
  PublishCommandOutput,
  SNSClient,
  SNSServiceException,
} from '@aws-sdk/client-sns';

export enum SnsCommand {
  PUBLISH = 'publish',
}

export class SnsService {
  private readonly snsClient;

  public constructor() {
    this.snsClient = new SNSClient();
  }

  public publish = async (publishCommandInput: PublishCommandInput): Promise<PublishCommandOutput> => {
    return this.snsRequest<PublishCommandInput, PublishCommandOutput>(SnsCommand.PUBLISH, publishCommandInput);
  };

  private snsRequest = async <RequestType, ResponseType>(
    command: SnsCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return await this.snsClient.send(this.getSnsCommand(command, data));
    } catch (error: any) {
      console.error(`[sns-service : snsRequest] command: ${command} exception encountered:`, error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): SNSServiceException => {
    return error as SNSServiceException; // Base Exception
  };

  private getSnsCommand = <SnsCommandInput>(command: SnsCommand, data: SnsCommandInput): any => {
    switch (command) {
      case SnsCommand.PUBLISH:
        return new PublishCommand(data);
      default:
        throw new Error(`Unsupported SNS Management Command '${command}'`);
    }
  };
}
