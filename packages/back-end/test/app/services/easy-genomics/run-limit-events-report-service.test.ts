process.env.NAME_PREFIX = 'unit-test';

import { RunLimitEvent } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/run-limit-events';

const mockListForPeriod = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/run-limit-event-service', () => ({
  RunLimitEventService: jest.fn().mockImplementation(() => ({
    listForPeriod: (...args: unknown[]) => mockListForPeriod(...args),
  })),
}));
const mockListUsers = jest.fn();
jest.mock('../../../../src/app/services/easy-genomics/user-service', () => ({
  UserService: jest.fn().mockImplementation(() => ({
    listUsers: (...args: unknown[]) => mockListUsers(...args),
  })),
}));

import { RunLimitEventsReportService } from '../../../../src/app/services/easy-genomics/run-limit-events-report-service';

const ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';
const TODAY = new Date('2026-11-10T12:00:00.000Z');

function event(overrides: Partial<RunLimitEvent> & { UserId: string }): RunLimitEvent {
  return {
    OrganizationId: ORGANIZATION_ID,
    EventKey: `blocked#2026-11-09#${overrides.UserId}`,
    Kind: 'blocked',
    Day: '2026-11-09',
    OccurredAt: '2026-11-09T10:00:00.000Z',
    LaboratoryId: 'lab-1',
    Platform: 'AWS HealthOmics',
    WorkflowExternalId: 'wf-1',
    Source: 'review',
    Hits: [],
    ExpiresAt: 1800000000,
    ...overrides,
  };
}

describe('RunLimitEventsReportService', () => {
  const service = new RunLimitEventsReportService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockListUsers.mockResolvedValue([]);
  });

  it('lists the kind over the resolved period and drops ExpiresAt', async () => {
    mockListForPeriod.mockResolvedValue({ events: [event({ UserId: 'u1' })], truncated: false });

    const response = await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'blocked' }, TODAY);

    expect(mockListForPeriod).toHaveBeenCalledWith(ORGANIZATION_ID, '2026-10-12', '2026-11-10', 'blocked');
    expect(response.Events).toHaveLength(1);
    expect(response.Events[0]).not.toHaveProperty('ExpiresAt');
  });

  it('names a user by preferred name, then full name', async () => {
    mockListForPeriod.mockResolvedValue({
      events: [event({ UserId: 'u1' }), event({ UserId: 'u2' })],
      truncated: false,
    });
    mockListUsers.mockResolvedValue([
      { UserId: 'u1', PreferredName: 'Ada', FirstName: 'Ada', LastName: 'Lovelace' },
      { UserId: 'u2', FirstName: 'Grace', LastName: 'Hopper' },
    ]);

    const response = await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'blocked' }, TODAY);

    expect(response.Events.map((row) => row.UserDisplayName)).toEqual(['Ada', 'Grace Hopper']);
  });

  it('names a deleted user by their stored email, then Unknown user', async () => {
    mockListForPeriod.mockResolvedValue({
      events: [event({ UserId: 'gone-1', UserEmail: 'gone@example.com' }), event({ UserId: 'gone-2' })],
      truncated: false,
    });

    const response = await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'blocked' }, TODAY);

    expect(response.Events.map((row) => row.UserDisplayName)).toEqual(['gone@example.com', 'Unknown user']);
  });

  it('looks up each user once', async () => {
    mockListForPeriod.mockResolvedValue({
      events: [event({ UserId: 'u1' }), event({ UserId: 'u1' }), event({ UserId: 'u2' })],
      truncated: false,
    });

    await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'blocked' }, TODAY);

    expect(mockListUsers).toHaveBeenCalledTimes(1);
    expect(mockListUsers).toHaveBeenCalledWith(['u1', 'u2']);
  });

  it('looks up users in batches of 100', async () => {
    const events = Array.from({ length: 150 }, (_, index) => event({ UserId: `u${index}` }));
    mockListForPeriod.mockResolvedValue({ events, truncated: false });

    await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'blocked' }, TODAY);

    expect(mockListUsers.mock.calls.map(([ids]) => ids.length)).toEqual([100, 50]);
  });

  it('does not look up users when there are no events', async () => {
    mockListForPeriod.mockResolvedValue({ events: [], truncated: false });

    const response = await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'warned' }, TODAY);

    expect(mockListUsers).not.toHaveBeenCalled();
    expect(response).toEqual({ Events: [], Truncated: false });
  });

  it('passes Truncated through', async () => {
    mockListForPeriod.mockResolvedValue({ events: [event({ UserId: 'u1' })], truncated: true });

    const response = await service.list({ organizationId: ORGANIZATION_ID, period: '30d', kind: 'blocked' }, TODAY);

    expect(response.Truncated).toBe(true);
  });
});
