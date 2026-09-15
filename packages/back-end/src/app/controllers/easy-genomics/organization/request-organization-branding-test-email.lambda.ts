import { buildErrorResponse, buildResponse } from '@easy-genomics/shared-lib/lib/app/utils/common';
import { InvalidRequestError, UnauthorizedAccessError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import { OrganizationBrandingTestEmailRequestSchema } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/organization-email-branding';
import { OrganizationBrandingTestEmailRequest } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-email-branding';
import { APIGatewayProxyResult, APIGatewayProxyWithCognitoAuthorizerEvent, Handler } from 'aws-lambda';
import { SesService } from '@BE/services/ses-service';
import { validateOrganizationAdminAccess, validateSystemAdminAccess } from '@BE/utils/auth-utils';

const sesService = new SesService({
  accountId: process.env.ACCOUNT_ID!,
  region: process.env.REGION!,
  domainName: process.env.DOMAIN_NAME!,
  envType: process.env.ENV_TYPE!,
  envName: process.env.ENV_NAME!,
});

/**
 * This POST /easy-genomics/organization/request-organization-branding-test-email
 * API sends the requesting org admin a real rendered Run Completion email using synthetic run
 * data and whatever branding values are in the request body — including unsaved ones — so they
 * can check the result before saving.
 *
 * OrganizationId travels in the request body rather than the URL path: the 'request-'
 * Lambda filename verb never registers a path-level {id} resource (only read-/update-/
 * cancel-/patch-/delete- do — see ALLOWED_LAMBDA_FUNCTION_OPERATIONS_WITH_RESOURCE_ID in
 * verb-operations.ts and lambda-construct.ts), so this mirrors the OrganizationId-in-body
 * pattern used by create-organization-logo-upload-request.lambda.ts.
 *
 * @param event
 */
export const handler: Handler = async (
  event: APIGatewayProxyWithCognitoAuthorizerEvent,
): Promise<APIGatewayProxyResult> => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    const request: OrganizationBrandingTestEmailRequest = event.isBase64Encoded
      ? JSON.parse(atob(event.body!))
      : JSON.parse(event.body!);
    if (!OrganizationBrandingTestEmailRequestSchema.safeParse(request).success) throw new InvalidRequestError();

    const organizationId: string = request.OrganizationId;
    if (!(validateSystemAdminAccess(event) || validateOrganizationAdminAccess(event, organizationId))) {
      throw new UnauthorizedAccessError();
    }

    const requestingAdminEmail: string = event.requestContext.authorizer.claims.email;

    try {
      await sesService.sendRunCompletionEmail(requestingAdminEmail, {
        runName: 'Sample Run',
        status: 'COMPLETED',
        laboratoryName: 'Sample Laboratory',
        workflowName: 'nf-core/demo-1.0.1',
        runDurationSeconds: 911,
        runId: 'sample-run-id',
        laboratoryId: 'sample-laboratory-id',
        logoUrl: request.EmailBrandingLogoUrl,
      });
    } catch (sendError) {
      console.error(sendError);
      // Most likely cause in non-prod environments is SES sandbox mode rejecting sends to
      // an unverified recipient address — surface an actionable message instead of the
      // generic unclassified error buildErrorResponse would otherwise produce.
      throw new InvalidRequestError(
        "Could not send test email — check that this environment's SES configuration allows sending to this address",
      );
    }

    return buildResponse(200, JSON.stringify({ Sent: true }), event);
  } catch (err: any) {
    console.error(err);
    return buildErrorResponse(err, event);
  }
};
