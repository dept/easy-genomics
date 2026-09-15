import {
  isTerminalRunStatus,
  showOmicsTaskProgressCard,
  showSeqeraTaskProgressCard,
} from '../../../src/app/utils/run-progress-card-visibility';

const seqeraRun = { Platform: 'Seqera Cloud', Status: 'RUNNING' } as const;
const omicsRun = { Platform: 'AWS HealthOmics', Status: 'RUNNING' } as const;

describe('isTerminalRunStatus', () => {
  it.each(['FAILED', 'SUCCEEDED', 'CANCELLED', 'COMPLETED', 'DELETED', 'ABORTED'])(
    'treats %s as terminal',
    (status) => {
      expect(isTerminalRunStatus(status)).toBe(true);
    },
  );

  it.each(['RUNNING', 'STARTING', 'PENDING', 'STOPPING'])('treats %s as non-terminal', (status) => {
    expect(isTerminalRunStatus(status)).toBe(false);
  });

  it('returns false when the status is missing', () => {
    expect(isTerminalRunStatus(undefined)).toBe(false);
    expect(isTerminalRunStatus(null)).toBe(false);
    expect(isTerminalRunStatus('')).toBe(false);
  });
});

describe('showSeqeraTaskProgressCard', () => {
  it('shows the card when there is a failure reason', () => {
    expect(
      showSeqeraTaskProgressCard({ Platform: 'Seqera Cloud', Status: 'FAILED' }, { failureReason: 'exit status 137' }),
    ).toBe(true);
  });

  it('shows the card when there is progress', () => {
    expect(showSeqeraTaskProgressCard(seqeraRun, { hasProgress: true })).toBe(true);
  });

  it('hides the card when there is neither failure nor progress', () => {
    expect(showSeqeraTaskProgressCard(seqeraRun, { failureReason: null, hasProgress: false })).toBe(false);
  });

  it('shows the card for a terminal run that still has failure content', () => {
    expect(
      showSeqeraTaskProgressCard(
        { Platform: 'Seqera Cloud', Status: 'FAILED' },
        { failureReason: 'exit status 137', hasProgress: true },
      ),
    ).toBe(true);
  });

  it('hides the card for non-Seqera and missing runs', () => {
    expect(showSeqeraTaskProgressCard(omicsRun, { hasProgress: true })).toBe(false);
    expect(showSeqeraTaskProgressCard(null, { hasProgress: true })).toBe(false);
  });
});

describe('showOmicsTaskProgressCard', () => {
  it('shows the card when there is a failure reason', () => {
    expect(
      showOmicsTaskProgressCard({ Platform: 'AWS HealthOmics', Status: 'FAILED' }, { failureReason: 'OutOfMemory' }),
    ).toBe(true);
  });

  it('shows the card when there are failed tasks', () => {
    expect(showOmicsTaskProgressCard({ Platform: 'AWS HealthOmics', Status: 'FAILED' }, { failedTaskCount: 2 })).toBe(
      true,
    );
  });

  it('shows the card for progress on a non-terminal run', () => {
    expect(showOmicsTaskProgressCard(omicsRun, { hasProgress: true })).toBe(true);
  });

  it('hides the card for progress on a terminal run with no failure content', () => {
    expect(
      showOmicsTaskProgressCard(
        { Platform: 'AWS HealthOmics', Status: 'SUCCEEDED' },
        { hasProgress: true, failedTaskCount: 0, failureReason: null },
      ),
    ).toBe(false);
  });

  it('hides the card when there is no content at all', () => {
    expect(showOmicsTaskProgressCard(omicsRun, {})).toBe(false);
  });

  it('hides the card for non-HealthOmics and missing runs', () => {
    expect(showOmicsTaskProgressCard(seqeraRun, { hasProgress: true })).toBe(false);
    expect(showOmicsTaskProgressCard(null, { failureReason: 'OutOfMemory' })).toBe(false);
  });
});
