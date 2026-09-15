import {
  labPresetKeyPrefix,
  userPresetKeyPrefix,
  workflowRunPresetKey,
  workflowRunPresetKeyPrefix,
} from '../../../src/app/utils/workflow-run-preset-utils';

describe('workflow run preset sort keys', () => {
  it('scopes personal preset keys by user and workflow', () => {
    expect(userPresetKeyPrefix('user-1', 'wf-9')).toEqual('USER#user-1#wf-9#');
  });

  it('scopes lab preset keys by workflow only, so they are shared across members', () => {
    expect(labPresetKeyPrefix('wf-9')).toEqual('LAB#wf-9#');
  });

  it('keeps the two tiers in separate key namespaces', () => {
    const userPrefix = workflowRunPresetKeyPrefix('USER', 'user-1', 'wf-9');
    const labPrefix = workflowRunPresetKeyPrefix('LAB', 'user-1', 'wf-9');

    expect(userPrefix.startsWith(labPrefix)).toBe(false);
    expect(labPrefix.startsWith(userPrefix)).toBe(false);
  });

  it('ignores the user for lab scoped keys so any member resolves the same item', () => {
    expect(workflowRunPresetKey('LAB', 'user-1', 'wf-9', 'preset-1')).toEqual(
      workflowRunPresetKey('LAB', 'user-2', 'wf-9', 'preset-1'),
    );
  });

  it('gives each user a distinct key for the same preset id', () => {
    expect(workflowRunPresetKey('USER', 'user-1', 'wf-9', 'preset-1')).not.toEqual(
      workflowRunPresetKey('USER', 'user-2', 'wf-9', 'preset-1'),
    );
  });

  it('builds a full key from its prefix and the preset id', () => {
    expect(workflowRunPresetKey('USER', 'user-1', 'wf-9', 'preset-1')).toEqual('USER#user-1#wf-9#preset-1');
  });

  it("does not let one workflow's prefix match another whose id shares a leading substring", () => {
    // `begins_with` queries would over-match without the trailing separator.
    expect(labPresetKeyPrefix('wf-1').startsWith(labPresetKeyPrefix('wf-12'))).toBe(false);
    expect(labPresetKeyPrefix('wf-12').startsWith(labPresetKeyPrefix('wf-1'))).toBe(false);
  });
});
