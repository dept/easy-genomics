import {
  CloudWatchLogsClient,
  CloudWatchLogsServiceException,
  GetLogEventsCommand,
  GetLogEventsCommandInput,
  GetLogEventsCommandOutput,
} from '@aws-sdk/client-cloudwatch-logs';

export enum CloudWatchLogsCommand {
  GET_LOG_EVENTS = 'get-log-events',
}

/**
 * Thin wrapper over the CloudWatch Logs SDK, following the same pattern as the
 * other AWS-service wrappers (e.g. {@link OmicsService}, {@link SsmService}).
 * Used by the failure classifier to read a failed HealthOmics run's engine log
 * stream before redacting + summarising it.
 */
export class CloudWatchLogsService {
  private readonly cloudWatchLogsClient: CloudWatchLogsClient;

  public constructor() {
    this.cloudWatchLogsClient = new CloudWatchLogsClient();
  }

  public getLogEvents = async (input: GetLogEventsCommandInput): Promise<GetLogEventsCommandOutput> => {
    try {
      return await this.cloudWatchLogsClient.send(new GetLogEventsCommand(input));
    } catch (error: any) {
      console.error('[cloudwatch-logs-service : getLogEvents] exception encountered:', error);
      throw error as CloudWatchLogsServiceException;
    }
  };

  /**
   * Fetch the most recent events of a single log stream and return them as one
   * newline-joined string. `startFromHead: false` returns the tail of the
   * stream, which is where a run failure surfaces.
   */
  public getLogStreamText = async (logGroupName: string, logStreamName: string, limit = 200): Promise<string> => {
    const output = await this.getLogEvents({
      logGroupName,
      logStreamName,
      limit,
      startFromHead: false,
    });
    return (output.events ?? [])
      .map((event) => event.message ?? '')
      .filter((message) => message.length > 0)
      .join('\n');
  };
}
