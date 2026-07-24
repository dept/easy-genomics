import { LaboratorySchema } from '../../../../src/app/schema/easy-genomics/laboratory';
import { LaboratoryRunSchema } from '../../../../src/app/schema/easy-genomics/laboratory-run';
import {
  LaboratoryUserSchema,
  UpdateLaboratoryUserNotificationPreferenceSchema,
} from '../../../../src/app/schema/easy-genomics/laboratory-user';
import { UserSchema } from '../../../../src/app/schema/easy-genomics/user';

describe('notification preference fields', () => {
  it('accepts PollStatus and NotifiedAt on LaboratoryRunSchema', () => {
    const result = LaboratoryRunSchema.safeParse({
      LaboratoryId: '00000000-0000-0000-0000-000000000001',
      RunId: '00000000-0000-0000-0000-000000000002',
      UserId: '00000000-0000-0000-0000-000000000003',
      OrganizationId: '00000000-0000-0000-0000-000000000004',
      RunName: 'Test Run',
      Platform: 'AWS HealthOmics',
      Status: 'RUNNING',
      Owner: 'user@example.com',
      PollStatus: 'ACTIVE',
      NotifiedAt: '2026-07-24T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts NotificationsEnabled on LaboratorySchema', () => {
    const result = LaboratorySchema.safeParse({
      OrganizationId: '00000000-0000-0000-0000-000000000001',
      LaboratoryId: '00000000-0000-0000-0000-000000000002',
      Name: 'Test Lab',
      Status: 'Active',
      NotificationsEnabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts NotifyOnLabRuns on LaboratoryUserSchema and validates the preference-only update schema', () => {
    const laboratoryUser = LaboratoryUserSchema.safeParse({
      LaboratoryId: '00000000-0000-0000-0000-000000000001',
      UserId: '00000000-0000-0000-0000-000000000002',
      OrganizationId: '00000000-0000-0000-0000-000000000003',
      Status: 'Active',
      LabManager: false,
      LabTechnician: true,
      NotifyOnLabRuns: true,
    });
    expect(laboratoryUser.success).toBe(true);

    const preferenceUpdate = UpdateLaboratoryUserNotificationPreferenceSchema.safeParse({ NotifyOnLabRuns: true });
    expect(preferenceUpdate.success).toBe(true);
    expect(UpdateLaboratoryUserNotificationPreferenceSchema.safeParse({ NotifyOnLabRuns: 'yes' }).success).toBe(false);
  });

  it('accepts NotifyOnOwnRuns and NotificationEventFilter on UserSchema', () => {
    const result = UserSchema.safeParse({
      UserId: '00000000-0000-0000-0000-000000000001',
      Email: 'user@example.com',
      Status: 'Active',
      NotifyOnOwnRuns: true,
      NotificationEventFilter: 'failures_only',
    });
    expect(result.success).toBe(true);
  });
});
