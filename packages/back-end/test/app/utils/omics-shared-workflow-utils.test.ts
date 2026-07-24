import {
  ownerAccountIdFromOmicsShare,
  resolveSharedWorkflowOwnerId,
} from '../../../src/app/utils/omics-shared-workflow-utils';

describe('omics-shared-workflow-utils', () => {
  describe('ownerAccountIdFromOmicsShare', () => {
    it('prefers ownerId', () => {
      expect(
        ownerAccountIdFromOmicsShare({
          ownerId: '111122223333',
          resourceArn: 'arn:aws:omics:us-east-1:999988887777:workflow/wf-1',
        }),
      ).toBe('111122223333');
    });

    it('falls back to account id in resourceArn', () => {
      expect(
        ownerAccountIdFromOmicsShare({
          resourceArn: 'arn:aws:omics:us-east-1:999988887777:workflow/wf-1',
        }),
      ).toBe('999988887777');
    });

    it('returns undefined when neither is available', () => {
      expect(ownerAccountIdFromOmicsShare({})).toBeUndefined();
    });
  });

  describe('resolveSharedWorkflowOwnerId', () => {
    it('returns owner account id when workflow id matches an ACTIVE share', async () => {
      const omicsService = {
        listSharedWorkflows: jest.fn().mockResolvedValue({
          shares: [
            {
              resourceId: 'wf-shared',
              ownerId: '111122223333',
              status: 'ACTIVE',
            },
          ],
        }),
      };

      await expect(resolveSharedWorkflowOwnerId(omicsService, 'wf-shared')).resolves.toBe('111122223333');
    });

    it('returns undefined when workflow is not shared', async () => {
      const omicsService = {
        listSharedWorkflows: jest.fn().mockResolvedValue({
          shares: [
            {
              resourceId: 'other',
              ownerId: '111122223333',
              status: 'ACTIVE',
            },
          ],
        }),
      };

      await expect(resolveSharedWorkflowOwnerId(omicsService, 'wf-private')).resolves.toBeUndefined();
    });
  });
});
