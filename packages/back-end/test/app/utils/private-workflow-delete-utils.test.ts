import { ConflictException, ResourceNotFoundException } from '@aws-sdk/client-omics';
import { InvalidRequestError, OmicsWorkflowNotFoundError } from '@easy-genomics/shared-lib/lib/app/utils/HttpError';
import {
  conflictIndicatesWorkflowHasVersions,
  conflictIndicatesWorkflowInUse,
  deletePrivateOmicsWorkflow,
  listAllWorkflowVersionNames,
  WORKFLOW_IN_USE_MESSAGE,
} from '../../../src/app/utils/private-workflow-delete-utils';

describe('private-workflow-delete-utils', () => {
  describe('conflict classification', () => {
    it('detects an in-use conflict from run wording', () => {
      expect(conflictIndicatesWorkflowInUse(new Error('Workflow is in use by a run'))).toBe(true);
      expect(conflictIndicatesWorkflowInUse(new Error('A run is using this workflow'))).toBe(true);
    });

    it('detects a versions conflict', () => {
      expect(conflictIndicatesWorkflowHasVersions(new Error('workflow still has versions'))).toBe(true);
    });

    it('does not treat an unknown conflict as versions or in-use', () => {
      const error = new Error('resource is busy');
      expect(conflictIndicatesWorkflowInUse(error)).toBe(false);
      expect(conflictIndicatesWorkflowHasVersions(error)).toBe(false);
    });
  });

  describe('listAllWorkflowVersionNames', () => {
    it('collects every page and skips unnamed versions', async () => {
      const omicsService = {
        listWorkflowVersions: jest
          .fn()
          .mockResolvedValueOnce({
            items: [{ versionName: 'v1' }, { versionName: undefined }],
            nextToken: 'page-2',
          })
          .mockResolvedValueOnce({
            items: [{ versionName: 'v2' }],
          }),
        deleteWorkflow: jest.fn(),
        deleteWorkflowVersion: jest.fn(),
      };

      await expect(listAllWorkflowVersionNames(omicsService, 'wf-1')).resolves.toEqual(['v1', 'v2']);
      expect(omicsService.listWorkflowVersions).toHaveBeenNthCalledWith(2, {
        workflowId: 'wf-1',
        type: 'PRIVATE',
        maxResults: 100,
        startingToken: 'page-2',
      });
    });
  });

  describe('deletePrivateOmicsWorkflow', () => {
    it('returns after a successful first delete without deleting versions', async () => {
      const omicsService = {
        listWorkflowVersions: jest.fn().mockResolvedValue({ items: [{ versionName: 'v1' }] }),
        deleteWorkflow: jest.fn().mockResolvedValue({}),
        deleteWorkflowVersion: jest.fn(),
      };

      await deletePrivateOmicsWorkflow(omicsService, 'wf-1');

      expect(omicsService.deleteWorkflow).toHaveBeenCalledTimes(1);
      expect(omicsService.deleteWorkflowVersion).not.toHaveBeenCalled();
    });

    it('lists versions first, then deletes them only when the conflict refers to versions', async () => {
      const omicsService = {
        listWorkflowVersions: jest
          .fn()
          .mockResolvedValueOnce({
            items: [{ versionName: 'v1' }],
            nextToken: 'next',
          })
          .mockResolvedValueOnce({
            items: [{ versionName: 'v2' }],
          }),
        deleteWorkflow: jest
          .fn()
          .mockRejectedValueOnce(new ConflictException({ message: 'Cannot delete workflow with versions', $metadata: {} }))
          .mockResolvedValueOnce({}),
        deleteWorkflowVersion: jest.fn().mockResolvedValue({}),
      };

      await deletePrivateOmicsWorkflow(omicsService, 'wf-1');

      expect(omicsService.listWorkflowVersions).toHaveBeenCalledTimes(2);
      expect(omicsService.deleteWorkflowVersion.mock.calls).toEqual([
        [{ workflowId: 'wf-1', versionName: 'v1' }],
        [{ workflowId: 'wf-1', versionName: 'v2' }],
      ]);
      expect(omicsService.deleteWorkflow).toHaveBeenCalledTimes(2);
    });

    it('does not delete versions when a run is using the workflow', async () => {
      const omicsService = {
        listWorkflowVersions: jest.fn().mockResolvedValue({ items: [{ versionName: 'v1' }] }),
        deleteWorkflow: jest
          .fn()
          .mockRejectedValue(new ConflictException({ message: 'workflow is in use by a run', $metadata: {} })),
        deleteWorkflowVersion: jest.fn(),
      };

      await expect(deletePrivateOmicsWorkflow(omicsService, 'wf-1')).rejects.toBeInstanceOf(InvalidRequestError);
      expect(omicsService.deleteWorkflowVersion).not.toHaveBeenCalled();
    });

    it('does not delete versions on an unknown conflict', async () => {
      const omicsService = {
        listWorkflowVersions: jest.fn().mockResolvedValue({ items: [{ versionName: 'v1' }] }),
        deleteWorkflow: jest.fn().mockRejectedValue(new ConflictException({ message: 'conflict', $metadata: {} })),
        deleteWorkflowVersion: jest.fn(),
      };

      await expect(deletePrivateOmicsWorkflow(omicsService, 'wf-1')).rejects.toThrow(WORKFLOW_IN_USE_MESSAGE);
      expect(omicsService.deleteWorkflowVersion).not.toHaveBeenCalled();
    });

    it('does not delete versions when the versions list is empty', async () => {
      const omicsService = {
        listWorkflowVersions: jest.fn().mockResolvedValue({ items: [] }),
        deleteWorkflow: jest
          .fn()
          .mockRejectedValue(new ConflictException({ message: 'workflow has versions', $metadata: {} })),
        deleteWorkflowVersion: jest.fn(),
      };

      await expect(deletePrivateOmicsWorkflow(omicsService, 'wf-1')).rejects.toBeInstanceOf(InvalidRequestError);
      expect(omicsService.deleteWorkflowVersion).not.toHaveBeenCalled();
    });

    it('skips versions that disappear and fails closed if a version delete conflicts', async () => {
      const omicsService = {
        listWorkflowVersions: jest.fn().mockResolvedValue({ items: [{ versionName: 'v1' }, { versionName: 'v2' }] }),
        deleteWorkflow: jest
          .fn()
          .mockRejectedValue(new ConflictException({ message: 'workflow has versions', $metadata: {} })),
        deleteWorkflowVersion: jest
          .fn()
          .mockRejectedValueOnce(new ResourceNotFoundException({ message: 'gone', $metadata: {} }))
          .mockRejectedValueOnce(new ConflictException({ message: 'version in use', $metadata: {} })),
      };

      await expect(deletePrivateOmicsWorkflow(omicsService, 'wf-1')).rejects.toBeInstanceOf(InvalidRequestError);
      expect(omicsService.deleteWorkflowVersion).toHaveBeenCalledTimes(2);
    });

    it('maps a missing workflow to OmicsWorkflowNotFoundError', async () => {
      const omicsService = {
        listWorkflowVersions: jest.fn().mockResolvedValue({ items: [] }),
        deleteWorkflow: jest.fn().mockRejectedValue(new ResourceNotFoundException({ message: 'gone', $metadata: {} })),
        deleteWorkflowVersion: jest.fn(),
      };

      await expect(deletePrivateOmicsWorkflow(omicsService, 'wf-1')).rejects.toBeInstanceOf(OmicsWorkflowNotFoundError);
    });
  });
});
