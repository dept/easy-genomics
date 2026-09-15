jest.mock('../../../../src/app/services/cognito-idp-service');
jest.mock('../../../../src/app/services/easy-genomics/organization-user-service');
jest.mock('../../../../src/app/services/easy-genomics/platform-user-service');
jest.mock('../../../../src/app/services/ses-service');

import { CognitoIdpService } from '../../../../src/app/services/cognito-idp-service';
import { OrganizationUserService } from '../../../../src/app/services/easy-genomics/organization-user-service';
import { UserInviteService } from '../../../../src/app/services/easy-genomics/user-invite-service';
import { SesService } from '../../../../src/app/services/ses-service';

const cognitoIdpServiceInstance = (CognitoIdpService as jest.MockedClass<typeof CognitoIdpService>).mock
  .instances[0] as jest.Mocked<CognitoIdpService>;
const sesServiceInstance = (SesService as jest.MockedClass<typeof SesService>).mock
  .instances[0] as jest.Mocked<SesService>;
const organizationUserServiceInstance = (OrganizationUserService as jest.MockedClass<typeof OrganizationUserService>)
  .mock.instances[0] as jest.Mocked<OrganizationUserService>;

describe('UserInviteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cognitoIdpServiceInstance.adminCreateUser = jest.fn().mockResolvedValue('user-1');
    sesServiceInstance.sendExistingUserCourtesyEmail = jest.fn().mockResolvedValue({});
    organizationUserServiceInstance.get = jest.fn().mockRejectedValue(new Error('not found'));
  });

  it('inviteNewUserToOrganization passes the organization branding to adminCreateUser', async () => {
    const organization = {
      OrganizationId: 'org-1',
      Name: 'Acme Labs',
      EmailBrandingLogoUrl: 'https://acme-labs.example/logo.png',
    } as any;

    const service = new UserInviteService();
    await service.inviteNewUserToOrganization(organization, 'user@example.com', 'admin-1');

    expect(cognitoIdpServiceInstance.adminCreateUser).toHaveBeenCalledWith(
      'user@example.com',
      'org-1',
      'Acme Labs',
      false,
      { logoUrl: 'https://acme-labs.example/logo.png' },
    );
  });

  it('addExistingUserToOrganization passes the organization branding to sendExistingUserCourtesyEmail', async () => {
    const organization = {
      OrganizationId: 'org-1',
      Name: 'Acme Labs',
      EmailBrandingLogoUrl: 'https://acme-labs.example/logo.png',
    } as any;
    const user = { UserId: 'user-1', Email: 'user@example.com', Status: 'Active' } as any;

    const service = new UserInviteService();
    await service.addExistingUserToOrganization(organization, user, 'admin-1');

    expect(sesServiceInstance.sendExistingUserCourtesyEmail).toHaveBeenCalledWith('user@example.com', 'Acme Labs', {
      logoUrl: 'https://acme-labs.example/logo.png',
    });
  });
});
