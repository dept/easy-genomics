import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageCommandInput,
  GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';

export enum CostExplorerCommand {
  GET_COST_AND_USAGE = 'get-cost-and-usage',
}

/**
 * Thin AWS Cost Explorer wrapper. Cost Explorer is a global endpoint (us-east-1).
 * Domain services should call this instead of constructing CostExplorerClient directly.
 */
export class CostExplorerService {
  private readonly costExplorerClient: CostExplorerClient;

  public constructor(client?: CostExplorerClient) {
    // Cost Explorer API is global; endpoint is always us-east-1.
    this.costExplorerClient = client ?? new CostExplorerClient({ region: 'us-east-1' });
  }

  public getCostAndUsage = async (input: GetCostAndUsageCommandInput): Promise<GetCostAndUsageCommandOutput> => {
    return this.costExplorerRequest<GetCostAndUsageCommandInput, GetCostAndUsageCommandOutput>(
      CostExplorerCommand.GET_COST_AND_USAGE,
      input,
    );
  };

  private costExplorerRequest = async <RequestType, ResponseType>(
    command: CostExplorerCommand,
    data?: RequestType,
  ): Promise<ResponseType> => {
    try {
      return (await this.costExplorerClient.send(this.getCommand(command, data))) as ResponseType;
    } catch (error: any) {
      console.error('[cost-explorer-service] exception encountered:', error);
      throw error;
    }
  };

  private getCommand = (command: CostExplorerCommand, data?: any) => {
    switch (command) {
      case CostExplorerCommand.GET_COST_AND_USAGE:
        return new GetCostAndUsageCommand(data);
      default:
        throw new Error(`Unsupported CostExplorerCommand: ${command}`);
    }
  };
}
