import { redactSensitive } from './log-redaction';

describe('redactSensitive', () => {
  it('returns an empty string for empty / nullish input', () => {
    expect(redactSensitive('')).toBe('');
    expect(redactSensitive(undefined)).toBe('');
    expect(redactSensitive(null)).toBe('');
  });

  it('masks email addresses', () => {
    const out = redactSensitive('Contact jane.doe+lab@example.co.uk for access');
    expect(out).toContain('[REDACTED_EMAIL]');
    expect(out).not.toContain('jane.doe');
    expect(out).not.toContain('example.co.uk');
  });

  it('masks S3 URIs (bucket and key may embed sample identifiers)', () => {
    const out = redactSensitive('Importing s3://dev-quality-lab-bucket/61c86013/patientA/reads.bam');
    expect(out).toContain('[REDACTED_S3_URI]');
    expect(out).not.toContain('patientA');
    expect(out).not.toContain('dev-quality-lab-bucket');
  });

  it('masks ARNs including the embedded account id', () => {
    const out = redactSensitive(
      'log stream: arn:aws:logs:us-east-1:851725267090:log-group:/aws/omics/WorkflowLog:log-stream:run/4399444/engine',
    );
    expect(out).toContain('[REDACTED_ARN]');
    expect(out).not.toContain('851725267090');
    expect(out).not.toContain('WorkflowLog');
  });

  it('masks Illumina-style sample identifiers', () => {
    const out = redactSensitive('Starting task FASTQC (GOLZ2051A70614_S168_L002_R1_001)');
    expect(out).toContain('[REDACTED_SAMPLE_ID]');
    expect(out).not.toContain('GOLZ2051A70614');
  });

  it('masks FASTQ filenames', () => {
    const out = redactSensitive('No such file: patient_sample.fastq.gz');
    expect(out).toContain('[REDACTED_FASTQ_FILE]');
    expect(out).not.toContain('patient_sample');
  });

  it('masks AWS access keys, JWTs, and bearer tokens', () => {
    expect(redactSensitive('key=AKIAIOSFODNN7EXAMPLE')).toContain('[REDACTED_AWS_KEY]');
    expect(redactSensitive('Authorization: Bearer abc123DEF456ghi789')).toContain('[REDACTED_TOKEN]');
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactSensitive(`token ${jwt}`)).toContain('[REDACTED_JWT]');
  });

  it('masks IPv4 addresses, UUIDs, and account ids', () => {
    expect(redactSensitive('host 10.0.12.34 refused')).toContain('[REDACTED_IP]');
    expect(redactSensitive('run 61c86013-74f2-4d30-916a-70b03a97ba14')).toContain('[REDACTED_UUID]');
    expect(redactSensitive('account 851725267090 denied')).toContain('[REDACTED_ACCOUNT_ID]');
  });

  it('preserves diagnostic wording that carries no PII', () => {
    const log = 'Process SAMPLESHEET_CHECK terminated with an error exit status (1): missing required column "sample"';
    const out = redactSensitive(log);
    expect(out).toContain('SAMPLESHEET_CHECK');
    expect(out).toContain('exit status (1)');
    expect(out).toContain('missing required column');
  });

  it('redacts every sensitive token in a realistic multi-line engine log', () => {
    const log = [
      'Importing run input: s3://851725267090-dev-quality-lab-bucket/61c86013-74f2-4d30-916a-70b03a97ba14/reads.fastq.gz',
      'Task FASTQC (GOLZ2051A70614_S168_L002_R1_001) failed',
      'Caused by: OutOfMemoryError on host 10.0.4.18',
      'See arn:aws:logs:us-east-1:851725267090:log-group:/aws/omics/WorkflowLog',
      'Notify ops@lab.example.com',
    ].join('\n');
    const out = redactSensitive(log);
    for (const leak of [
      's3://',
      'GOLZ2051A70614',
      '10.0.4.18',
      '851725267090',
      'ops@lab.example.com',
      '61c86013-74f2-4d30-916a-70b03a97ba14',
    ]) {
      expect(out).not.toContain(leak);
    }
    // The diagnostic signal must survive.
    expect(out).toContain('OutOfMemoryError');
    expect(out).toContain('Caused by');
  });
});
