process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import { LaboratoryUser } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-user';
import { LaboratoryUserService } from '../../../../src/app/services/easy-genomics/laboratory-user-service';

const LAB_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = '00000000-0000-0000-0000-000000000002';
const ORG_ID = '00000000-0000-0000-0000-000000000003';

const BASE_LAB_USER = {
  LaboratoryId: LAB_ID,
  UserId: USER_ID,
  OrganizationId: ORG_ID,
  Status: 'Active',
  LabManager: false,
  LabTechnician: true,
} as LaboratoryUser;

/**
 * `NotifyOnLabRunsAdditionalEmails` round-trips through the generic `update()` path as a DynamoDB
 * String Set (SS), which `unmarshall()` turns into a native `Set` — the same failure mode already
 * hit for LaboratoryRun.InputFileKeys. These tests confirm every read path coerces it back to a
 * plain string[] regardless of whether DynamoDB actually returned an SS, an L, or nothing at all.
 */
describe('LaboratoryUserService NotifyOnLabRunsAdditionalEmails coercion', () => {
  let svc: LaboratoryUserService;

  beforeEach(() => {
    svc = new LaboratoryUserService();
  });

  it('get() coerces a String Set response into a plain array', async () => {
    const item = marshall({ ...BASE_LAB_USER });
    item.NotifyOnLabRunsAdditionalEmails = { SS: ['a@example.com', 'b@example.com'] };
    jest
      .spyOn(svc as unknown as { getItem: jest.Mock }, 'getItem')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: item });

    const result = await svc.get(LAB_ID, USER_ID);

    expect(Array.isArray(result.NotifyOnLabRunsAdditionalEmails)).toBe(true);
    expect(result.NotifyOnLabRunsAdditionalEmails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('queryByLaboratoryId() coerces a String Set response on every item', async () => {
    const item = marshall({ ...BASE_LAB_USER });
    item.NotifyOnLabRunsAdditionalEmails = { SS: ['c@example.com'] };
    jest
      .spyOn(svc as unknown as { queryItems: jest.Mock }, 'queryItems')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Items: [item] });

    const results = await svc.queryByLaboratoryId(LAB_ID);

    expect(results[0].NotifyOnLabRunsAdditionalEmails).toEqual(['c@example.com']);
  });

  it('update() coerces its own String Set return value back into a plain array', async () => {
    const attributes = marshall({ ...BASE_LAB_USER, NotifyOnLabRuns: true });
    attributes.NotifyOnLabRunsAdditionalEmails = { SS: ['d@example.com'] };
    jest
      .spyOn(svc as unknown as { updateItem: jest.Mock }, 'updateItem')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Attributes: attributes });

    const result = await svc.update({
      ...BASE_LAB_USER,
      NotifyOnLabRuns: true,
      NotifyOnLabRunsAdditionalEmails: ['d@example.com'],
    });

    expect(Array.isArray(result.NotifyOnLabRunsAdditionalEmails)).toBe(true);
    expect(result.NotifyOnLabRunsAdditionalEmails).toEqual(['d@example.com']);
  });

  it('leaves a normal List (plain array) response untouched', async () => {
    const item = marshall({ ...BASE_LAB_USER, NotifyOnLabRunsAdditionalEmails: ['e@example.com'] });
    jest
      .spyOn(svc as unknown as { getItem: jest.Mock }, 'getItem')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: item });

    const result = await svc.get(LAB_ID, USER_ID);

    expect(result.NotifyOnLabRunsAdditionalEmails).toEqual(['e@example.com']);
  });

  it('leaves the field undefined when it was never set', async () => {
    const item = marshall({ ...BASE_LAB_USER });
    jest
      .spyOn(svc as unknown as { getItem: jest.Mock }, 'getItem')
      .mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: item });

    const result = await svc.get(LAB_ID, USER_ID);

    expect(result.NotifyOnLabRunsAdditionalEmails).toBeUndefined();
  });
});
