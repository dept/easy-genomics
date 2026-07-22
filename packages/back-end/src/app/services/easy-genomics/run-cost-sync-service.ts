import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageCommandOutput,
} from '@aws-sdk/client-cost-explorer';
import { BilledCost } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run-cost';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';

const laboratoryRunService = new LaboratoryRunService();

/** Services we attribute to laboratory runs via Cost Explorer. */
const COST_SERVICES = ['AWS HealthOmics', 'Amazon S3', 'AWS Batch', 'Amazon EC2', 'Amazon Elastic Container Service'];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCeDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Daily batch Cost Explorer sync. Groups UnblendedCost by TAG:RunId + SERVICE,
 * matches to LaboratoryRun rows, and persists BilledCost. Never call CE from
 * user-facing request paths.
 */
export class RunCostSyncService {
  private readonly ceClient: CostExplorerClient;

  constructor(ceClient?: CostExplorerClient) {
    // Cost Explorer API is global; endpoint is always us-east-1.
    this.ceClient = ceClient ?? new CostExplorerClient({ region: 'us-east-1' });
  }

  public async syncRecentTerminalRuns(options?: {
    minAgeDays?: number;
    maxAgeDays?: number;
  }): Promise<{ matched: number; updated: number; pages: number }> {
    const minAgeDays = options?.minAgeDays ?? 2;
    const maxAgeDays = options?.maxAgeDays ?? 14;

    const now = new Date();
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() - minAgeDays + 1);
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - maxAgeDays);

    const allRuns = await laboratoryRunService.listAllLaboratoryRuns();
    const candidates = allRuns.filter((r) => {
      if (!r.TerminalAt) return false;
      if (r.BilledCost?.SyncedAt) {
        // Refresh stale billed cost older than 7 days while still in window.
        const synced = new Date(r.BilledCost.SyncedAt).getTime();
        if (Number.isFinite(synced) && Date.now() - synced < 7 * 24 * 3600 * 1000) return false;
      }
      const terminalMs = new Date(r.TerminalAt).getTime();
      if (!Number.isFinite(terminalMs)) return false;
      const ageDays = (Date.now() - terminalMs) / (24 * 3600 * 1000);
      return ageDays >= minAgeDays && ageDays <= maxAgeDays;
    });

    const byRunId = new Map<string, LaboratoryRun>();
    for (const run of candidates) {
      byRunId.set(run.RunId, run);
    }

    if (byRunId.size === 0) {
      return { matched: 0, updated: 0, pages: 0 };
    }

    const costsByRun = await this.fetchCostsGroupedByRunId(formatCeDate(start), formatCeDate(end));
    let updated = 0;
    let matched = 0;
    const syncedAt = new Date().toISOString();
    const asOfDate = formatCeDate(new Date(Date.now() - 24 * 3600 * 1000));

    for (const [runId, byService] of costsByRun.entries()) {
      const run = byRunId.get(runId);
      if (!run) continue;
      matched++;
      const total = Object.values(byService).reduce((sum, v) => sum + v, 0);
      const billed: BilledCost = {
        TotalUsd: Math.round(total * 10000) / 10000,
        AsOfDate: asOfDate,
        SyncedAt: syncedAt,
        ByService: byService,
      };
      await laboratoryRunService.update({
        ...run,
        BilledCost: billed,
        ModifiedAt: syncedAt,
        ModifiedBy: 'Cost Sync',
      });
      updated++;
    }

    return { matched, updated, pages: costsByRun.size > 0 ? 1 : 0 };
  }

  private async fetchCostsGroupedByRunId(start: string, end: string): Promise<Map<string, Record<string, number>>> {
    const result = new Map<string, Record<string, number>>();
    let nextPageToken: string | undefined;
    let pages = 0;

    do {
      let response: GetCostAndUsageCommandOutput | undefined;
      let attempt = 0;
      while (attempt < 5) {
        try {
          response = await this.ceClient.send(
            new GetCostAndUsageCommand({
              TimePeriod: { Start: start, End: end },
              Granularity: 'DAILY',
              Metrics: ['UnblendedCost'],
              GroupBy: [
                { Type: 'TAG', Key: 'RunId' },
                { Type: 'DIMENSION', Key: 'SERVICE' },
              ],
              Filter: {
                Dimensions: {
                  Key: 'SERVICE',
                  Values: COST_SERVICES,
                },
              },
              NextPageToken: nextPageToken,
            }),
          );
          break;
        } catch (err: any) {
          if (err?.name === 'LimitExceededException' || err?.$metadata?.httpStatusCode === 429) {
            attempt++;
            await sleep(1000 * Math.pow(2, attempt));
            continue;
          }
          throw err;
        }
      }
      if (!response) throw new Error('Cost Explorer GetCostAndUsage failed after retries');

      pages++;
      for (const day of response.ResultsByTime || []) {
        for (const group of day.Groups || []) {
          const keys = group.Keys || [];
          // TAG keys come back as "RunId$<value>" or bare value depending on API version.
          const runKeyRaw = keys[0] || '';
          const service = keys[1] || 'Unknown';
          const runId = runKeyRaw.includes('$') ? runKeyRaw.split('$').slice(1).join('$') : runKeyRaw;
          if (!runId || runId === '') continue;
          const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount || '0');
          if (!Number.isFinite(amount) || amount === 0) continue;
          const existing = result.get(runId) || {};
          existing[service] = Math.round(((existing[service] || 0) + amount) * 10000) / 10000;
          result.set(runId, existing);
        }
      }

      nextPageToken = response.NextPageToken;
      if (nextPageToken) await sleep(1000);
    } while (nextPageToken);

    void pages;
    return result;
  }
}
