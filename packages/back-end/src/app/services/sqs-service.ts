import {
  ReceiveMessageCommand,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
  SendMessageCommand,
  SendMessageCommandInput,
  SendMessageCommandOutput,
  SQSClient,
  SQSServiceException,
} from '@aws-sdk/client-sqs';

export enum SqsCommand {
  RECEIVE_MESSAGE = 'receive-message',
  SEND_MESSAGE = 'send-message',
}

export class SqsService {
  private readonly clientsByRegion = new Map<string, SQSClient>();
  private readonly fallbackRegion = process.env.AWS_REGION ?? process.env.REGION;

  /**
   * SQS SendMessage must target the queue's region. Queue URLs embed the
   * region (`https://sqs.<region>.amazonaws.com/...`); fall back to the
   * Lambda's configured region when the URL cannot be parsed.
   */
  private clientForQueueUrl(queueUrl: string | undefined): SQSClient {
    const m = queueUrl?.match(/sqs\.([a-z0-9-]+)\.amazonaws\.com/);
    const region = m?.[1] ?? this.fallbackRegion;
    if (!region) {
      return new SQSClient();
    }
    let client = this.clientsByRegion.get(region);
    if (!client) {
      client = new SQSClient({ region });
      this.clientsByRegion.set(region, client);
    }
    return client;
  }

  public sendMessage = async (input: SendMessageCommandInput): Promise<SendMessageCommandOutput> => {
    try {
      const client = this.clientForQueueUrl(input.QueueUrl);
      return await client.send(new SendMessageCommand(input));
    } catch (error: any) {
      console.error('[sqs-service : sendMessage] exception encountered:', error);
      throw this.handleError(error);
    }
  };

  public receiveMessage = async (input: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> => {
    try {
      const client = this.clientForQueueUrl(input.QueueUrl);
      return await client.send(new ReceiveMessageCommand(input));
    } catch (error: any) {
      console.error('[sqs-service : receiveMessage] exception encountered:', error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): SQSServiceException => {
    return error as SQSServiceException;
  };
}
