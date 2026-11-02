import { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  associateInputsWithWorkflowTag,
  recordLaboratoryRunInputAssociations,
} from '@BE/services/easy-genomics/associate-laboratory-run-workflow-tagging';
import { LaboratoryDataTaggingService } from '@BE/services/easy-genomics/laboratory-data-tagging-service';

const laboratory = {
  OrganizationId: 'org-1',
  LaboratoryId: 'lab-1',
  S3Bucket: 'lab-bucket',
} as Laboratory;

const run = {
  LaboratoryId: 'lab-1',
  RunId: 'run-1',
  RunName: 'run one',
  Platform: 'AWS HealthOmics',
  CreatedAt: '2026-11-02T00:00:00.000Z',
  InputFileKeys: ['org-1/lab-1/imports/sample_R1.fastq.gz'],
} as LaboratoryRun;

function taggingThatFailsToResolveSamples(): LaboratoryDataTaggingService {
  return {
    resolveSampleIdsForKeys: jest.fn().mockRejectedValue(new Error('table not found')),
  } as unknown as LaboratoryDataTaggingService;
}

describe('recordLaboratoryRunInputAssociations', () => {
  it('rejects when a tagging write fails, so maintenance scripts can report it', async () => {
    await expect(
      recordLaboratoryRunInputAssociations({
        laboratory,
        userId: 'user-1',
        run,
        tagging: taggingThatFailsToResolveSamples(),
      }),
    ).rejects.toThrow('table not found');
  });

  it('records sample and file usage for lab-scoped input keys', async () => {
    const tagging = {
      resolveSampleIdsForKeys: jest.fn().mockResolvedValue(['sample-1']),
      recordLaboratoryRunUsageForSamples: jest.fn().mockResolvedValue(undefined),
      recordLaboratoryRunInputUsage: jest.fn().mockResolvedValue(undefined),
    } as unknown as LaboratoryDataTaggingService;

    await recordLaboratoryRunInputAssociations({ laboratory, userId: 'user-1', run, tagging });

    expect(tagging.recordLaboratoryRunUsageForSamples).toHaveBeenCalledWith(
      laboratory,
      'user-1',
      ['sample-1'],
      expect.objectContaining({ RunId: 'run-1', InputFileKeys: run.InputFileKeys }),
    );
  });
});

describe('associateInputsWithWorkflowTag', () => {
  it('swallows tagging failures so run creation is never blocked', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      associateInputsWithWorkflowTag({
        laboratory,
        userId: 'user-1',
        run,
        tagging: taggingThatFailsToResolveSamples(),
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'Failed to associate laboratory run inputs with data tagging (continuing):',
      expect.any(Error),
    );

    warn.mockRestore();
  });
});
