import {
  OrganizationBrandingTestEmailRequest,
  OrganizationLogoUploadInfo,
  OrganizationLogoUploadRequest,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-email-branding';
import HttpFactory from '@FE/repository/factory';

class OrganizationEmailBrandingModule extends HttpFactory {
  async createLogoUploadRequest(
    orgId: string,
    req: Omit<OrganizationLogoUploadRequest, 'OrganizationId'>,
  ): Promise<OrganizationLogoUploadInfo> {
    const res = await this.call<OrganizationLogoUploadInfo>(
      'POST',
      '/organization/create-organization-logo-upload-request',
      { OrganizationId: orgId, ...req },
    );

    if (!res) {
      throw new Error('Failed to create organization logo upload request');
    }

    return res;
  }

  async requestBrandingTestEmail(
    orgId: string,
    req: Omit<OrganizationBrandingTestEmailRequest, 'OrganizationId'>,
  ): Promise<void> {
    const res = await this.call<{ Sent: boolean }>('POST', '/organization/request-organization-branding-test-email', {
      OrganizationId: orgId,
      ...req,
    });

    if (!res) {
      throw new Error('Failed to request organization branding test email');
    }
  }
}

export default OrganizationEmailBrandingModule;
