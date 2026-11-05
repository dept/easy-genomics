import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/src/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/src/app/utils/HttpError';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Context, Handler } from 'aws-lambda';
import {
  LaboratoryDataRetentionService,
  deadlineFromContext,
} from '@BE/services/easy-genomics/laboratory-data-retention-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import {
  validateLaboratoryManagerAccess,
  validateLaboratoryTechnicianAccess,
  validateOrganizationAdminAccess,
} from '@BE/utils/auth-utils';
import { getRetentionMonthsOrDefault } from '@BE/utils/laboratory-run-ttl-utils';

const laboratoryService = new LaboratoryService();
const retentionService = new LaboratoryDataRetentionService();

/** Return before API Gateway's 29s integration timeout; the daily sweep finishes whatever is left. */
const API_DEADLINE_RESERVE_MS = 8_000;

type RequestBody = {
  retentionMonths?: number;
  dryRun?: boolean;
};

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
  context: Context,
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
    // ?? preserves an explicit body value of 0; do not use || here.
    const retentionMonths = getRetentionMonthsOrDefault(body.retentionMonths ?? laboratory.RunRetentionMonths);

    const deadlineMs = dryRun ? undefined : deadlineFromContext(context, API_DEADLINE_RESERVE_MS);

    const applied = await retentionService.applyRunRetentionPolicy(laboratory, retentionMonths, {
      dryRun,
      modifiedBy: 'Run Retention Policy',
      deadlineMs,
    });

    return buildResponse(
      200,
      JSON.stringify({
        Status: 'Success',
        LaboratoryId: laboratoryId,
        RetentionMonthsApplied: retentionMonths,
        TerminalRuns: applied.terminalRuns,
        Updated: applied.updated,
        Removed: applied.removed,
        Skipped: applied.skipped,
        RunsExpireImmediately: applied.runsExpireImmediately,
        RunsExpirationDateUpdated: applied.runsExpirationDateUpdated,
        Deferred: applied.deferred,
        DryRun: dryRun,
      }),
      event,
    );
  } catch (err: any) {
    return buildErrorResponse(err, event);
  }
};
