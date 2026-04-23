export default class HttpError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(
    public rawMessage: string | Record<string, any> | undefined,
    statusCode: number,
    errorCode: string,
    messageOpt?: string, // optional additional message
  ) {
    super(
      typeof rawMessage === 'object'
        ? JSON.stringify(rawMessage)
        : (messageOpt ? `${rawMessage}: ${messageOpt}` : rawMessage) || '',
    );
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * Simple wrapper for a 404 error
 *
 * Is a pre-configured error with:
 * - StatusCode: 404
 *
 * @param messageOpt - optional additional message
 */
export class NotFoundError extends HttpError {
  constructor(messageOpt?: string) {
    super('Not found', 404, 'EG-101', messageOpt);
  }
}

/**
 * Missing ID in path error
 *
 * @param field
 * @param messageOpt - optional additional message
 */
export class RequiredIdNotFoundError extends HttpError {
  constructor(field: string = 'id', messageOpt?: string) {
    super(`Required ${field} is missing`, 400, 'EG-102', messageOpt);
  }
}

/**
 * Invalid body parameters request
 *
 * @param messageOpt - optional additional message
 */
export class InvalidRequestError extends HttpError {
  constructor(messageOpt?: string) {
    super('Invalid request', 400, 'EG-102', messageOpt);
  }
}

// User Access

/**
 * User name does not have the required access for the endpoint
 *
 * @param messageOpt - optional additional message
 */
export class UnauthorizedAccessError extends HttpError {
  constructor(messageOpt?: string) {
    super('Unauthorized access', 403, 'EG-103', messageOpt);
  }
}

/**
 * Laboratory is not permitted to use this workflow (allowlist).
 */
export class WorkflowAccessDeniedError extends HttpError {
  constructor(messageOpt?: string) {
    super('Workflow access denied', 403, 'EG-104', messageOpt);
  }
}

/**
 * The users organization access in Authorizer is out of date
 *
 * @param message - optional additional message
 */
export class ExpiredOrganizationAccessError extends HttpError {
  constructor(messageOpt?: string) {
    super('Expired organization access', 409, 'EG-110', messageOpt);
  }
}

// Organization Errors

/**
 * Organization already exists
 *
 * @param message - optional additional message
 */
export class OrganizationAlreadyExistsError extends HttpError {
  constructor(messageOpt?: string) {
    super('Organization already exists', 400, 'EG-201', messageOpt);
  }
}

/**
 * Organization failed to delete
 *
 * @param message - optional additional message
 */
export class OrganizationDeleteFailedError extends HttpError {
  constructor(messageOpt?: string) {
    super('Organization deletion failed', 500, 'EG-202', messageOpt);
  }
}

/**
 * Organization not found
 *
 * @param messageOpt - optional additional message
 */
export class OrganizationNotFoundError extends HttpError {
  constructor(messageOpt?: string) {
    super('Organization Not Found', 404, 'EG-203', messageOpt);
  }
}

/**
 * Organization name is already taken by another resource
 *
 * @param messageOpt - optional additional message
 */
export class OrganizationNameTakenError extends HttpError {
  constructor(messageOpt?: string) {
    super('Organization name already taken', 409, 'EG-204', messageOpt);
  }
}

// Organization Users

/**
 * Organization User already exists
 *
 * @param messageOpt - optional additional message
 */
export class OrganizationUserAlreadyExistsError extends HttpError {
  constructor(messageOpt?: string) {
    super('Organization User already exists', 400, 'EG-211', messageOpt);
  }
}

/**
 * Organization User failed to delete
 *
 * @param messageOpt - optional additional message
 */
export class OrganizationUserDeleteFailedError extends HttpError {
  constructor(messageOpt?: string) {
    super('Removing user from organization failed', 500, 'EG-212', messageOpt);
  }
}

/**
 * Organization User not found
 *
 * @param organizationId
 * @param userId
 * @param messageOpt - optional additional message
 */
export class OrganizationUserNotFoundError extends HttpError {
  constructor(organizationId: string, userId: string, messageOpt?: string) {
    super(`User '${userId}' for organization '${organizationId}' could not be found`, 404, 'EG-213', messageOpt);
  }
}

/**
 * Organization has no users
 *
 * @param messageOpt - optional additional message
 */
export class NoUsersFoundError extends HttpError {
  constructor(messageOpt?: string) {
    super('Unable to find Users for Organization', 404, 'EG-214', messageOpt);
  }
}

/**
 * Organization User status can not reverted to Invited
 *
 * @param messageOpt - optional additional message
 */
export class OrganizationUserStatusError extends HttpError {
  constructor(status: string, messageOpt?: string) {
    super(`User Organization Status already '${status}', cannot update Status to 'Invited'`, 409, 'EG-215', messageOpt);
  }
}

// Laboratory Errors

/**
 * Laboratory already exists
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryAlreadyExistsError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory already exists', 400, 'EG-301', messageOpt);
  }
}

/**
 * Laboratory failed to delete
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryDeleteFailedError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory deletion failed', 500, 'EG-302', messageOpt);
  }
}

/**
 * Laboratory not found
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryNotFoundError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory not found', 404, 'EG-303', messageOpt);
  }
}

/**
 * Laboratory name is already taken by another resource
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryNameTakenError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory name already taken', 409, 'EG-304', messageOpt);
  }
}

/**
 * Organization has no laboratories
 *
 * @param messageOpt - optional additional message
 */
export class NoLabratoriesFoundError extends HttpError {
  constructor(messageOpt?: string) {
    super('Unable to find Laboratories for Organization', 404, 'EG-305', messageOpt);
  }
}

/**
 * Laboratory WorkspaceId Unavailable
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryWorkspaceIdUnavailableError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory WorkspaceId unavailable', 400, 'EG-306', messageOpt);
  }
}

/**
 * Laboratory Access Token Unavailable
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryAccessTokenUnavailableError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory Access Token unavailable', 400, 'EG-307', messageOpt);
  }
}

/**
 * Laboratory Seqera Credentials Incorrect
 *
 * @param messageOpt - optional additional message
 */
export class LaboratorySeqeraCredentialsIncorrectError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory Seqera BaseApiUrl, WorkspaceId, or AccessToken are incorrect', 400, 'EG-308', messageOpt);
  }
}

