import {
  countKeyOutputMatches,
  formatKeyOutputsJson,
  inferKeyOutputLabel,
  inferKeyOutputPattern,
  inferKeyOutputsFromSelection,
  matchKeyOutputPattern,
  parseKeyOutputsJson,
  scoreKeyOutputPatterns,
} from './workflow-key-output-patterns';

const consensusFiles = Array.from({ length: 48 }, (_unused, index) => {
  const sample = `sample${String(index + 1).padStart(2, '0')}`;
  return `variants/ivar/consensus/bcftools/${sample}.consensus.fa`;
});

const pangolinFiles = Array.from({ length: 48 }, (_unused, index) => {
  const sample = `sample${String(index + 1).padStart(2, '0')}`;
  return `pangolin/${sample}.pangolin.csv`;
});

const allFiles = [
  ...consensusFiles,
  ...pangolinFiles,
  'multiqc/multiqc_report.html',
  'pipeline_info/execution_report.html',
];

describe('matchKeyOutputPattern', () => {
  it('matches a glob within a single directory segment', () => {
    expect(
      matchKeyOutputPattern(
        'variants/ivar/consensus/bcftools/*.consensus.fa',
        'variants/ivar/consensus/bcftools/sample01.consensus.fa',
      ),
    ).toBe(true);
  });

  it('does not let * cross a directory boundary', () => {
    expect(matchKeyOutputPattern('variants/*.fa', 'variants/ivar/file.fa')).toBe(false);
  });

  it('matches an exact relative path', () => {
    expect(matchKeyOutputPattern('multiqc/multiqc_report.html', 'multiqc/multiqc_report.html')).toBe(true);
    expect(matchKeyOutputPattern('multiqc/multiqc_report.html', 'multiqc/other.html')).toBe(false);
  });
});

describe('inferKeyOutputPattern', () => {
  it('generalises one sample consensus genome to *.consensus.fa', () => {
    expect(inferKeyOutputPattern(consensusFiles[0], allFiles)).toEqual(
      'variants/ivar/consensus/bcftools/*.consensus.fa',
    );
  });

  it('keeps a unique report as an exact path', () => {
    expect(inferKeyOutputPattern('multiqc/multiqc_report.html', allFiles)).toEqual('multiqc/multiqc_report.html');
  });

  it('prefers the most specific dotted suffix that still matches siblings', () => {
    expect(inferKeyOutputPattern(pangolinFiles[3], allFiles)).toEqual('pangolin/*.pangolin.csv');
  });
});

describe('inferKeyOutputLabel', () => {
  it('uses the distinctive filename token as a default role name', () => {
    expect(inferKeyOutputLabel('variants/ivar/consensus/bcftools/*.consensus.fa')).toEqual('Consensus');
    expect(inferKeyOutputLabel('pangolin/*.pangolin.csv')).toEqual('Pangolin');
    expect(inferKeyOutputLabel('multiqc/multiqc_report.html')).toEqual('Multiqc Report');
  });
});

describe('inferKeyOutputsFromSelection', () => {
  it('collapses 48 consensus files plus a QC report into two roles', () => {
    const inferred = inferKeyOutputsFromSelection(
      [consensusFiles[0], consensusFiles[7], 'multiqc/multiqc_report.html'],
      allFiles,
    );

    expect(inferred).toEqual([
      {
        Label: 'Consensus',
        Pattern: 'variants/ivar/consensus/bcftools/*.consensus.fa',
        ExamplePath: consensusFiles[0],
        MatchCount: 48,
      },
      {
        Label: 'Multiqc Report',
        Pattern: 'multiqc/multiqc_report.html',
        ExamplePath: 'multiqc/multiqc_report.html',
        MatchCount: 1,
      },
    ]);
  });
});

describe('scoreKeyOutputPatterns', () => {
  it('counts matches for already-declared patterns', () => {
    const scored = scoreKeyOutputPatterns(
      [{ Label: 'Lineage assignment', Pattern: 'pangolin/*.pangolin.csv' }],
      allFiles,
    );
    expect(scored[0].MatchCount).toEqual(48);
    expect(countKeyOutputMatches('missing/*.txt', allFiles)).toEqual(0);
  });
});

describe('parseKeyOutputsJson', () => {
  it('accepts the documented object wrapper', () => {
    const result = parseKeyOutputsJson(
      JSON.stringify({
        keyOutputs: [{ label: 'Consensus genome', pattern: 'variants/ivar/consensus/bcftools/*.consensus.fa' }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      outputs: [{ Label: 'Consensus genome', Pattern: 'variants/ivar/consensus/bcftools/*.consensus.fa' }],
    });
  });

  it('accepts a raw array as a convenience', () => {
    const result = parseKeyOutputsJson('[{"label":"QC report","pattern":"multiqc/multiqc_report.html"}]');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outputs[0].Label).toEqual('QC report');
    }
  });

  it('rejects a leading slash so patterns stay relative to the run root', () => {
    const result = parseKeyOutputsJson('[{"label":"Bad","pattern":"/multiqc/multiqc_report.html"}]');
    expect(result.ok).toBe(false);
  });

  it('round-trips through formatKeyOutputsJson', () => {
    const formatted = formatKeyOutputsJson([{ Label: 'QC report', Pattern: 'multiqc/multiqc_report.html' }]);
    expect(parseKeyOutputsJson(formatted)).toEqual({
      ok: true,
      outputs: [{ Label: 'QC report', Pattern: 'multiqc/multiqc_report.html' }],
    });
  });
});
