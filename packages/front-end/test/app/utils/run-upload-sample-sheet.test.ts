import { RunType } from '@easy-genomics/shared-lib/src/app/types/base-entity';
import type { Laboratory } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory';
import type { GenerateDataCollectionSampleSheetResponse } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/sequence-sets';
import { v4 as uuidv4 } from 'uuid';

import { buildRunWizardUrl, seedWipRunFromSampleSheet } from '../../../src/app/utils/run-upload-sample-sheet';

const mockUpdateWipOmicsRun = jest.fn();
const mockUpdateWipOmicsRunParams = jest.fn();
const mockUpdateWipSeqeraRun = jest.fn();
const mockUpdateWipSeqeraRunParams = jest.fn();

jest.mock('@FE/stores', () => ({
  useRunStore: () => ({
    updateWipOmicsRun: mockUpdateWipOmicsRun,
    updateWipOmicsRunParams: mockUpdateWipOmicsRunParams,
    updateWipSeqeraRun: mockUpdateWipSeqeraRun,
    updateWipSeqeraRunParams: mockUpdateWipSeqeraRunParams,
  }),
}));

describe('run-upload-sample-sheet', () => {
  const lab = {
    LaboratoryId: 'lab1',
    OrganizationId: 'org1',
    S3Bucket: 'bucket',
  } as Laboratory;

  const sampleSheetResult: GenerateDataCollectionSampleSheetResponse = {
    SampleSheetS3Url: 's3://bucket/org1/lab1/aws-healthomics/tx/sheet.csv',
    InputFileKeys: ['org1/lab1/a.fastq.gz'],
    CsvPreview: 'sample,fastq_1\na,s3://bucket/org1/lab1/a.fastq.gz',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('seeds omics WIP run', () => {
    const txId = uuidv4();
    const tempId = seedWipRunFromSampleSheet({
      lab,
      labId: 'lab1',
      runName: 'Run1',
      platform: 'AWS HealthOmics' as RunType,
      workflowExternalId: 'wf-1',
      sampleSheetResult,
      transactionId: txId,
    });
    expect(tempId).toBe(txId);
    expect(mockUpdateWipOmicsRun).toHaveBeenCalled();
    expect(mockUpdateWipOmicsRunParams).toHaveBeenCalledWith(
      txId,
      expect.objectContaining({ input: sampleSheetResult.SampleSheetS3Url }),
    );
  });

  it('builds run wizard URL for omics', () => {
    const url = buildRunWizardUrl('lab1', 'AWS HealthOmics', 'wf-1', 'temp-1');
    expect(url).toContain('/run-workflow/wf-1');
    expect(url).toContain('from=data-collections');
  });
});
