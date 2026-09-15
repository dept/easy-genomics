import { SendTemplatedEmailCommand, SendTemplatedEmailCommandOutput, SESClient } from '@aws-sdk/client-ses';
import { DEFAULT_EASY_GENOMICS_LOGO_URL, DEFAULT_LOCK_IMAGE_URL } from '@BE/utils/default-email-branding';
import { resolveEmailBrandingLogoUrl } from '@BE/utils/email-branding-logo-url';
import { formatRunStatusPhrase } from '@BE/utils/format-run-status-phrase';
import { formatRunTime } from '@BE/utils/format-run-time';

export interface SesServiceProps {
  accountId: string;
  region: string;
  domainName: string;
  envType: string;
  envName: string;
}

export class SesService {
  readonly sesClient;
  readonly props: SesServiceProps;
  readonly templateNamePrefix: string;

  public constructor(props: SesServiceProps) {
    this.props = props;
    this.sesClient = new SESClient();
    this.templateNamePrefix =
      props.envType && props.envName && props.envType !== 'prod' ? `${props.envName}-${props.envType}-` : '';
  }

  public async sendNewUserInvitationEmail(
    toAddress: string,
    organizationName: string,
    invitationJwt: string,
    branding?: { logoUrl?: string },
  ): Promise<SendTemplatedEmailCommandOutput> {
    const logRequestMessage = `Send New User Invitation Email request: ${toAddress}`;
    console.info(logRequestMessage);

    const sendTemplatedEmailCommand: SendTemplatedEmailCommand = new SendTemplatedEmailCommand({
      Source: `no.reply@${this.props.domainName}`,
      Destination: {
        ToAddresses: [toAddress],
      },
      ReplyToAddresses: [`no.reply@${this.props.domainName}`],
      ReturnPath: `no.reply@${this.props.domainName}`,
      SourceArn: `arn:aws:ses:${this.props.region}:${this.props.accountId}:identity/${this.props.domainName}`,
      Template: `${this.templateNamePrefix}NewUserInvitationEmailTemplate`,
      TemplateData: JSON.stringify({
        COPYRIGHT_YEAR: `${new Date().getFullYear()}`,
        DOMAIN_NAME: this.props.domainName,
        INVITATION_JWT: invitationJwt,
        ORGANIZATION_NAME: organizationName,
        EASY_GENOMICS_EMAIL_LOGO: resolveEmailBrandingLogoUrl(branding?.logoUrl) || DEFAULT_EASY_GENOMICS_LOGO_URL,
      }),
    });

    try {
      const response = await this.sesClient.send(sendTemplatedEmailCommand);
      console.info(`Send New Existing User Invitation Email to ${toAddress} response: `, response);
      return response;
    } catch (error: unknown) {
      throw new Error(`${logRequestMessage} unsuccessful: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async sendExistingUserCourtesyEmail(
    toAddress: string,
    organizationName: string,
    branding?: { logoUrl?: string },
  ): Promise<SendTemplatedEmailCommandOutput> {
    const logRequestMessage = `Send Existing User Courtesy Email request: ${toAddress}`;
    console.info(logRequestMessage);

    // Non-prod accounts typically run SES in sandbox: recipients must be verified, so inviting
    // arbitrary existing users fails with "Email address is not verified". Courtesy mail is
    // non-critical; skip the send so the org membership update can complete.
    if (this.props.envType && this.props.envType !== 'prod') {
      console.warn(
        `Skipping ${logRequestMessage} in ${this.props.envType}: SES sandbox cannot deliver to unverified addresses.`,
      );
      return { MessageId: 'skipped-non-prod-courtesy-email' } as SendTemplatedEmailCommandOutput;
    }

    const sendTemplatedEmailCommand: SendTemplatedEmailCommand = new SendTemplatedEmailCommand({
      Source: `no.reply@${this.props.domainName}`,
      Destination: {
        ToAddresses: [toAddress],
      },
      ReplyToAddresses: [`no.reply@${this.props.domainName}`],
      ReturnPath: `no.reply@${this.props.domainName}`,
      SourceArn: `arn:aws:ses:${this.props.region}:${this.props.accountId}:identity/${this.props.domainName}`,
      Template: `${this.templateNamePrefix}ExistingUserCourtesyEmailTemplate`,
      TemplateData: JSON.stringify({
        COPYRIGHT_YEAR: `${new Date().getFullYear()}`,
        DOMAIN_NAME: this.props.domainName,
        ORGANIZATION_NAME: organizationName,
        EASY_GENOMICS_EMAIL_LOGO: resolveEmailBrandingLogoUrl(branding?.logoUrl) || DEFAULT_EASY_GENOMICS_LOGO_URL,
      }),
    });

    try {
      const response = await this.sesClient.send(sendTemplatedEmailCommand);
      console.info(`Send Existing User Courtesy Email to ${toAddress} response: `, response);
      return response;
    } catch (error: unknown) {
      throw new Error(`${logRequestMessage} unsuccessful: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async sendUserForgotPasswordEmail(
    toAddress: string,
    forgotPasswordJwt: string,
  ): Promise<SendTemplatedEmailCommandOutput> {
    const logRequestMessage = `Send User Forgot Password Email request: ${toAddress}`;
    console.info(logRequestMessage);

    const sendTemplatedEmailCommand: SendTemplatedEmailCommand = new SendTemplatedEmailCommand({
      Source: `no.reply@${this.props.domainName}`,
      Destination: {
        ToAddresses: [toAddress],
      },
      ReplyToAddresses: [`no.reply@${this.props.domainName}`],
      ReturnPath: `no.reply@${this.props.domainName}`,
      SourceArn: `arn:aws:ses:${this.props.region}:${this.props.accountId}:identity/${this.props.domainName}`,
      Template: `${this.templateNamePrefix}UserForgotPasswordEmailTemplate`,
      TemplateData: JSON.stringify({
        COPYRIGHT_YEAR: `${new Date().getFullYear()}`,
        DOMAIN_NAME: this.props.domainName,
        FORGOT_PASSWORD_JWT: forgotPasswordJwt,
        EASY_GENOMICS_EMAIL_LOGO: DEFAULT_EASY_GENOMICS_LOGO_URL,
        LOCK_IMAGE: DEFAULT_LOCK_IMAGE_URL,
      }),
    });

    try {
      const response = await this.sesClient.send(sendTemplatedEmailCommand);
      console.info(`Send User Forgot Password Email to ${toAddress} response: `, response);
      return response;
    } catch (error: unknown) {
      throw new Error(`${logRequestMessage} unsuccessful: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async sendRunCompletionEmail(
    toAddress: string,
    data: {
      runName: string;
      status: string;
      laboratoryName: string;
      workflowName?: string;
      runDurationSeconds?: number;
      runId: string;
      laboratoryId: string;
      logoUrl?: string;
    },
  ): Promise<SendTemplatedEmailCommandOutput> {
    const logRequestMessage = `Send Run Completion Email request: ${toAddress}`;
    console.info(logRequestMessage);

    const sendTemplatedEmailCommand: SendTemplatedEmailCommand = new SendTemplatedEmailCommand({
      Source: `no.reply@${this.props.domainName}`,
      Destination: {
        ToAddresses: [toAddress],
      },
      ReplyToAddresses: [`no.reply@${this.props.domainName}`],
      ReturnPath: `no.reply@${this.props.domainName}`,
      SourceArn: `arn:aws:ses:${this.props.region}:${this.props.accountId}:identity/${this.props.domainName}`,
      Template: `${this.templateNamePrefix}RunCompletionEmailTemplate`,
      TemplateData: JSON.stringify({
        COPYRIGHT_YEAR: `${new Date().getFullYear()}`,
        DOMAIN_NAME: this.props.domainName,
        RUN_NAME: data.runName,
        STATUS_PHRASE: formatRunStatusPhrase(data.status),
        LABORATORY_NAME: data.laboratoryName,
        WORKFLOW_NAME: data.workflowName || 'N/A',
        RUN_TIME: data.runDurationSeconds != null ? formatRunTime(data.runDurationSeconds) : 'N/A',
        RUN_LINK: `https://${this.props.domainName}/labs/${data.laboratoryId}/run/${data.runId}`,
        EASY_GENOMICS_EMAIL_LOGO: resolveEmailBrandingLogoUrl(data.logoUrl) || DEFAULT_EASY_GENOMICS_LOGO_URL,
      }),
    });

    try {
      const response = await this.sesClient.send(sendTemplatedEmailCommand);
      console.info(`Send Run Completion Email to ${toAddress} response: `, response);
      return response;
    } catch (error: unknown) {
      throw new Error(`${logRequestMessage} unsuccessful: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
