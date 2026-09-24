import { DEFAULT_LOG_EXCERPT_CHARS, extractErrorWindow } from './log-extraction';

describe('extractErrorWindow', () => {
  it('returns an empty string for empty / nullish input', () => {
    expect(extractErrorWindow('')).toBe('');
    expect(extractErrorWindow(undefined)).toBe('');
    expect(extractErrorWindow(null)).toBe('');
  });

  it('starts a few lines before the first error marker', () => {
    const log = [
      'line 0 noise',
      'line 1 noise',
      'line 2 noise',
      'line 3 noise',
      'line 4 noise',
      'line 5 Caused by: boom',
      'line 6 detail',
    ].join('\n');
    const out = extractErrorWindow(log);
    // LEAD_IN is 3 lines before index 5 -> starts at line 2.
    expect(out).toContain('line 2 noise');
    expect(out).toContain('Caused by: boom');
    expect(out).toContain('line 6 detail');
    expect(out).not.toContain('line 0 noise');
  });

  it('falls back to the tail when there is no error marker', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `progress step ${i}`);
    const out = extractErrorWindow(lines.join('\n'), 60);
    expect(out).toContain('progress step 49');
    expect(out).not.toContain('progress step 0');
  });

  it('head-truncates an oversized error window', () => {
    const big = 'ERROR start\n' + 'x'.repeat(10_000);
    const out = extractErrorWindow(big, 100);
    expect(out.length).toBeLessThanOrEqual(100 + '\n…[truncated]'.length);
    expect(out).toContain('ERROR start');
    expect(out).toContain('…[truncated]');
  });

  it('detects common engine/nextflow failure markers', () => {
    for (const marker of [
      'java.lang.OutOfMemoryError',
      'exit status 1',
      'Command error:',
      'No such file or directory',
      'Permission denied',
    ]) {
      const out = extractErrorWindow(`noise\nnoise\n${marker}\ntrailing`);
      expect(out).toContain(marker);
    }
  });

  it('defaults the cap to DEFAULT_LOG_EXCERPT_CHARS', () => {
    expect(DEFAULT_LOG_EXCERPT_CHARS).toBe(4000);
  });
});

/**
 * Nextflow on AWS HealthOmics emits a bare, headerless stack frame on every pf4j
 * extension lookup — once per task — so engine logs are overwhelmingly noise.
 * These fixtures reproduce that shape without committing the multi-megabyte logs.
 */
const STACK_FRAME = '\tat org.pf4j.PluginClassLoader.loadClass(PluginClassLoader.java:169)';

/** Nextflow's periodic task status dump. Its `error: -` field reads as an error marker. */
const STATUS_DUMP =
  '~> TaskHandler[id: 4; name: FASTP (Sample01); status: RUNNING; exit: -; error: -; workDir: /mnt/workflow/f1/5ee418]';

const repeat = (line: string, count: number): string[] => Array.from({ length: count }, () => line);

/** The cause of the Picard failure, logged well before the failure block itself. */
const PICARD_CAUSE =
  'Sep-17 18:18:52.237 [pool-1-thread-13] ERROR c.a.o.e.n.c.b.TaskServiceHelper - No registry staging mapping ' +
  "configured for image 'community.wave.seqera.io/library/picard:3.4.0--e9963040df0a9bf6'. Add a container " +
  "registry mapping with a credentialArn for the image's registry.";

const PICARD_BLOCK = [
  'Sep-17 18:18:52.397 [TaskFinalizer-4] ERROR nextflow.processor.TaskProcessor - Error executing process > ' +
    "'NFCORE_VIRALRECON:VIRALRECON:PICARD_COLLECTMULTIPLEMETRICS (Sample02_S2_L001)'",
  'Caused by:',
  '  Process `NFCORE_VIRALRECON:VIRALRECON:PICARD_COLLECTMULTIPLEMETRICS` terminated with an error exit status (2)',
  'Command exit status:',
  '  2',
  'Container:',
  '  community.wave.seqera.io/library/picard:3.4.0--e9963040df0a9bf6',
];

const FREYJA_BLOCK = [
  'Sep-10 20:14:55.577 [TaskFinalizer-3] ERROR nextflow.processor.TaskProcessor - Error executing process > ' +
    "'NFCORE_VIRALRECON:VIRALRECON:BAM_VARIANT_DEMIX_BOOT_FREYJA:FREYJA_UPDATE (freyja_db)'",
  'Caused by:',
  '  Process `FREYJA_UPDATE (freyja_db)` terminated with an error exit status (1)',
  'Command error:',
  '  OSError: [Errno 99] Cannot assign requested address',
  '  urllib.error.URLError: <urlopen error [Errno 99] Cannot assign requested address>',
];

describe('extractErrorWindow with HealthOmics plugin noise', () => {
  it('keeps the root cause when stack frames separate it from the failure block', () => {
    const log = [...repeat(STATUS_DUMP, 5), PICARD_CAUSE, ...repeat(STACK_FRAME, 200), ...PICARD_BLOCK].join('\n');

    const out = extractErrorWindow(log);

    expect(out).toContain('No registry staging mapping');
    expect(out).toContain('community.wave.seqera.io');
    expect(out).toContain('exit status (2)');
  });

  it('drops stack frames and status dumps from the excerpt', () => {
    const log = [...repeat(STATUS_DUMP, 5), PICARD_CAUSE, ...repeat(STACK_FRAME, 200), ...PICARD_BLOCK].join('\n');

    const out = extractErrorWindow(log);

    expect(out).not.toContain('org.pf4j');
    expect(out).not.toContain('status: RUNNING');
  });

  it('starts the excerpt on a real log line, not a stack frame', () => {
    const log = [...repeat(STACK_FRAME, 50), PICARD_CAUSE, ...repeat(STACK_FRAME, 50), ...PICARD_BLOCK].join('\n');

    const out = extractErrorWindow(log);

    expect(out.split('\n')[0]).not.toMatch(/^\s+at /);
  });

  it('retains the Freyja cause through head truncation of an oversized window', () => {
    const log = [...repeat(STACK_FRAME, 300), ...FREYJA_BLOCK].join('\n');

    const out = extractErrorWindow(log);

    expect(out).toContain('FREYJA_UPDATE');
    expect(out).toContain('exit status (1)');
    expect(out).toContain('Cannot assign requested address');
  });

  it('is a no-op on a clean log with no plugin noise', () => {
    // Pipelines that load no Nextflow plugins produce logs with zero stack frames.
    const log = ['Sep-10 19:58:32 [main] INFO  nextflow.Session - Session start', ...FREYJA_BLOCK].join('\n');

    const out = extractErrorWindow(log);

    expect(out).toContain('Session start');
    expect(out).toContain('FREYJA_UPDATE');
    expect(out).toContain('Cannot assign requested address');
  });
});
