jest.mock('../../../../src/app/services/easy-genomics/laboratory-service');
jest.mock('../../../../src/app/services/easy-genomics/laboratory-user-service');
jest.mock('../../../../src/app/services/easy-genomics/user-service');
jest.mock('../../../../src/app/services/ses-service');

import { LaboratoryService } from '../../../../src/app/services/easy-genomics/laboratory-service';
import { LaboratoryUserService } from '../../../../src/app/services/easy-genomics/laboratory-user-service';
import { NotificationService } from '../../../../src/app/services/easy-genomics/notification-service';
import { UserService } from '../../../../src/app/services/easy-genomics/user-service';
import { SesService } from '../../../../src/app/services/ses-service';

// `NotificationService` uses a module-scope singleton (`new UserService()`), constructed once at
// import time. Jest's class automock snapshots UserService's non-field prototype methods (`get`,
// `add`, `update`, `delete`) as frozen own-instance properties at that construction moment, so
// reassigning `UserService.prototype.get` from inside a test never reaches the singleton. Grabbing
// the actual constructed instance via `mock.instances` and mutating its own `get`/`listUsers`
// properties directly is what actually takes effect.
const userServiceInstance = (UserService as jest.MockedClass<typeof UserService>).mock
  .instances[0] as jest.Mocked<UserService>;
// SesService.sendRunCompletionEmail is a real prototype method too, so it needs the same
// instance-targeted mocking as UserService.get (see comment above).
const sesServiceInstance = (SesService as jest.MockedClass<typeof SesService>).mock
  .instances[0] as jest.Mocked<SesService>;

describe('NotificationService.notifyRunCompletion', () => {
  const run = {
    RunId: 'run-1',
    LaboratoryId: 'lab-1',
    UserId: 'owner-1',
    RunName: 'My Run',
    Status: 'COMPLETED',
    WorkflowName: 'wf',
    RunDurationSeconds: 100,
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({ LaboratoryId: 'lab-1', Name: 'Test Lab', NotificationsEnabled: true });
    sesServiceInstance.sendRunCompletionEmail = jest.fn().mockResolvedValue({});
    userServiceInstance.get = jest.fn();
    userServiceInstance.listUsers = jest.fn().mockResolvedValue([]);
  });

  it('skips entirely when the lab has NotificationsEnabled=false', async () => {
    (LaboratoryService as jest.MockedClass<typeof LaboratoryService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue({ LaboratoryId: 'lab-1', Name: 'Test Lab', NotificationsEnabled: false });

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run);

    expect(result.sent).toBe(0);
    expect(sesServiceInstance.sendRunCompletionEmail).not.toHaveBeenCalled();
  });

  it('emails the owner when NotifyOnOwnRuns is true and the status passes their filter', async () => {
    (userServiceInstance.get as jest.Mock).mockResolvedValue({
      UserId: 'owner-1',
      Email: 'owner@example.com',
      NotifyOnOwnRuns: true,
    });
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue([]);

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run);

    expect(result.sent).toBe(1);
    expect(sesServiceInstance.sendRunCompletionEmail).toHaveBeenCalledWith(
      'owner@example.com',
      expect.objectContaining({ runId: 'run-1', laboratoryId: 'lab-1' }),
    );
  });

  it('does not email the owner when NotifyOnOwnRuns is false', async () => {
    (userServiceInstance.get as jest.Mock).mockResolvedValue({
      UserId: 'owner-1',
      Email: 'owner@example.com',
      NotifyOnOwnRuns: false,
    });
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue([]);

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run);

    expect(result.sent).toBe(0);
  });

  it('emails opted-in lab members in addition to the owner, without duplicating the owner', async () => {
    (userServiceInstance.get as jest.Mock).mockResolvedValue({
      UserId: 'owner-1',
      Email: 'owner@example.com',
      NotifyOnOwnRuns: false,
    });
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue([
        { UserId: 'owner-1', NotifyOnLabRuns: true },
        { UserId: 'member-2', NotifyOnLabRuns: true },
        { UserId: 'member-3', NotifyOnLabRuns: false },
      ]);
    (userServiceInstance.listUsers as jest.Mock).mockResolvedValue([
      { UserId: 'owner-1', Email: 'owner@example.com' },
      { UserId: 'member-2', Email: 'member2@example.com' },
    ]);

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run);

    expect(result.sent).toBe(2);
    const calledAddresses = (sesServiceInstance.sendRunCompletionEmail as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calledAddresses.sort()).toEqual(['member2@example.com', 'owner@example.com']);
  });

  it('does not let one recipient send failure abort the batch for the remaining recipients', async () => {
    (userServiceInstance.get as jest.Mock).mockResolvedValue({
      UserId: 'owner-1',
      Email: 'owner@example.com',
      NotifyOnOwnRuns: true,
    });
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue([{ UserId: 'member-2', NotifyOnLabRuns: true }]);
    (userServiceInstance.listUsers as jest.Mock).mockResolvedValue([
      { UserId: 'member-2', Email: 'member2@example.com' },
    ]);
    (sesServiceInstance.sendRunCompletionEmail as jest.Mock).mockImplementation((toAddress: string) =>
      toAddress === 'owner@example.com' ? Promise.reject(new Error('SES throttled')) : Promise.resolve({}),
    );

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run);

    expect(result.sent).toBe(1);
    expect(sesServiceInstance.sendRunCompletionEmail).toHaveBeenCalledTimes(2);
    expect(sesServiceInstance.sendRunCompletionEmail).toHaveBeenCalledWith('member2@example.com', expect.anything());
  });

  it('respects failures_only filter, excluding a COMPLETED run for a failures-only subscriber', async () => {
    (userServiceInstance.get as jest.Mock).mockResolvedValue({
      UserId: 'owner-1',
      Email: 'owner@example.com',
      NotifyOnOwnRuns: true,
      NotificationEventFilter: 'failures_only',
    });
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue([]);

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run); // run.Status === 'COMPLETED'

    expect(result.sent).toBe(0);
  });

  it('deduplicates when owner has NotifyOnOwnRuns=true and also appears in lab-member list with NotifyOnLabRuns=true', async () => {
    (userServiceInstance.get as jest.Mock).mockResolvedValue({
      UserId: 'owner-1',
      Email: 'owner@example.com',
      NotifyOnOwnRuns: true,
    });
    (LaboratoryUserService as jest.MockedClass<typeof LaboratoryUserService>).prototype.queryByLaboratoryId = jest
      .fn()
      .mockResolvedValue([
        { UserId: 'owner-1', NotifyOnLabRuns: true },
        { UserId: 'member-2', NotifyOnLabRuns: true },
      ]);
    (userServiceInstance.listUsers as jest.Mock).mockResolvedValue([
      { UserId: 'owner-1', Email: 'owner@example.com' },
      { UserId: 'member-2', Email: 'member2@example.com' },
    ]);

    const service = new NotificationService();
    const result = await service.notifyRunCompletion(run);

    expect(result.sent).toBe(2);
    expect(sesServiceInstance.sendRunCompletionEmail).toHaveBeenCalledTimes(2);
    const calledAddresses = (sesServiceInstance.sendRunCompletionEmail as jest.Mock).mock.calls.map((c) => c[0]);
    expect(calledAddresses.sort()).toEqual(['member2@example.com', 'owner@example.com']);
    // Specifically assert the owner's email was sent exactly once, not twice
    const ownerCallCount = calledAddresses.filter((addr) => addr === 'owner@example.com').length;
    expect(ownerCallCount).toBe(1);
  });
});
