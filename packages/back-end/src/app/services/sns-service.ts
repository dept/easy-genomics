import {
  PublishCommand,
  PublishCommandInput,
  PublishCommandOutput,
  SNSClient,
  SNSServiceException,
} from '@aws-sdk/client-sns';

/** Region segment in `arn:aws:sns:<region>:...` */
const SNS_TOPIC_ARN_REGION = /^arn:aws:sns:([a-z0-9-]+):/;

export class SnsService {
  private readonly clientsByRegion = new Map<string, SNSClient>();
  private readonly fallbackRegion = process.env.AWS_REGION ?? process.env.REGION;

  /**
   * SNS Publish must target the topic's region. Using the default client region
   * while `TopicArn` points elsewhere yields InvalidParameter errors locally
   * when REGION and copied topic ARNs disagree.
   */
  private clientForTopicArn(topicArn: string | undefined): SNSClient {
    const m = topicArn?.match(SNS_TOPIC_ARN_REGION);
    const region = m?.[1] ?? this.fallbackRegion;
    if (!region) {
      return new SNSClient();
    }
    let client = this.clientsByRegion.get(region);
    if (!client) {
      client = new SNSClient({ region });
      this.clientsByRegion.set(region, client);
    }
    return client;
  }

  public publish = async (publishCommandInput: PublishCommandInput): Promise<PublishCommandOutput> => {
    try {
      const client = this.clientForTopicArn(publishCommandInput.TopicArn);
      return await client.send(new PublishCommand(publishCommandInput));
    } catch (error: any) {
      console.error('[sns-service : publish] exception encountered:', error);
      throw this.handleError(error);
    }
  };

  private handleError = (error: any): SNSServiceException => {
    return error as SNSServiceException; // Base Exception
  };
}
