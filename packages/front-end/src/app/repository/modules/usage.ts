import type { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
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
}

export default UsageModule;
