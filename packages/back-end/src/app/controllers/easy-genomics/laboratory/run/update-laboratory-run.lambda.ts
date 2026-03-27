import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import {
  InvalidRequestError,
  LaboratoryRunNotFoundError,
  RequiredIdNotFoundError,
  UnauthorizedAccessError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  EditLaboratoryRun,
  EditLaboratoryRunSchema,
} from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/laboratory-run';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { SnsProcessingEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sns-processing-event';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { LaboratoryRunService } from '@BE/services/easy-genomics/laboratory-run-service';
import { LaboratoryService } from '@BE/services/easy-genomics/laboratory-service';
import { SnsService } from '@BE/services/sns-service';
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

const snsService = new SnsService();

const laboratoryRunService = new LaboratoryRunService();
const laboratoryService = new LaboratoryService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Get Path Parameter
    const id: string = event.pathParameters?.id || '';
    if (id === '') throw new RequiredIdNotFoundError();

    const currentUserId = event.requestContext.authorizer.claims['cognito:username'];

    // Put Request Body
    const request: EditLaboratoryRun = event.isBase64Encoded ? JSON.parse(atob(event.body!)) : JSON.parse(event.body!);

    // Data validation safety check
    if (!EditLaboratoryRunSchema.safeParse(request).success) {
      throw new InvalidRequestError();
    }

    // Lookup by RunId to confirm existence before updating
    const existing: LaboratoryRun = await laboratoryRunService.queryByRunId(id);

    if (!existing) {
      throw new LaboratoryRunNotFoundError(id);
    }

    // Only available for Org Admins or Laboratory Managers and Technicians
    if (
      !(
        validateOrganizationAdminAccess(event, existing.OrganizationId) ||
        validateLaboratoryManagerAccess(event, existing.OrganizationId, existing.LaboratoryId) ||
        validateLaboratoryTechnicianAccess(event, existing.OrganizationId, existing.LaboratoryId)
      )
    ) {
      throw new UnauthorizedAccessError();
    }

    const settings: string | undefined = request.Settings ? JSON.stringify(request.Settings) : existing.Settings;
    const now = new Date();

    const laboratory = await laboratoryService.queryByLaboratoryId(existing.LaboratoryId);
    const retentionMonths = getRetentionMonthsOrDefault(laboratory?.RunRetentionMonths);

    const nextStatusTerminal = isTerminalLaboratoryRunStatus(request.Status);
    const terminalAtIso = nextStatusTerminal ? getTerminalAtIsoString(existing, now) : undefined;
    const shouldSetTerminalAt = nextStatusTerminal && existing.TerminalAt == null && terminalAtIso != null;

    const shouldSetExpiresAt =
      nextStatusTerminal &&
      existing.ExpiresAt == null &&
      shouldExpireWithRetentionMonths(retentionMonths) &&
      terminalAtIso != null;
    const expiresAt: number | undefined =
      shouldSetExpiresAt && terminalAtIso
        ? calculateExpiresAtEpochSeconds(new Date(terminalAtIso), retentionMonths)
        : undefined;

    const response: LaboratoryRun = await laboratoryRunService.update(<LaboratoryRun>{
      ...existing,
      ...request,
      Settings: settings,
      ...(expiresAt !== undefined ? { ExpiresAt: expiresAt } : {}),
      ...(shouldSetTerminalAt ? { TerminalAt: terminalAtIso } : {}),
      ModifiedAt: now.toISOString(),
      ModifiedBy: currentUserId,
    });

    //TODO: check if it is an active request

    // Queue up run status checks
    const record: SnsProcessingEvent = {
      Operation: 'UPDATE',
      Type: 'LaboratoryRun',
      Record: response,
    };
    await snsService.publish({
      TopicArn: process.env.SNS_LABORATORY_RUN_UPDATE_TOPIC,
      Message: JSON.stringify(record),
      MessageGroupId: `update-laboratory-run-${response.RunId}`,
      MessageDeduplicationId: uuidv4(),
    });

    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