/**
 * Laboratory User already exists
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryUserAlreadyExistsError extends HttpError {
  constructor(message?: string) {
    super(message ? `Laboratory User already exists: ${message}` : 'Laboratory User already exists', 400, 'EG-311');
  }
}

/**
 * Laboratory User failed to delete
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryUserDeleteFailedError extends HttpError {
  constructor(messageOpt?: string) {
    super('Removing user from laboratory failed', 500, 'EG-312', messageOpt);
  }
}

/**
 * Laboratory User not found
 *
 * @param laboratoryId
 * @param userId
 * @param messageOpt - optional additional message
 */
export class LaboratoryUserNotFoundError extends HttpError {
  constructor(laboratoryId: string, userId: string, messageOpt?: string) {
    super(`User '${userId}' for laboratory '${laboratoryId}' could not be found`, 404, 'EG-313', messageOpt);
  }
}

/**
 * Laboratory Run failed to delete
 *
 * @param messageOpt - optional additional message
 */
export class LaboratoryRunDeleteFailedError extends HttpError {
  constructor(messageOpt?: string) {
    super('Removing run from laboratory failed', 500, 'EG-322', messageOpt);
  }
}

/**
 * Laboratory Run not found
 *
 * @param runId
 * @param laboratoryId - optional additional message
 * @param messageOpt - optional additional message
 */
export class LaboratoryRunNotFoundError extends HttpError {
  constructor(runId: string, laboratoryId: string = 'unknown', messageOpt?: string) {
    super(`Run '${runId}' for laboratory '${laboratoryId}' could not be found`, 404, 'EG-323', messageOpt);
  }
}

/**
 * Laboratory Bucket not found
 *
 * @param laboratoryId
 * @param message - optional additional message
 */
export class LaboratoryBucketNotFoundError extends HttpError {
  constructor(laboratoryId: string, message?: string) {
    super(
      message
        ? `Laboratory '${laboratoryId}' S3 Bucket could not be found: ${message}`
        : `Laboratory '${laboratoryId}' S3 Bucket could not be found`,
      404,
      'EG-314',
    );
  }
}

/**
 * Laboratory does not have access to AWS Health Omics
 *
 * @param messageOpt - optional additional message
 */
export class MissingAWSHealthOmicsAccessError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory does not have AWS HealthOmics enabled', 403, 'EG-315', messageOpt);
  }
}

/**
 * Laboratory does not have access to NextFlow Tower / Seqera Cloud
 *
 * @param messageOpt - optional additional message
 */
export class MissingNextFlowTowerAccessError extends HttpError {
  constructor(messageOpt?: string) {
    super('Laboratory does not have Seqera Cloud / NextFlow Tower enabled', 403, 'EG-316', messageOpt);
  }
}

// User Errors

/**
 * User already exists
 *
 * @param messageOpt - optional additional message
 */
export class UserAlreadyExistsError extends HttpError {
  constructor(messageOpt?: string) {
    super('User already exists', 400, 'EG-401', messageOpt);
  }
}

/**
 * User failed to delete
 *
 * @param messageOpt - optional additional message
 */
export class UserDeleteFailedError extends HttpError {
  constructor(messageOpt?: string) {
    super('User deletion failed', 500, 'EG-402', messageOpt);
  }
}

/**
 * User not found
 *
 * @param messageOpt - optional additional message
 */
export class UserNotFoundError extends HttpError {
  constructor(messageOpt?: string) {
    super('User not found', 404, 'EG-403', messageOpt);
  }
}

/**
 * User name is already taken by another resource
 *
 * @param messageOpt - optional additional message
 */
export class UserNameTakenError extends HttpError {
  constructor(messageOpt?: string) {
    super('User name already taken', 409, 'EG-404', messageOpt);
  }
}

/**
 * User missing organization access
 *
 * @param messageOpt - optional additional message
 */
export class UserNotInOrganizationError extends HttpError {
  constructor(messageOpt?: string) {
    super('User not permitted access without first granted access to the Organization', 409, 'EG-405', messageOpt);
  }
}

// AWS Omics errors

/**
 * Omics Workflow not found
 *
 * @param workflowId
 * @param messageOpt - optional additional message
 */
export class OmicsWorkflowNotFoundError extends HttpError {
  constructor(workflowId: string, messageOpt?: string) {
    super(`Workflow '${workflowId}' could not be found`, 404, 'EG-503', messageOpt);
  }
}

// Seqera Cloud errors

/**
 * Seqera Cloud API error
 */
export class SeqeraApiError extends HttpError {
  constructor(messageOpt?: string) {
    super('Seqera Cloud API error', 400, 'EG-600', messageOpt);
  }
}
