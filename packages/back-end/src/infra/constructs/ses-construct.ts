import { RemovalPolicy, StackProps } from 'aws-cdk-lib';
import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { CfnTemplate, EmailIdentity, Identity } from 'aws-cdk-lib/aws-ses';
import { Construct } from 'constructs';

export interface SesConstructProps extends StackProps {
  awsAccount: string;
  awsRegion: string;
  appDomainName: string;
  awsHostedZoneId?: string;
  emailSender: string;
  envType: string;
  envName: string;
}

/**
 * This SES (Simple Email Service) Construct sets up SES Email Identity and email templates.
 */
export class SesConstruct extends Construct {
  readonly props: SesConstructProps;
  readonly templateNamePrefix: string;

  constructor(scope: Construct, id: string, props: SesConstructProps) {
    super(scope, id);
    this.props = props;
    this.templateNamePrefix = props.envType !== 'prod' ? `${props.envName}-${props.envType}-` : '';

    if (!this.props.awsHostedZoneId) {
      console.log('Skipping SES configuration - AWS HostedZoneId not configured');
    } else {
      console.log(`Proceeding with SES configuration with AWS HostedZoneId: ${this.props.awsHostedZoneId}`);
      const hostedZone: IHostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId: this.props.awsHostedZoneId,
        zoneName: this.props.appDomainName,
      });

      const emailDomainIdentity = new EmailIdentity(this, 'VerifiedEmailDomainIdentity', {
        identity: Identity.publicHostedZone(hostedZone),
        mailFromDomain: `mail.${this.props.appDomainName}`,
      });
      emailDomainIdentity.applyRemovalPolicy(RemovalPolicy.DESTROY);

