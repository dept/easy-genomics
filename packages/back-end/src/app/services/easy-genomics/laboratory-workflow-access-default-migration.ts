import type {
  UnifiedWorkflowCatalogEntry,
  LaboratoryWorkflowAccessPlatform,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-workflow-access';
import { LaboratoryWorkflowAccessService } from '@BE/services/easy-genomics/laboratory-workflow-access-service';
import { buildUnifiedWorkflowCatalogForOrganization } from '@BE/services/easy-genomics/unified-workflow-catalog-service';
import { parseWorkflowAccessSortKey, rowIsDeny } from '@BE/utils/laboratory-workflow-access-utils';

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
  const rows = await accessService.listByLaboratoryId(laboratoryId);

  if (!previousDefaultOn && nextDefaultOn) {
    // Strict -> default-on: as documented in the admin UI, turning "enable new
    // workflows by default" on means workflows are allowed unless explicitly
    // denied. Any rows left over from strict mode must be cleared to land on a
    // clean "allowed by default" state:
    //  - strict-mode ALLOW rows are redundant here (default-on ignores ALLOW), and
    //  - DENY rows are inert under strict mode, so any that exist are stale/spurious
    //    (e.g. written by an earlier strict->on migration) and would otherwise hide
    //    every workflow from all lab users despite the toggle reading "on".
    // We deliberately do NOT create DENY rows for the catalog here — doing so was
    // the cause of "default on, but nobody can see any workflows".
    for (const row of rows) {
      const parsed = parseWorkflowAccessSortKey(row.WorkflowKey);
      if (!parsed) {
        continue;
      }
      await accessService.remove(laboratoryId, parsed.platform, parsed.workflowId);
    }
    return;
  }

  // default-on -> strict: preserve current visibility by ALLOW-listing every
  // catalog workflow that isn't explicitly denied, then drop the DENY rows so the
  // lab does not suddenly hide everything when switching into strict mode.
  const catalog = await buildUnifiedWorkflowCatalogForOrganization(organizationId);

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
