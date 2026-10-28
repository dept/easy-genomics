import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import {
  runKeyOutputsRoot,
  shouldEnqueueKeyOutputDelivery,
  toRunRelativePath,
} from '../../../src/app/utils/workflow-key-output-utils';

function runFixture(overrides?: Partial<LaboratoryRun>): LaboratoryRun {
  return {
    LaboratoryId: 'lab-1',
    RunId: 'run-1',
    UserId: 'user-1',
    OrganizationId: 'org-1',
    RunName: 'wk 36',
    Platform: 'AWS HealthOmics',
    Status: 'SUCCEEDED',
    Owner: 'user@example.com',
    ExternalRunId: '1234567',
    OutputS3Url: 's3://lab-bucket/org-1/lab-1/aws-healthomics/run-1/results',
    ...overrides,
  };
}

describe('shouldEnqueueKeyOutputDelivery', () => {
  it('enqueues only a completed HealthOmics run that names its workflow', () => {
    expect(shouldEnqueueKeyOutputDelivery({ ...runFixture(), WorkflowExternalId: 'wf-1' })).toBe(true);
    expect(shouldEnqueueKeyOutputDelivery({ ...runFixture(), Status: 'COMPLETED', WorkflowExternalId: 'wf-1' })).toBe(
      true,
    );
  });

  it('does not enqueue a failed, Seqera, or workflow-less run', () => {
    expect(shouldEnqueueKeyOutputDelivery({ ...runFixture(), Status: 'FAILED', WorkflowExternalId: 'wf-1' })).toBe(
      false,
    );
    expect(
      shouldEnqueueKeyOutputDelivery({ ...runFixture(), Platform: 'Seqera Cloud', WorkflowExternalId: 'wf-1' }),
    ).toBe(false);
    expect(shouldEnqueueKeyOutputDelivery(runFixture())).toBe(false);
  });
});

describe('runKeyOutputsRoot', () => {
  it('appends the HealthOmics external run folder so patterns skip the per-run id', () => {
    expect(runKeyOutputsRoot(runFixture())).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org-1/lab-1/aws-healthomics/run-1/results/1234567/',
    });
  });

  it('does not double-append when OutputS3Url already ends with the external run id', () => {
    expect(
      runKeyOutputsRoot(
        runFixture({
          OutputS3Url: 's3://lab-bucket/org-1/lab-1/aws-healthomics/run-1/results/1234567/',
        }),
      ),
    ).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org-1/lab-1/aws-healthomics/run-1/results/1234567/',
    });
  });

  it('uses OutputS3Url as-is for Seqera runs', () => {
    expect(
      runKeyOutputsRoot(
        runFixture({
          Platform: 'Seqera Cloud',
          ExternalRunId: '987',
          OutputS3Url: 's3://lab-bucket/org-1/lab-1/seqera/run-1/results/',
        }),
      ),
    ).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org-1/lab-1/seqera/run-1/results/',
    });
  });

  it('returns null when the run has no S3 location', () => {
    expect(runKeyOutputsRoot(runFixture({ OutputS3Url: undefined, InputS3Url: undefined }))).toBeNull();
  });

  it('returns null when the recorded location is outside this laboratory folder', () => {
    expect(
      runKeyOutputsRoot(
        runFixture({
          OutputS3Url: 's3://lab-bucket/other-org/other-lab/aws-healthomics/run-1/results',
        }),
      ),
    ).toBeNull();
  });

  it('does not append ExternalRunId when falling back to InputS3Url', () => {
    expect(
      runKeyOutputsRoot(
        runFixture({
          OutputS3Url: undefined,
          InputS3Url: 's3://lab-bucket/org-1/lab-1/aws-healthomics/run-1/input/',
        }),
      ),
    ).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org-1/lab-1/aws-healthomics/run-1/input/',
    });
  });
});

describe('toRunRelativePath', () => {
  const root = 'org-1/lab-1/aws-healthomics/run-1/results/1234567/';

  it('strips the run File Manager root from a full S3 key', () => {
    expect(toRunRelativePath(`${root}variants/ivar/consensus/bcftools/sample01.consensus.fa`, root)).toEqual(
      'variants/ivar/consensus/bcftools/sample01.consensus.fa',
    );
  });

  it('passes through an already-relative path', () => {
    expect(toRunRelativePath('multiqc/multiqc_report.html', root)).toEqual('multiqc/multiqc_report.html');
  });

  it('drops folder placeholder keys', () => {
    expect(toRunRelativePath(`${root}variants/`, root)).toBeNull();
  });
});
