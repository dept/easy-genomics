import { createPinia, setActivePinia } from 'pinia';
import useRunStore from '../../../src/app/stores/run';

jest.mock('@FE/components/EGRunFormUploadData.vue', () => ({}));

describe('run store HealthOmics WIP paths', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('updateWipOmicsRun writes into wipOmicsRuns only', () => {
    const store = useRunStore();

    store.updateWipOmicsRun('temp-omics', { runName: 'Omics Run', paramsRequired: [] });
    store.updateWipSeqeraRun('temp-seqera', { runName: 'Seqera Run', paramsRequired: [] });

    expect(store.wipOmicsRuns['temp-omics']).toEqual(
      expect.objectContaining({ runName: 'Omics Run', paramsRequired: [] }),
    );
    expect(store.wipSeqeraRuns['temp-omics']).toBeUndefined();
    expect(store.wipOmicsRuns['temp-seqera']).toBeUndefined();
  });

  it('updateWipOmicsRun applies unsets without touching Seqera WIP', () => {
    const store = useRunStore();
    store.updateWipOmicsRun('temp-omics', {
      runName: 'Omics Run',
      description: 'note',
      paramsRequired: [],
    });
    store.updateWipOmicsRun('temp-omics', {}, ['description']);

    expect(store.wipOmicsRuns['temp-omics'].runName).toBe('Omics Run');
    expect(store.wipOmicsRuns['temp-omics'].description).toBeUndefined();
    expect(store.wipSeqeraRuns).toEqual({});
  });

  it('updateWipOmicsRunParams merges and unsets params on Omics WIP only', () => {
    const store = useRunStore();
    store.updateWipOmicsRun('temp-omics', { paramsRequired: [] });
    store.updateWipOmicsRunParams('temp-omics', { input: 's3://a', other: 'x' });
    store.updateWipOmicsRunParams('temp-omics', { keep: 'y' }, ['other']);

    expect(store.wipOmicsRuns['temp-omics'].params).toEqual({ input: 's3://a', keep: 'y' });
    expect(store.wipSeqeraRuns).toEqual({});
  });

  it('omicsRunsForLab returns mapped Omics runs for a lab', () => {
    const store = useRunStore();
    store.omicsRuns = {
      'lab-1': {
        'run-a': { id: 'run-a', name: 'A' } as any,
        'run-b': { id: 'run-b', name: 'B' } as any,
      },
    };
    store.omicsRunIdsByLab = {
      'lab-1': ['run-b', 'run-a'],
    };

    expect(store.omicsRunsForLab('lab-1').map((r) => r.id)).toEqual(['run-b', 'run-a']);
    expect(store.omicsRunsForLab('lab-missing')).toEqual([]);
  });
});
