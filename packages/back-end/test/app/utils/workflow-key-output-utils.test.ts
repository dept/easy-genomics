import { LaboratoryRun } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/laboratory-run';
import { runKeyOutputsRoot, toRunRelativePath } from '../../../src/app/utils/workflow-key-output-utils';

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
    OutputS3Url: 's3://lab-bucket/org/lab/aws-healthomics/run-1/results',
    ...overrides,
  };
}

describe('runKeyOutputsRoot', () => {
  it('appends the HealthOmics external run folder so patterns skip the per-run id', () => {
    expect(runKeyOutputsRoot(runFixture())).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org/lab/aws-healthomics/run-1/results/1234567/',
    });
  });

  it('does not double-append when OutputS3Url already ends with the external run id', () => {
    expect(
      runKeyOutputsRoot(
        runFixture({
          OutputS3Url: 's3://lab-bucket/org/lab/aws-healthomics/run-1/results/1234567/',
        }),
      ),
    ).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org/lab/aws-healthomics/run-1/results/1234567/',
    });
  });

  it('uses OutputS3Url as-is for Seqera runs', () => {
    expect(
      runKeyOutputsRoot(
        runFixture({
          Platform: 'Seqera Cloud',
          ExternalRunId: '987',
          OutputS3Url: 's3://lab-bucket/org/lab/seqera/run-1/results/',
        }),
      ),
    ).toEqual({
      bucket: 'lab-bucket',
      prefix: 'org/lab/seqera/run-1/results/',
    });
  });

  it('returns null when the run has no S3 location', () => {
    expect(runKeyOutputsRoot(runFixture({ OutputS3Url: undefined, InputS3Url: undefined }))).toBeNull();
  });
});

describe('toRunRelativePath', () => {
  const root = 'org/lab/aws-healthomics/run-1/results/1234567/';

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
