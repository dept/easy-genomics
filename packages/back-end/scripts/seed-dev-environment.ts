/**
 * Seed a personal / shared non-prod Easy Genomics environment with two orgs,
 * one lab each, and attach the test users from easy-genomics.yaml (mirroring
 * sample-data roles). Idempotent — safe to re-run.
 *
 * Creates:
 *   - Default Organization  → Test Laboratory
 *   - Getting Started Org    → Test Laboratory
 *
 * Memberships (emails from config back-end.*):
 *   - org-admin-email      → OrganizationAdmin on both orgs
 *   - lab-manager-email    → LabManager on both labs
 *   - lab-technician-email → LabTechnician on both labs
 *   - sys-admin            → Cognito-only (untouched)
 *
 * Usage (from packages/back-end):
 *   pnpm run seed-dev-environment -- --stack inistal
 *   pnpm run seed-dev-environment:dry-run -- --stack inistal
 *   NAME_PREFIX=dev-inistal pnpm run seed-dev-environment
 *
 * Requires AWS credentials with DynamoDB read/write on the target env's tables.
 * Lab S3Bucket is set to the shared `{account}-{namePrefix}-lab-bucket` created
 * by DataProvisioningNestedStack for non-prod deploys.
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import {
  LaboratoryUserNotFoundError,
  OrganizationUserNotFoundError,
} from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import type { ConfigurationSettings } from '@easy-genomics/shared-lib/src/app/types/configuration';
import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { Organization } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization';
import { OrganizationUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/organization-user';
import { User } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/user';
import {
  getStackEnvName,
  loadConfigurations,
  resolveConfiguration,
} from '@easy-genomics/shared-lib/src/app/utils/configuration';
import {
  DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
  DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
} from '@easy-genomics/shared-lib/src/app/utils/laboratory-run-progress-polling';
import { LaboratoryS3AccessService } from '../src/app/services/easy-genomics/laboratory-s3-access-service';
import { LaboratoryService } from '../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '../src/app/services/easy-genomics/laboratory-user-service';
import { OrganizationService } from '../src/app/services/easy-genomics/organization-service';
import { OrganizationUserService } from '../src/app/services/easy-genomics/organization-user-service';
import { PlatformUserService } from '../src/app/services/easy-genomics/platform-user-service';
import { UserService } from '../src/app/services/easy-genomics/user-service';
import {
  DEFAULT_SEED_ORGS,
  OrgLabIds,
  SeedUserSpec,
  buildOrganizationAccessForRole,
  buildSeedUsersFromConfig,
  findLaboratoryByName,
  findOrganizationByName,
  resolveLabBucketName,
  userHasDesiredMembership,
} from './lib/seed-dev-environment-lib';

const CREATED_BY = 'seed-dev-environment';
const DEFAULT_SEQERA_API_BASE_URL = 'https://api.cloud.seqera.io';

type ResolvedEnv = {
  envName: string;
  settings: ConfigurationSettings;
  namePrefix: string;
  labBucket: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

function resolveEnv(dryRun: boolean): ResolvedEnv {
  const configPath = join(__dirname, '../../../config/easy-genomics.yaml');
  const configurations = loadConfigurations(configPath);
  const configuration = resolveConfiguration(configurations, getStackEnvName() ?? process.env.ENV_NAME);
  const envName = Object.keys(configuration)[0];
  const settings = Object.values(configuration)[0];
  const envType = settings['env-type'];

  if (envType === 'prod') {
    throw new Error('Refusing to seed a prod env-type. Use a dev / pre-prod personal environment.');
  }

  const namePrefix = process.env.NAME_PREFIX || `${envType}-${envName}`;
  const labBucket = resolveLabBucketName(settings['aws-account-id'], namePrefix);

  return { envName, settings, namePrefix, labBucket, dryRun };
}

async function ensureOrganization(
  organizationService: OrganizationService,
  organizations: Organization[],
  name: string,
  seqeraApiBaseUrl: string,
  dryRun: boolean,
): Promise<Organization> {
  const existing = findOrganizationByName(organizations, name);
  if (existing) {
    console.log(`  org exists: ${existing.Name} (${existing.OrganizationId})`);
    return existing;
  }

  const organization: Organization = {
    OrganizationId: randomUUID().toLowerCase(),
    Name: name,
    Country: 'USA',
    AwsHealthOmicsEnabled: true,
    NextFlowTowerEnabled: true,
    NextFlowTowerApiBaseUrl: seqeraApiBaseUrl,
    CreatedAt: new Date().toISOString(),
    CreatedBy: CREATED_BY,
  };

  if (dryRun) {
    console.log(`  [dry-run] would create org: ${name}`);
    return organization;
  }

  const created = await organizationService.add(organization);
  console.log(`  created org: ${created.Name} (${created.OrganizationId})`);
  organizations.push(created);
  return created;
}

async function ensureLaboratory(
  laboratoryService: LaboratoryService,
  s3AccessService: LaboratoryS3AccessService,
  organization: Organization,
  laboratoryName: string,
  labBucket: string,
  dryRun: boolean,
): Promise<Laboratory> {
  const existingLabs = await laboratoryService
    .queryByOrganizationId(organization.OrganizationId)
    .catch(() => [] as Laboratory[]);
  const existing = findLaboratoryByName(existingLabs, laboratoryName);
  if (existing) {
    console.log(`  lab exists: ${existing.Name} (${existing.LaboratoryId})`);
    if (!dryRun && existing.S3Bucket?.trim()) {
      await s3AccessService.upsert({
        LaboratoryId: existing.LaboratoryId,
        BucketName: existing.S3Bucket.trim(),
        OrganizationId: existing.OrganizationId,
        Effect: 'ALLOW',
      });
    }
    return existing;
  }

  const laboratory: Laboratory = {
    OrganizationId: organization.OrganizationId,
    LaboratoryId: randomUUID().toLowerCase(),
    Name: laboratoryName,
    Status: 'Active',
    S3Bucket: labBucket,
    AwsHealthOmicsEnabled: organization.AwsHealthOmicsEnabled ?? true,
    NextFlowTowerEnabled: organization.NextFlowTowerEnabled ?? true,
    NextFlowTowerApiBaseUrl: organization.NextFlowTowerApiBaseUrl,
    RunListStatusPollIntervalSeconds: DEFAULT_RUN_LIST_STATUS_POLL_INTERVAL_SECONDS,
    RunDetailProgressPollIntervalSeconds: DEFAULT_RUN_DETAIL_PROGRESS_POLL_INTERVAL_SECONDS,
    CreatedAt: new Date().toISOString(),
    CreatedBy: CREATED_BY,
  };

  if (dryRun) {
    console.log(`  [dry-run] would create lab: ${laboratoryName} in ${organization.Name}`);
    return laboratory;
  }

  const created = await laboratoryService.add(laboratory);
  await s3AccessService.upsert({
    LaboratoryId: created.LaboratoryId,
    BucketName: labBucket,
    OrganizationId: created.OrganizationId,
    Effect: 'ALLOW',
  });
  console.log(`  created lab: ${created.Name} (${created.LaboratoryId}) → bucket ${labBucket}`);
  return created;
}

async function findUserByEmail(userService: UserService, email: string): Promise<User | undefined> {
  const matches = await userService.queryByEmail(email);
  return matches[0];
}

async function ensureNewUserFullySeeded(
  userService: UserService,
  organizationUserService: OrganizationUserService,
  laboratoryUserService: LaboratoryUserService,
  spec: SeedUserSpec,
  orgLabs: OrgLabIds[],
  dryRun: boolean,
): Promise<User> {
  const now = new Date().toISOString();
  const userId = randomUUID().toLowerCase();
  const organizationAccess = buildOrganizationAccessForRole(spec.role, orgLabs);
  const user: User = {
    UserId: userId,
    Email: spec.email,
    FirstName: spec.firstName,
    LastName: spec.lastName,
    Status: 'Active',
    DefaultOrganization: orgLabs[0]?.organizationId,
    DefaultLaboratory: spec.role === 'OrganizationAdmin' ? undefined : orgLabs[0]?.laboratoryId,
    OrganizationAccess: organizationAccess,
    CreatedAt: now,
    CreatedBy: CREATED_BY,
  };

  if (dryRun) {
    console.log(`  [dry-run] would create user ${spec.email} (${spec.role}) with full memberships`);
    return user;
  }

  await userService.add(user);

  for (const { organizationId, laboratoryId } of orgLabs) {
    const organizationUser: OrganizationUser = {
      OrganizationId: organizationId,
      UserId: userId,
      Status: 'Active',
      OrganizationAdmin: spec.role === 'OrganizationAdmin',
      CreatedAt: now,
      CreatedBy: CREATED_BY,
    };
    await organizationUserService.add(organizationUser);

    if (spec.role === 'OrganizationAdmin') {
      continue;
    }

    const laboratoryUser: LaboratoryUser = {
      LaboratoryId: laboratoryId,
      UserId: userId,
      OrganizationId: organizationId,
      Status: 'Active',
      LabManager: spec.role === 'LabManager',
      LabTechnician: spec.role === 'LabTechnician',
      CreatedAt: now,
      CreatedBy: CREATED_BY,
    };
    await laboratoryUserService.add(laboratoryUser);
  }

  console.log(`  created user ${spec.email} (${spec.role}) → ${userId}`);
  return user;
}

async function ensureExistingUserMemberships(
  userService: UserService,
  platformUserService: PlatformUserService,
  organizationUserService: OrganizationUserService,
  laboratoryUserService: LaboratoryUserService,
  user: User,
  spec: SeedUserSpec,
  orgLabs: OrgLabIds[],
  dryRun: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  let current = user;

  for (const { organizationId, laboratoryId } of orgLabs) {
    if (userHasDesiredMembership(spec.role, organizationId, laboratoryId, current.OrganizationAccess)) {
      console.log(`  membership ok: ${spec.email} → org ${organizationId}`);
      continue;
    }

    if (dryRun) {
      console.log(`  [dry-run] would attach ${spec.email} (${spec.role}) to org ${organizationId}`);
      continue;
    }

    const existingOrgUser = await organizationUserService.get(organizationId, current.UserId).catch((err) => {
      if (err instanceof OrganizationUserNotFoundError) {
        return undefined;
      }
      throw err;
    });

    if (!existingOrgUser) {
      await platformUserService.addExistingUserToOrganization(
        { ...current, ModifiedAt: now, ModifiedBy: CREATED_BY },
        {
          OrganizationId: organizationId,
          UserId: current.UserId,
          Status: 'Active',
          OrganizationAdmin: spec.role === 'OrganizationAdmin',
          CreatedAt: now,
          CreatedBy: CREATED_BY,
        },
      );
      current = await userService.get(current.UserId);
    } else if (spec.role === 'OrganizationAdmin' && !existingOrgUser.OrganizationAdmin) {
      await platformUserService.editExistingUserAccessToOrganization(
        { ...current, ModifiedAt: now, ModifiedBy: CREATED_BY },
        {
          ...existingOrgUser,
          OrganizationAdmin: true,
          ModifiedAt: now,
          ModifiedBy: CREATED_BY,
        },
      );
      current = await userService.get(current.UserId);
    }

    if (spec.role === 'OrganizationAdmin') {
      console.log(`  attached org-admin ${spec.email} → org ${organizationId}`);
      continue;
    }

    const existingLabUser = await laboratoryUserService.get(laboratoryId, current.UserId).catch((err) => {
      if (err instanceof LaboratoryUserNotFoundError) {
        return undefined;
      }
      throw err;
    });

    if (!existingLabUser) {
      current = await userService.get(current.UserId);
      await platformUserService.addExistingUserToLaboratory(
        { ...current, ModifiedAt: now, ModifiedBy: CREATED_BY },
        {
          LaboratoryId: laboratoryId,
          UserId: current.UserId,
          OrganizationId: organizationId,
          Status: 'Active',
          LabManager: spec.role === 'LabManager',
          LabTechnician: spec.role === 'LabTechnician',
          CreatedAt: now,
          CreatedBy: CREATED_BY,
        },
      );
      current = await userService.get(current.UserId);
    }

    console.log(`  attached ${spec.role} ${spec.email} → org ${organizationId} / lab ${laboratoryId}`);
  }
}

async function ensureUser(
  userService: UserService,
  organizationUserService: OrganizationUserService,
  laboratoryUserService: LaboratoryUserService,
  platformUserService: PlatformUserService,
  spec: SeedUserSpec,
  orgLabs: OrgLabIds[],
  dryRun: boolean,
): Promise<void> {
  const existing = await findUserByEmail(userService, spec.email);

  if (!existing) {
    await ensureNewUserFullySeeded(userService, organizationUserService, laboratoryUserService, spec, orgLabs, dryRun);
    return;
  }

  await ensureExistingUserMemberships(
    userService,
    platformUserService,
    organizationUserService,
    laboratoryUserService,
    existing,
    spec,
    orgLabs,
    dryRun,
  );
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv);
  const env = resolveEnv(dryRun);

  process.env.NAME_PREFIX = env.namePrefix;
  process.env.REGION = process.env.REGION || env.settings['aws-region'];
  process.env.AWS_REGION = process.env.AWS_REGION || env.settings['aws-region'];

  console.log(`Seeding env "${env.envName}" (NAME_PREFIX=${env.namePrefix})${dryRun ? ' [dry-run]' : ''}`);

  const seqeraApiBaseUrl = env.settings['back-end']['seqera-api-base-url']?.trim() || DEFAULT_SEQERA_API_BASE_URL;

  const organizationService = new OrganizationService();
  const laboratoryService = new LaboratoryService();
  const s3AccessService = new LaboratoryS3AccessService();
  const userService = new UserService();
  const organizationUserService = new OrganizationUserService();
  const laboratoryUserService = new LaboratoryUserService();
  const platformUserService = new PlatformUserService();

  const organizations = await organizationService.list();
  const orgLabs: OrgLabIds[] = [];

  console.log('Organizations & laboratories:');
  for (const spec of DEFAULT_SEED_ORGS) {
    const organization = await ensureOrganization(
      organizationService,
      organizations,
      spec.organizationName,
      seqeraApiBaseUrl,
      dryRun,
    );
    const laboratory = await ensureLaboratory(
      laboratoryService,
      s3AccessService,
      organization,
      spec.laboratoryName,
      env.labBucket,
      dryRun,
    );
    orgLabs.push({
      organizationId: organization.OrganizationId,
      laboratoryId: laboratory.LaboratoryId,
    });
  }

  const seedUsers = buildSeedUsersFromConfig(env.settings['back-end']);
  if (seedUsers.length === 0) {
    throw new Error(
      'No seed users found in easy-genomics.yaml back-end emails (org-admin / lab-manager / lab-technician).',
    );
  }

  console.log('Users & memberships:');
  for (const seedUser of seedUsers) {
    await ensureUser(
      userService,
      organizationUserService,
      laboratoryUserService,
      platformUserService,
      seedUser,
      orgLabs,
      dryRun,
    );
  }

  console.log(dryRun ? 'Dry-run complete.' : 'Seed complete.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
