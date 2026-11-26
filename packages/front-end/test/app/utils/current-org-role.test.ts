import { OrganizationAccess } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import { currentOrgRole } from '@FE/utils/current-org-role';

type LabStatus = 'Active' | 'Inactive' | 'Invited';
const lab = (LabManager: boolean, LabTechnician: boolean, Status: LabStatus = 'Active') => ({
  Status,
  LabManager,
  LabTechnician,
});
const access = (permissions: Record<string, unknown>) => permissions as OrganizationAccess;

describe('currentOrgRole', () => {
  it('is System admin for a superuser, even with no org permissions or current org', () => {
    expect(currentOrgRole(true, null, null)).toBe('System admin');
  });

  it('is Organization admin for an admin of the current org, ignoring lab entries', () => {
    const permissions = access({
      'org-a': { Status: 'Active', OrganizationAdmin: true, LaboratoryAccess: { l1: lab(false, true) } },
    });
    expect(currentOrgRole(false, permissions, 'org-a')).toBe('Organization admin');
  });

  it('is Lab manager when managing at least one active lab', () => {
    const permissions = access({
      'org-a': { Status: 'Active', LaboratoryAccess: { l1: lab(false, true), l2: lab(true, false) } },
    });
    expect(currentOrgRole(false, permissions, 'org-a')).toBe('Lab manager');
  });

  it('is Lab technician with only technician access to active labs', () => {
    const permissions = access({ 'org-a': { Status: 'Active', LaboratoryAccess: { l1: lab(false, true) } } });
    expect(currentOrgRole(false, permissions, 'org-a')).toBe('Lab technician');
  });

  it('treats a lab flagged both manager and technician as manager', () => {
    const permissions = access({ 'org-a': { Status: 'Active', LaboratoryAccess: { l1: lab(true, true) } } });
    expect(currentOrgRole(false, permissions, 'org-a')).toBe('Lab manager');
  });

  it('ignores inactive and invited labs', () => {
    const permissions = access({
      'org-a': {
        Status: 'Active',
        LaboratoryAccess: { l1: lab(true, false, 'Inactive'), l2: lab(false, true, 'Invited') },
      },
    });
    expect(currentOrgRole(false, permissions, 'org-a')).toBeNull();
  });

  it('is null when the current org entry is not active, even for an admin', () => {
    expect(
      currentOrgRole(false, access({ 'org-a': { Status: 'Invited', OrganizationAdmin: true } }), 'org-a'),
    ).toBeNull();
    expect(
      currentOrgRole(false, access({ 'org-a': { Status: 'Inactive', OrganizationAdmin: true } }), 'org-a'),
    ).toBeNull();
  });

  it('only looks at the current org', () => {
    expect(
      currentOrgRole(false, access({ 'org-b': { Status: 'Active', OrganizationAdmin: true } }), 'org-a'),
    ).toBeNull();
  });

  it('is null with no current org', () => {
    expect(currentOrgRole(false, access({ 'org-a': { Status: 'Active', OrganizationAdmin: true } }), null)).toBeNull();
  });
});
