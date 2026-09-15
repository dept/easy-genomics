process.env.NAME_PREFIX = 'unit-test';

import { marshall } from '@aws-sdk/util-dynamodb';
import {
  WorkflowRunPreset,
  WORKFLOW_RUN_PRESET_LIMIT,
} from '@easy-genomics/shared-lib/src/app/types/easy-genomics/workflow-run-preset';
import { WorkflowRunPresetService } from '../../../../src/app/services/easy-genomics/workflow-run-preset-service';

const LAB_ID = 'b1e0f6a4-1f2b-4a6d-9f1c-1a2b3c4d5e6f';
const WORKFLOW_ID = 'wf-9';
const USER_ID = 'user-1';

function presetFixture(overrides?: Partial<WorkflowRunPreset>): WorkflowRunPreset {
  return {
    LaboratoryId: LAB_ID,
    PresetKey: `USER#${USER_ID}#${WORKFLOW_ID}#3f7c1c9e-1111-4111-8111-111111111111`,
    PresetId: '3f7c1c9e-1111-4111-8111-111111111111',
    Scope: 'USER',
    WorkflowId: WORKFLOW_ID,
    Name: 'Strict QC',
    Params: { min_depth: 30, skip_qc: false },
    ...overrides,
  };
}

describe('WorkflowRunPresetService', () => {
  let svc: WorkflowRunPresetService;
  let mockPutItem: jest.Mock;
  let mockGetItem: jest.Mock;
  let mockQueryItems: jest.Mock;
  let mockDeleteItem: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new WorkflowRunPresetService();
    mockPutItem = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    mockGetItem = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    mockQueryItems = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Items: [] });
    mockDeleteItem = jest.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    (svc as unknown as { putItem: typeof mockPutItem }).putItem = mockPutItem;
    (svc as unknown as { getItem: typeof mockGetItem }).getItem = mockGetItem;
    (svc as unknown as { queryItems: typeof mockQueryItems }).queryItems = mockQueryItems;
    (svc as unknown as { deleteItem: typeof mockDeleteItem }).deleteItem = mockDeleteItem;
  });

  const owner = { LaboratoryId: LAB_ID, WorkflowId: WORKFLOW_ID, Scope: 'USER' as const, UserId: USER_ID };

  it('targets the name-prefixed table', () => {
    expect(svc.WORKFLOW_RUN_PRESET_TABLE_NAME).toEqual('unit-test-workflow-run-preset-table');
  });

  describe('createPreset', () => {
    it('writes a personal preset under a user-scoped sort key', async () => {
      const preset = await svc.createPreset(owner, 'Strict QC', { min_depth: 30 }, 'user@example.com');

      expect(preset.PresetKey).toEqual(`USER#${USER_ID}#${WORKFLOW_ID}#${preset.PresetId}`);
      expect(preset.Scope).toEqual('USER');
      expect(preset.CreatedBy).toEqual(USER_ID);
      expect(preset.CreatedByEmail).toEqual('user@example.com');
      expect(mockPutItem).toHaveBeenCalledTimes(1);
    });

    it('writes a lab preset under a shared sort key that omits the user', async () => {
      const preset = await svc.createPreset({ ...owner, Scope: 'LAB' }, 'Lab standard', { min_depth: 20 });

      expect(preset.PresetKey).toEqual(`LAB#${WORKFLOW_ID}#${preset.PresetId}`);
      expect(preset.PresetKey).not.toContain(USER_ID);
    });

    it('trims the supplied name', async () => {
      const preset = await svc.createPreset(owner, '  Padded name  ', {});
      expect(preset.Name).toEqual('Padded name');
    });

    it('rejects a name already used in the same tier, ignoring case', async () => {
      mockQueryItems.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall(presetFixture({ Name: 'Strict QC' }))],
      });

      await expect(svc.createPreset(owner, 'strict qc', {})).rejects.toThrow('A preset with this name already exists');
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('rejects once the tier is at its cap', async () => {
      mockQueryItems.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Items: Array.from({ length: WORKFLOW_RUN_PRESET_LIMIT }, (_unused, index) =>
          marshall(presetFixture({ Name: `Preset ${index}`, PresetId: `preset-${index}` })),
        ),
      });

      await expect(svc.createPreset(owner, 'One more', {})).rejects.toThrow(
        `Only ${WORKFLOW_RUN_PRESET_LIMIT} presets can be saved per workflow`,
      );
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it('counts only the tier being written to when applying the cap', async () => {
      await svc.createPreset({ ...owner, Scope: 'LAB' }, 'Lab standard', {});

      // A LAB write must be sized against LAB presets only, never the user's own.
      expect(mockQueryItems).toHaveBeenCalledTimes(1);
      expect(mockQueryItems.mock.calls[0][0].ExpressionAttributeValues[':presetKeyPrefix']).toEqual({
        S: `LAB#${WORKFLOW_ID}#`,
      });
    });
  });

  describe('updatePreset', () => {
    it('rewrites the stored preset with the new params and bumps the audit fields', async () => {
      const existing = presetFixture({ CreatedAt: '2020-01-01T00:00:00.000Z', CreatedBy: 'someone-else' });
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: marshall(existing) });

      const updated = await svc.updatePreset(owner, existing.PresetId, { Params: { min_depth: 99 } });

      expect(updated.Params).toEqual({ min_depth: 99 });
      expect(updated.Name).toEqual(existing.Name);
      expect(updated.CreatedAt).toEqual('2020-01-01T00:00:00.000Z');
      expect(updated.ModifiedBy).toEqual(USER_ID);
      expect(updated.ModifiedAt).not.toEqual('2020-01-01T00:00:00.000Z');
    });

    it('renames without touching the stored params', async () => {
      const existing = presetFixture();
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: marshall(existing) });

      const updated = await svc.updatePreset(owner, existing.PresetId, { Name: 'Renamed' });

      expect(updated.Name).toEqual('Renamed');
      expect(updated.Params).toEqual(existing.Params);
    });

    it('allows a preset to keep its own name', async () => {
      const existing = presetFixture();
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: marshall(existing) });
      mockQueryItems.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Items: [marshall(existing)] });

      await expect(svc.updatePreset(owner, existing.PresetId, { Name: existing.Name })).resolves.toBeDefined();
    });

    it('rejects renaming onto a sibling name', async () => {
      const existing = presetFixture();
      const sibling = presetFixture({ PresetId: 'other-preset', Name: 'Taken' });
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: marshall(existing) });
      mockQueryItems.mockResolvedValue({
        $metadata: { httpStatusCode: 200 },
        Items: [marshall(existing), marshall(sibling)],
      });

      await expect(svc.updatePreset(owner, existing.PresetId, { Name: 'Taken' })).rejects.toThrow(
        'A preset with this name already exists',
      );
    });

    it('reports a missing preset rather than creating one', async () => {
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });

      await expect(svc.updatePreset(owner, 'ghost-preset', { Name: 'Nope' })).rejects.toThrow(
        "Workflow run preset 'ghost-preset' could not be found",
      );
      expect(mockPutItem).not.toHaveBeenCalled();
    });

    it("cannot reach another user's personal preset, because the key is user scoped", async () => {
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });

      await expect(
        svc.updatePreset({ ...owner, UserId: 'attacker' }, 'victim-preset', { Name: 'Hijacked' }),
      ).rejects.toThrow('could not be found');
      expect(mockGetItem.mock.calls[0][0].Key.PresetKey).toEqual({
        S: `USER#attacker#${WORKFLOW_ID}#victim-preset`,
      });
    });
  });

  describe('deletePreset', () => {
    it('deletes an existing preset', async () => {
      const existing = presetFixture();
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 }, Item: marshall(existing) });

      await expect(svc.deletePreset(owner, existing.PresetId)).resolves.toBe(true);
      expect(mockDeleteItem.mock.calls[0][0].Key).toEqual({
        LaboratoryId: { S: LAB_ID },
        PresetKey: { S: existing.PresetKey },
      });
    });

    it('reports a missing preset instead of silently succeeding', async () => {
      mockGetItem.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });

      await expect(svc.deletePreset(owner, 'ghost-preset')).rejects.toThrow('could not be found');
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });
  });

  describe('listForWorkflow', () => {
    it('returns both tiers sorted by name', async () => {
      mockQueryItems.mockImplementation((input) => {
        const prefix = input.ExpressionAttributeValues[':presetKeyPrefix'].S;
        const items = prefix.startsWith('LAB#')
          ? [marshall(presetFixture({ Scope: 'LAB', PresetId: 'lab-1', Name: 'Zulu lab' }))]
          : [
              marshall(presetFixture({ PresetId: 'user-b', Name: 'Beta' })),
              marshall(presetFixture({ PresetId: 'user-a', Name: 'Alpha' })),
            ];
        return Promise.resolve({ $metadata: { httpStatusCode: 200 }, Items: items });
      });

      const result = await svc.listForWorkflow(LAB_ID, USER_ID, WORKFLOW_ID);

      expect(result.UserPresets.map((preset) => preset.Name)).toEqual(['Alpha', 'Beta']);
      expect(result.LabPresets.map((preset) => preset.Name)).toEqual(['Zulu lab']);
    });

    it('returns empty tiers when nothing is saved', async () => {
      await expect(svc.listForWorkflow(LAB_ID, USER_ID, WORKFLOW_ID)).resolves.toEqual({
        UserPresets: [],
        LabPresets: [],
      });
    });

    it('queries the lab partition with a begins_with condition on the sort key', async () => {
      await svc.listForWorkflow(LAB_ID, USER_ID, WORKFLOW_ID);

      const input = mockQueryItems.mock.calls[0][0];
      expect(input.TableName).toEqual('unit-test-workflow-run-preset-table');
      expect(input.KeyConditionExpression).toEqual(
        '#LaboratoryId = :laboratoryId AND begins_with(#PresetKey, :presetKeyPrefix)',
      );
      expect(input.ExpressionAttributeValues[':laboratoryId']).toEqual({ S: LAB_ID });
    });
  });
});