      this.setupNewUserInvitationEmailTemplate();
      this.setupExistingUserCourtesyEmailTemplate();
      this.setupUserForgotPasswordEmailTemplate();
    }
  }

  private setupNewUserInvitationEmailTemplate() {
    const newUserInvitationEmailTemplate: CfnTemplate = new CfnTemplate(this, 'NewUserInvitationEmailTemplate', {
      template: {
        templateName: `${this.templateNamePrefix}NewUserInvitationEmailTemplate`,
        subjectPart: "You've been invited to Easy Genomics",
        htmlPart: `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>You've been invited to Easy Genomics</title>
    <style type="text/css">
        /* Client-specific resets */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }

        /* Reset styles */
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
        table { border-collapse: collapse !important; }

        /* Outlook-specific fixes */
        .ExternalClass { width: 100%; }
        .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; }
        #outlook a { padding: 0; }

        /* Mobile styles */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; }
            .fluid { max-width: 100% !important; height: auto !important; margin-left: auto !important; margin-right: auto !important; }
            .stack-column-center { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; text-align: center !important; }
        }
    </style>
    <!--[if mso]>
    <style type="text/css">
        .fallback-font { font-family: Arial, sans-serif !important; }
        .button-fallback { background: transparent !important; }
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, sans-serif;">
    <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px;">
        You've been invited to join Easy Genomics - accept your invitation to get started.
    </div>
    <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px;">
        &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279;
    </div>

    <center style="width: 100%; background: #ffffff;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="600" style="margin: auto; background-color: #ffffff;" class="email-container">
            <!-- Logo -->
            <tr>
                <td style="padding: 20px 0; text-align: center">
                    <img src="{{EASY_GENOMICS_EMAIL_LOGO}}" width="200" alt="Easy Genomics Logo" style="height: auto; display: block; margin: auto;" />
                </td>
            </tr>

            <!-- Main Content -->
            <tr>
                <td style="background-color: #fafafa; padding: 40px 40px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="text-align: center; font-family: Arial, sans-serif;">
                                <h1 style="margin: 0 0 20px; font-size: 28px; line-height: 36px; color: #12181f; font-weight: normal;">You've been invited</h1>
                                <p style="margin: 0 0 20px; font-size: 14px; line-height: 21px; color: #323840;">to the Easy Genomics Organization '{{ ORGANIZATION_NAME }}'. Click the link below to set up your account and get started. This link will expire in 7 days.</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 0; text-align: center;">
                                <!--[if mso]>
                                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://{{DOMAIN_NAME}}/accept-invitation?invite={{INVITATION_JWT}}" style="height:48px;v-text-anchor:middle;width:180px;" arcsize="10%" strokecolor="#5524e0" fillcolor="#5524e0">
                                <w:anchorlock/>
                                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Accept Invite</center>
                                </v:roundrect>
                                <![endif]-->
                                <!--[if !mso]><!-->
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: auto;">
                                    <tr>
                                        <td style="border-radius: 4px; background: #5524e0; text-align: center;">
                                            <a href="https://{{DOMAIN_NAME}}/accept-invitation?invite={{INVITATION_JWT}}" style="background: #5524e0; border: 15px solid #5524e0; color: #ffffff; font-size: 14px; line-height: 1.1; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
                                                Accept Invite
                                            </a>
                                        </td>
                                    </tr>
                                </table>
                                <!--<![endif]-->
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            <!-- Divider -->
            <tr>
                <td style="background-color: #fafafa; padding: 20px 40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                        <tr>
                            <td height="1" style="background-color: #e5e5e5; font-size: 1px; line-height: 1px;">&nbsp;</td>
                        </tr>
                    </table>
                </td>
            </tr>

            <!-- Footer -->
            <tr>
                <td style="background-color: #fafafa; padding: 20px 40px 40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="padding-bottom: 20px; color: #323840; font-size: 14px; font-family: Arial, sans-serif;">
                                Sent from Easy Genomics
                            </td>
                        </tr>
                        <tr>
                            <td style="color: #787778; font-size: 12px; font-family: Arial, sans-serif;">
                                © {{COPYRIGHT_YEAR}} Easy Genomics, Inc. All rights reserved.
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </center>
</body>
</html>
        `,
      },
    });
    newUserInvitationEmailTemplate.applyRemovalPolicy(RemovalPolicy.DESTROY);

    return newUserInvitationEmailTemplate;
  }

  private setupExistingUserCourtesyEmailTemplate() {
    const invitationEmailTemplate: CfnTemplate = new CfnTemplate(this, 'ExistingUserCourtesyEmailTemplate', {
      template: {
        templateName: `${this.templateNamePrefix}ExistingUserCourtesyEmailTemplate`,
        subjectPart: "You've been added to an Easy Genomics Organization",
        htmlPart: `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>You've been added to an Easy Genomics Organization</title>
    <style type="text/css">
        /* Client-specific resets */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }

        /* Reset styles */
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
        table { border-collapse: collapse !important; }

        /* Outlook-specific fixes */
        .ExternalClass { width: 100%; }
        .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; }
        #outlook a { padding: 0; }

        /* Mobile styles */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; }
            .fluid { max-width: 100% !important; height: auto !important; margin-left: auto !important; margin-right: auto !important; }
            .stack-column-center { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; text-align: center !important; }
        }
    </style>
    <!--[if mso]>
    <style type="text/css">
        * { font-family: Arial, sans-serif !important; }
        .button-td { background: transparent !important; }
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, sans-serif;">
    <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px;">
        You've been added to an Easy Genomics Organization - courtesy notification.
    </div>
    <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px;">
        &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279;
    </div>

    <center style="width: 100%; background: #ffffff;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="600" style="margin: auto; background-color: #ffffff;" class="email-container">
            <!-- Logo -->
            <tr>
                <td style="padding: 20px 0; text-align: center">
                    <img src="{{EASY_GENOMICS_EMAIL_LOGO}}" width="200" alt="Easy Genomics Logo" style="height: auto; display: block; margin: auto;" />
                </td>
            </tr>

            <!-- Main Content -->
            <tr>
                <td style="background-color: #fafafa; padding: 40px 40px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="text-align: center; font-family: Arial, sans-serif;">
                                <h1 style="margin: 0 0 20px; font-size: 28px; line-height: 36px; color: #12181f; font-weight: normal;">You've been added</h1>
                                <p style="margin: 0 0 20px; font-size: 14px; line-height: 21px; color: #323840;">to the Easy Genomics Organization '{{ ORGANIZATION_NAME }}'. This is a courtesy notification and no action is required.</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            <!-- Divider -->
            <tr>
                <td style="background-color: #fafafa; padding: 20px 40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: collapse;">
                        <tr>
                            <td height="1" style="background-color: #e5e5e5; font-size: 1px; line-height: 1px;">&nbsp;</td>
                        </tr>
                    </table>
                </td>
            </tr>

            <!-- Footer -->
            <tr>
                <td style="background-color: #fafafa; padding: 20px 40px 40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="padding-bottom: 20px; color: #323840; font-size: 14px; font-family: Arial, sans-serif;">
                                Sent from Easy Genomics
                            </td>
                        </tr>
                        <tr>
                            <td style="color: #787778; font-size: 12px; font-family: Arial, sans-serif;">
                                © {{COPYRIGHT_YEAR}} Easy Genomics, Inc. All rights reserved.
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </center>
</body>
</html>
        `,
      },
    });
    invitationEmailTemplate.applyRemovalPolicy(RemovalPolicy.DESTROY);

    return invitationEmailTemplate;
  }

  private setupUserForgotPasswordEmailTemplate() {
    const forgotPasswordEmailTemplate: CfnTemplate = new CfnTemplate(this, 'UserForgotPasswordEmailTemplate', {
      template: {
        templateName: `${this.templateNamePrefix}UserForgotPasswordEmailTemplate`,
        subjectPart: 'Reset Your Easy Genomics Password',
        htmlPart: `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Reset Your Easy Genomics Password</title>
    <style type="text/css">
        /* Client-specific resets */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }

        /* Reset styles */
        body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
        table { border-collapse: collapse !important; }

        /* Outlook-specific fixes */
        .ExternalClass { width: 100%; }
        .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; }
        #outlook a { padding: 0; }

        /* Mobile styles */
        @media screen and (max-width: 600px) {
            .email-container { width: 100% !important; }
            .fluid { max-width: 100% !important; height: auto !important; margin-left: auto !important; margin-right: auto !important; }
            .stack-column-center { display: block !important; width: 100% !important; max-width: 100% !important; direction: ltr !important; text-align: center !important; }
        }
    </style>
    <!--[if mso]>
    <style type="text/css">
        * { font-family: Arial, sans-serif !important; }
        .button-td { background: transparent !important; }
    </style>
    <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: Arial, sans-serif;">
    <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px;">
        Reset your Easy Genomics password - secure link inside
    </div>
    <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px;">
        &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279; &#847; &zwnj; &nbsp; &#8199; &#65279;
    </div>

    <center style="width: 100%; background: #ffffff;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="600" style="margin: auto; background-color: #ffffff;" class="email-container">
            <!-- Logo -->
            <tr>
                <td style="padding: 20px 0; text-align: center">
                    <img src="{{EASY_GENOMICS_EMAIL_LOGO}}" width="200" alt="Easy Genomics Logo" style="height: auto; display: block; margin: auto;" />
                </td>
            </tr>

            <!-- Lock Icon -->
            <tr>
                <td style="padding: 20px 0; text-align: center;">
                    <img src="{{LOCK_IMAGE}}" width="48" height="48" alt="" style="height: auto; display: block; margin: auto;" />
                </td>
            </tr>

            <!-- Main Content -->
            <tr>
                <td style="background-color: #fafafa; padding: 40px 40px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="text-align: center; font-family: Arial, sans-serif;">
                                <h1 style="margin: 0 0 20px; font-size: 28px; line-height: 36px; color: #12181f; font-weight: normal;">Forgot your password?</h1>
                                <p style="margin: 0 0 20px; font-size: 14px; line-height: 21px; color: #323840;">Please click the button below to reset your password. This link will expire in 1 hour.</p>
                            </td>
                        </tr>
                        <tr>
                            <td style="padding: 20px 0; text-align: center;">
                                <!--[if mso]>
                                <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://{{DOMAIN_NAME}}/reset-password?forgot-password={{FORGOT_PASSWORD_JWT}}" style="height:48px;v-text-anchor:middle;width:180px;" arcsize="10%" strokecolor="#5524e0" fillcolor="#5524e0">
                                <w:anchorlock/>
                                <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Reset Password</center>
                                </v:roundrect>
                                <![endif]-->
                                <!--[if !mso]><!-->
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: auto;">
                                    <tr>
                                        <td style="border-radius: 4px; background: #5524e0; text-align: center;">
                                            <a href="https://{{DOMAIN_NAME}}/reset-password?forgot-password={{FORGOT_PASSWORD_JWT}}" 
                                               style="background: #5524e0; border: 15px solid #5524e0; color: #ffffff; font-size: 14px; line-height: 1.1; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block; font-family: Arial, sans-serif;">
                                                Reset Password
                                            </a>
                                        </td>
                                    </tr>
                                </table>
                                <!--<![endif]-->
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>

            <!-- Footer -->
            <tr>
                <td style="background-color: #fafafa; padding: 20px 40px 40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                            <td style="padding-bottom: 20px; color: #323840; font-size: 14px; font-family: Arial, sans-serif;">
                                Sent from Easy Genomics
                            </td>
                        </tr>
                        <tr>
                            <td style="color: #787778; font-size: 12px; font-family: Arial, sans-serif;">
                                © {{COPYRIGHT_YEAR}} Easy Genomics, Inc. All rights reserved.
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </center>
</body>
</html>
        `,
      },
    });
    forgotPasswordEmailTemplate.applyRemovalPolicy(RemovalPolicy.DESTROY);

    return forgotPasswordEmailTemplate;
  }
}
