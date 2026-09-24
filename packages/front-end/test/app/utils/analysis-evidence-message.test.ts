import { analysisEvidenceMessage } from '@FE/utils/analysis-evidence-message';

describe('analysisEvidenceMessage', () => {
  it('explains that the lab has log enrichment switched off', () => {
    const message = analysisEvidenceMessage('enrichment-disabled');
    expect(message).toContain('Lab Settings');
  });

  it('explains that the engine log could not be read', () => {
    expect(analysisEvidenceMessage('log-unavailable')).toContain('CloudWatch');
  });

  it('explains that the engine log carried no error detail', () => {
    expect(analysisEvidenceMessage('log-no-error')).toContain('no error detail');
  });

  it('returns nothing when the model had a real log excerpt', () => {
    // The verdict stands on its own evidence, so there is nothing to explain.
    expect(analysisEvidenceMessage('log-excerpt')).toBeUndefined();
  });

  it('returns nothing for an absent or unrecognised value', () => {
    expect(analysisEvidenceMessage(undefined)).toBeUndefined();
    expect(analysisEvidenceMessage('something-new')).toBeUndefined();
  });
});
