import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import {
  calculateExpiresAtEpochSeconds,
  getRetentionMonthsOrDefault,
  getTerminalAtIsoString,
  isTerminalLaboratoryRunStatus,
  shouldExpireWithRetentionMonths,
} from '@BE/utils/laboratory-run-ttl-utils';

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();

type RequestBody = {
  retentionMonths?: number;
  dryRun?: boolean;
};

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    const laboratoryId: string = event.queryStringParameters?.laboratoryId || '';
    if (!laboratoryId) throw new InvalidRequestError('Missing laboratoryId');

    const laboratory: Laboratory = await laboratoryService.queryByLaboratoryId(laboratoryId);
    if (!laboratory) throw new LaboratoryNotFoundError();

    if (
      !(
        validateOrganizationAdminAccess(event, laboratory.OrganizationId) ||
        validateLaboratoryManagerAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, laboratory.OrganizationId, laboratory.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const body: RequestBody = event.body ? JSON.parse(event.body) : {};
    const dryRun = body.dryRun === true;
    const retentionMonths = getRetentionMonthsOrDefault(body.retentionMonths ?? laboratory.RunRetentionMonths);

    const runs: LaboratoryRun[] = await laboratoryRunService.queryByLaboratoryId(laboratoryId);
    const terminalRuns = runs.filter((r) => isTerminalLaboratoryRunStatus(r.Status));

    let updated = 0;
    let removed = 0;
    let skipped = 0;

    for (const run of terminalRuns) {
      const now = new Date();
      const terminalAtIso = getTerminalAtIsoString(run, now);

      const needsTerminalAt = run.TerminalAt == null;
      const shouldHaveExpiry = shouldExpireWithRetentionMonths(retentionMonths);
      const desiredExpiresAt = shouldHaveExpiry
        ? calculateExpiresAtEpochSeconds(new Date(terminalAtIso), retentionMonths)
        : undefined;

      const needsExpiresAtSet = shouldHaveExpiry && run.ExpiresAt !== desiredExpiresAt;
      const needsExpiresAtRemove = !shouldHaveExpiry && run.ExpiresAt != null;

      if (!needsTerminalAt && !needsExpiresAtSet && !needsExpiresAtRemove) {
        skipped++;
        continue;
      }

      if (dryRun) {
        skipped++;
        continue;
      }

      const result = await laboratoryRunService.updateRetentionMetadata({
        LaboratoryId: run.LaboratoryId,
        RunId: run.RunId,
        set: {
          ...(needsTerminalAt ? { TerminalAt: terminalAtIso } : {}),
          ...(needsExpiresAtSet && desiredExpiresAt != null ? { ExpiresAt: desiredExpiresAt } : {}),
          ModifiedAt: now.toISOString(),
          ModifiedBy: 'Run Retention Policy',
        },
        remove: needsExpiresAtRemove ? ['ExpiresAt'] : [],
      });

      if (needsExpiresAtRemove) removed++;
      if (needsTerminalAt || needsExpiresAtSet) updated++;
      // keep lint happy, ensure we "use" result
      void result;
    }

    return buildResponse(
      200,
      JSON.stringify({
        Status: 'Success',
        LaboratoryId: laboratoryId,
        RetentionMonthsApplied: retentionMonths,
        TerminalRuns: terminalRuns.length,
        Updated: updated,
        Removed: removed,
        Skipped: skipped,
        DryRun: dryRun,
      }),
      event,
    );
  } catch (err: any) {
    return buildErrorResponse(err, event);
  }
};
