import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { RunCostsQuerySchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { RunCostsReportService } from '@BE/services/easy-genomics/run-costs-report-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const runCostsReportService = new RunCostsReportService();

export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const parsed = RunCostsQuerySchema.safeParse(event.queryStringParameters ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new InvalidRequestError(`${issue.path.join('.') || 'query'}: ${issue.message}`);
    }
    const query = parsed.data;

    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, query.organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const report = await runCostsReportService.getReport(query, new Date());
    return buildResponse(200, JSON.stringify(report), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
