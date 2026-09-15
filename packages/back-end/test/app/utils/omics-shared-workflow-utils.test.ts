import {
  listAllSharedWorkflowSummaries,
  ownerAccountIdFromOmicsShare,
  resolveSharedWorkflowOwnerId,
} from '../../../src/app/utils/omics-shared-workflow-utils';

describe('omics-shared-workflow-utils', () => {
  describe('listAllSharedWorkflowSummaries', () => {
    it('retries TooManyRequestsException then returns ACTIVE shares', async () => {
      jest.useFakeTimers();
      try {
        const tooMany = Object.assign(new Error('Too Many Requests'), {
          name: 'TooManyRequestsException',
          $metadata: { httpStatusCode: 429 },
        });
        const omicsService = {
          listSharedWorkflows: jest
            .fn()
            .mockRejectedValueOnce(tooMany)
            .mockResolvedValueOnce({
              shares: [
                {
                  resourceId: 'wf-shared',
                  shareName: 'Shared WF',
                  ownerId: '111122223333',
                  status: 'ACTIVE',
                },
              ],
            }),
        };

        const resultPromise = listAllSharedWorkflowSummaries(omicsService);
        await jest.advanceTimersByTimeAsync(1000);
        await expect(resultPromise).resolves.toEqual([
          { id: 'wf-shared', name: 'Shared WF', ownerAccountId: '111122223333' },
        ]);
        expect(omicsService.listSharedWorkflows).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

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
