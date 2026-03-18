// src/app/services/omics-lab-factory.ts
import { OmicsService } from './omics-service';
import { AwsStsService } from './sts-service';

const stsService = new AwsStsService();

/**
 * Creates an OmicsService that uses lab-scoped credentials from STS AssumeRole.
 * All Omics API calls from the returned service run under the Omics access role
 * with session tags LaboratoryId and OrganizationId, so IAM enforces access to
 * only runs tagged with that laboratory.
 *
 * @param laboratoryId - Laboratory ID (matches aws:ResourceTag/LaboratoryId on runs)
 * @param organizationId - Organization ID (matches aws:ResourceTag/OrganizationId on runs)
 * @param userId - Current user ID (e.g. cognito:username), used for session naming and optional tag
 * @returns OmicsService configured with lab-scoped credentials
 */
export async function createOmicsServiceForLab(
  laboratoryId: string,
  organizationId: string,
  userId: string,
): Promise<OmicsService> {
  const credentials = await stsService.assumeLabOmicsRole({
    laboratoryId,
    organizationId,
    userId,
  });
  return new OmicsService(credentials);
}
