// src/app/services/sts-service.ts
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';

export interface LabSessionContext {
  laboratoryId: string;
  organizationId: string;
  userId: string; // cognito:username (or internal user id)
}

export interface LabSessionCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration?: Date;
}

export class AwsStsService {
  private readonly stsClient: STSClient;
  private readonly roleArn: string;
  private readonly sessionNamePrefix: string;

  constructor(params?: { roleArn?: string; sessionNamePrefix?: string }) {
    this.stsClient = new STSClient();
    this.roleArn =
      params?.roleArn ??
      `arn:aws:iam::${process.env.ACCOUNT_ID}:role/${process.env.NAME_PREFIX}-easy-genomics-omics-access-role`;
    this.sessionNamePrefix = params?.sessionNamePrefix ?? 'lab-omics-session';
  }

  public async assumeLabOmicsRole(context: LabSessionContext): Promise<LabSessionCredentials> {
    const sessionName = `${this.sessionNamePrefix}-${context.userId}-${context.laboratoryId}`.slice(0, 64);

    const command = new AssumeRoleCommand({
      RoleArn: this.roleArn,
      RoleSessionName: sessionName,
      Tags: [
        { Key: 'LaboratoryId', Value: context.laboratoryId },
        { Key: 'OrganizationId', Value: context.organizationId },
        { Key: 'UserId', Value: context.userId },
      ],
      TransitiveTagKeys: ['LaboratoryId', 'OrganizationId'],
      DurationSeconds: 3600,
    });

    const resp = await this.stsClient.send(command);

    if (!resp.Credentials) {
      throw new Error('Failed to assume lab Omics role: missing Credentials in STS response');
    }

    return {
      accessKeyId: resp.Credentials.AccessKeyId!,
      secretAccessKey: resp.Credentials.SecretAccessKey!,
      sessionToken: resp.Credentials.SessionToken!,
      expiration: resp.Credentials.Expiration,
    };
  }
}
