import { ParameterNotFound } from '@aws-sdk/client-ssm';
import { SsmService } from '../../src/app/services/ssm-service';

export interface LedgerEntry {
  appliedAt: string;
}

export type Ledger = Record<string, LedgerEntry>;

const MAX_ATTEMPTS = 3;

export function ledgerParamName(namePrefix: string): string {
  return `/${namePrefix}/deploy-migrations/applied`;
}

export async function loadLedger(ssmService: SsmService, namePrefix: string): Promise<Ledger> {
  try {
    const response = await ssmService.getParameter({ Name: ledgerParamName(namePrefix) });
    return JSON.parse(response.Parameter?.Value ?? '{}') as Ledger;
  } catch (error) {
    if (error instanceof ParameterNotFound) {
      return {};
    }
    throw error;
  }
}

export async function applyToLedger(ssmService: SsmService, namePrefix: string, id: string): Promise<void> {
  const paramName = ledgerParamName(namePrefix);
  const appliedAt = new Date().toISOString();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await loadLedger(ssmService, namePrefix);
    const merged: Ledger = { ...current, [id]: { appliedAt } };

    await ssmService.putParameter({
      Name: paramName,
      Type: 'String',
      Overwrite: true,
      Value: JSON.stringify(merged),
    });

    const confirmed = await loadLedger(ssmService, namePrefix);
    if (confirmed[id]?.appliedAt === appliedAt) {
      return;
    }
  }

  throw new Error(
    `Concurrent writer detected while applying ledger entry '${id}': confirm-read never showed this write after ${MAX_ATTEMPTS} attempts.`,
  );
}
