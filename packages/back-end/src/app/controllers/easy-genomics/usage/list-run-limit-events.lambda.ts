import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RunLimitEventsQuerySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-limit-events';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { RunLimitEventsReportService } from '@BE/services/easy-genomics/run-limit-events-report-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const runLimitEventsReportService = new RunLimitEventsReportService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const parsed = RunLimitEventsQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new InvalidRequestError(`${issue.path.join('.') || 'query'}: ${issue.message}`);
    }
    const query = parsed.data;

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, query.organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const response = await runLimitEventsReportService.list(query, new Date());
    return buildResponse(200, JSON.stringify(response), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
