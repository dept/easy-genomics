import { Laboratory } from './laboratory';
import { LaboratoryUser } from './laboratory-user';
import { Organization } from './organization';
import { OrganizationUser } from './organization-user';
import { User } from './user';

const organizationId = '61c86013-74f2-4d30-916a-70b03a97ba14';
const laboratoryId = 'bbac4190-0446-4db4-a084-cfdbc8102297';
const orgAdminUserId = 'c6705721-90ba-4d4a-9460-af2828bb4181';
const labManagerUserId = 'd03035ae-a93d-4f50-bdd5-9db2197348a5';
const labTechnicianUserId = '0577f36a-13b5-4eb6-bef0-38429e3806a1';

export const organization: Organization = {
  OrganizationId: organizationId,
  Name: 'Default Organization',
  Country: 'USA',
  AwsHealthOmicsEnabled: true,
  NextFlowTowerEnabled: true,
  NextFlowTowerApiBaseUrl: 'https://api.cloud.seqera.io',
  CreatedAt: new Date().toISOString(),
};

export const laboratory: Laboratory = {
  OrganizationId: organizationId,
  LaboratoryId: laboratoryId,
  Name: 'Test Laboratory',
  Status: 'Active',
  AwsHealthOmicsEnabled: organization.AwsHealthOmicsEnabled,
  NextFlowTowerEnabled: organization.NextFlowTowerEnabled,
  CreatedAt: new Date().toISOString(),
};

// Seeded Org Admin User for development and testing
export const orgAdminUser: User = {
  UserId: orgAdminUserId,
  Email: 'admin@easygenomics.org',
  FirstName: 'Org',
  LastName: 'Admin',
  Status: 'Active',
  DefaultOrganization: organizationId,
  CreatedAt: new Date().toISOString(),
};

export const orgAdminUserOrganizationMapping: OrganizationUser = {
  OrganizationId: organizationId,
  UserId: orgAdminUserId,
  Status: 'Active',
  OrganizationAdmin: true,
  CreatedAt: new Date().toISOString(),
};

// Seeded Lab Manager User for development and testing
export const labManagerUser: User = {
  UserId: labManagerUserId,
  Email: 'lab.manager@easygenomics.org',
  FirstName: 'Lab',
  LastName: 'Manager',
  Status: 'Active',
  DefaultOrganization: organizationId,
  CreatedAt: new Date().toISOString(),
};

export const labManagerUserOrganizationMapping: OrganizationUser = {
  OrganizationId: organizationId,
  UserId: labManagerUserId,
  Status: 'Active',
  OrganizationAdmin: false,
  CreatedAt: new Date().toISOString(),
};

export const labManagerUserLaboratoryMapping: LaboratoryUser = {
  LaboratoryId: laboratoryId,
  UserId: labManagerUserId,
  OrganizationId: organizationId,
  Status: 'Active',
  LabManager: true,
  LabTechnician: false,
  CreatedAt: new Date().toISOString(),
};

// Seeded Lab Technician User for development and testing
export const labTechnicianUser: User = {
  UserId: labTechnicianUserId,
  Email: 'lab.technician@easygenomics.org',
  FirstName: 'Lab',
  LastName: 'Technician',
  Status: 'Active',
  DefaultOrganization: organizationId,
  CreatedAt: new Date().toISOString(),
};

export const labTechnicianUserOrganizationMapping: OrganizationUser = {
  OrganizationId: organizationId,
  UserId: labTechnicianUserId,
  Status: 'Active',
  OrganizationAdmin: false,
  CreatedAt: new Date().toISOString(),
};

export const labTechnicianUserLaboratoryMapping: LaboratoryUser = {
  LaboratoryId: laboratoryId,
  UserId: labTechnicianUserId,
  OrganizationId: organizationId,
  Status: 'Active',
  LabManager: false,
  LabTechnician: true,
  CreatedAt: new Date().toISOString(),
};
