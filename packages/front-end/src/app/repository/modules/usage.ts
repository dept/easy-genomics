import type { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
import type { RunLimitEventsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-limit-events';
import type { RunLimitEventsResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';
import type { RunCostsReport } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
import HttpFactory from '@FE/repository/factory';

class UsageModule extends HttpFactory {
  /**
   * An organization's estimated run costs by lab and workflow for one month or a rolling period
   * @param query
   */
  async listRunCosts(query: RunCostsQuery): Promise<RunCostsReport> {
    const params = new URLSearchParams({ organizationId: query.organizationId, period: query.period });
    if (query.period === 'month') {
      params.set('month', query.month);
    }

    const res = await this.call<RunCostsReport>('GET', `/usage/list-run-costs?${params.toString()}`);

    if (!res) {
      throw new Error('Failed to retrieve run costs');
    }

    return res;
  }

  /**
   * The warned launches or blocked attempts behind one Run costs period, newest first
   * @param query
   */
  async listRunLimitEvents(query: RunLimitEventsQuery): Promise<RunLimitEventsResponse> {
    const params = new URLSearchParams({
      organizationId: query.organizationId,
      period: query.period,
      kind: query.kind,
    });
    if (query.period === 'month') {
      params.set('month', query.month);
    }

    const res = await this.call<RunLimitEventsResponse>('GET', `/usage/list-run-limit-events?${params.toString()}`);

    if (!res) {
      throw new Error('Failed to retrieve run limit events');
    }

    return res;
  }
}

export default UsageModule;
