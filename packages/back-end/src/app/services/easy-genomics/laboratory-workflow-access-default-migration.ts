import type { UnifiedWorkflowCatalogEntry, LaboratoryWorkflowAccessPlatform } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { buildUnifiedWorkflowCatalogForOrganization } from '@BE/services/easy-genomics/unified-workflow-catalog-service';
import { parseWorkflowAccessSortKey, rowIsAllow, rowIsDeny } from '@BE/utils/laboratory-workflow-access-utils';

const CHUNK = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function catalogEntryToApiKey(entry: UnifiedWorkflowCatalogEntry): string {
  const plat: LaboratoryWorkflowAccessPlatform = entry.platform === 'HealthOmics' ? 'HEALTH_OMICS' : 'SEQERA';
  return `${plat}::${entry.workflowId}`;
}

/**
 * Run after Laboratory.EnableNewWorkflowsByDefault changes between strict and default-on.
 */
export async function migrateWorkflowAccessOnDefaultModeChange(params: {
  organizationId: string;
  laboratoryId: string;
  /** True if previous state was default-on */
  previousDefaultOn: boolean;
  /** True if new state is default-on */
  nextDefaultOn: boolean;
}): Promise<void> {
  const { organizationId, laboratoryId, previousDefaultOn, nextDefaultOn } = params;
  if (previousDefaultOn === nextDefaultOn) {
    return;
  }

  const accessService = new LaboratoryWorkflowAccessService();
  const catalog = await buildUnifiedWorkflowCatalogForOrganization(organizationId);
  const catalogKeySet = new Set(catalog.map(catalogEntryToApiKey));

  const rows = await accessService.listByLaboratoryId(laboratoryId);

  if (!previousDefaultOn && nextDefaultOn) {
    const allowKeys = new Set<string>();
    for (const row of rows) {
      if (!rowIsAllow(row)) {
        continue;
      }
      const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
      if (!parsed) {
        continue;
      }
      allowKeys.add(`${parsed.platform}::${parsed.workflowId}`);
    }

    const denyUpserts: UnifiedWorkflowCatalogEntry[] = [];
    for (const entry of catalog) {
      const k = catalogEntryToApiKey(entry);
      if (!allowKeys.has(k)) {
        denyUpserts.push(entry);
      }
    }

    for (let i = 0; i < denyUpserts.length; i += CHUNK) {
      const slice = denyUpserts.slice(i, i + CHUNK);
      await Promise.all(
        slice.map((entry) => {
          const plat: LaboratoryWorkflowAccessPlatform = entry.platform === 'HealthOmics' ? 'HEALTH_OMICS' : 'SEQERA';
          return accessService.upsert({
            LaboratoryId: laboratoryId,
            WorkflowKey: `${plat}#${entry.workflowId}`,
            OrganizationId: organizationId,
            WorkflowName: entry.name,
            Effect: 'DENY',
          });
        }),
      );
      if (i + CHUNK < denyUpserts.length) {
        await sleep(0);
      }
    }

    for (const row of rows) {
      if (!rowIsAllow(row)) {
        continue;
      }
      const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
      if (!parsed) {
        continue;
      }
      const k = `${parsed.platform}::${parsed.workflowId}`;
      if (catalogKeySet.has(k)) {
        await accessService.remove(laboratoryId, parsed.platform, parsed.workflowId);
      }
    }
    return;
  }

  if (previousDefaultOn && !nextDefaultOn) {
    const denyKeys = new Set<string>();
    for (const row of rows) {
      if (!rowIsDeny(row)) {
        continue;
      }
      const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
      if (!parsed) {
        continue;
      }
      denyKeys.add(`${parsed.platform}::${parsed.workflowId}`);
    }

    const allowUpserts: UnifiedWorkflowCatalogEntry[] = [];
    for (const entry of catalog) {
      const k = catalogEntryToApiKey(entry);
      if (!denyKeys.has(k)) {
        allowUpserts.push(entry);
      }
    }

    for (let i = 0; i < allowUpserts.length; i += CHUNK) {
      const slice = allowUpserts.slice(i, i + CHUNK);
      await Promise.all(
        slice.map((entry) => {
          const plat: LaboratoryWorkflowAccessPlatform = entry.platform === 'HealthOmics' ? 'HEALTH_OMICS' : 'SEQERA';
          return accessService.upsert({
            LaboratoryId: laboratoryId,
            WorkflowKey: `${plat}#${entry.workflowId}`,
            OrganizationId: organizationId,
            WorkflowName: entry.name,
            Effect: 'ALLOW',
          });
        }),
      );
      if (i + CHUNK < allowUpserts.length) {
        await sleep(0);
      }
    }

    for (const row of rows) {
      if (!rowIsDeny(row)) {
        continue;
      }
      const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
      if (!parsed) {
        continue;
      }
      await accessService.remove(laboratoryId, parsed.platform, parsed.workflowId);
    }
  }
}
