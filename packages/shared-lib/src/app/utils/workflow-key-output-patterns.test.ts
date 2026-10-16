import {
  countKeyOutputMatches,
  formatKeyOutputsJson,
  inferKeyOutputLabel,
  inferKeyOutputPattern,
  inferKeyOutputsFromSelection,
  groupKeyOutputExamples,
  listKeyOutputMatches,
  matchKeyOutputPattern,
  parseKeyOutputsJson,
  scoreKeyOutputPatterns,
} from './workflow-key-output-patterns';
import { WorkflowKeyOutputSchema } from '../schema/easy-genomics/workflow-key-outputs';

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

  it('treats ? as a literal character', () => {
    expect(matchKeyOutputPattern('sample?*.csv', 'sampl.csv')).toBe(false);
    expect(matchKeyOutputPattern('sample?*.csv', 'sample?01.csv')).toBe(true);
  });

  it('does not let ** recurse into nested directories', () => {
    expect(matchKeyOutputPattern('results/**/*.bam', 'results/a/b/file.bam')).toBe(false);
    expect(matchKeyOutputPattern('results/*.bam', 'results/file.bam')).toBe(true);
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

  it('generalises a single-sample FastQC file so the next run still matches', () => {
    expect(
      inferKeyOutputPattern('pubdir/fastqc/ZRXXLL_R1_fastqc.html', [
        'pubdir/fastqc/ZRXXLL_R1_fastqc.html',
        'pubdir/multiqc/multiqc_report.html',
      ]),
    ).toEqual('pubdir/fastqc/*_fastqc.html');
  });

  it('generalises a lone sample.consensus.fa when this run has only one sample', () => {
    expect(inferKeyOutputPattern('variants/sample01.consensus.fa', ['variants/sample01.consensus.fa'])).toEqual(
      'variants/*.consensus.fa',
    );
  });

  it('keeps a unique report as an exact path', () => {
    expect(inferKeyOutputPattern('multiqc/multiqc_report.html', allFiles)).toEqual('multiqc/multiqc_report.html');
  });

  it('prefers the most specific dotted suffix that still matches siblings', () => {
    expect(inferKeyOutputPattern(pangolinFiles[3], allFiles)).toEqual('pangolin/*.pangolin.csv');
  });

  it('turns a folder path into a location glob', () => {
    expect(inferKeyOutputPattern('pubdir/multiqc', ['pubdir/multiqc/multiqc_report.html'])).toEqual('pubdir/multiqc/*');
  });
});

describe('inferKeyOutputLabel', () => {
  it('uses the distinctive filename token as a default role name', () => {
    expect(inferKeyOutputLabel('variants/ivar/consensus/bcftools/*.consensus.fa')).toEqual('Consensus');
    expect(inferKeyOutputLabel('pangolin/*.pangolin.csv')).toEqual('Pangolin');
    expect(inferKeyOutputLabel('pubdir/fastqc/*_fastqc.html')).toEqual('Fastqc');
    expect(inferKeyOutputLabel('pubdir/multiqc/*')).toEqual('Multiqc');
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

  it('rewrites a saved folder path so it matches the files in that location', () => {
    const scored = scoreKeyOutputPatterns(
      [{ Label: 'Multiqc Report', Pattern: 'pubdir/multiqc' }],
      ['pubdir/multiqc/multiqc_report.html', 'pubdir/fastqc/ZRXXLL_R1_fastqc.html'],
    );
    expect(scored[0].Pattern).toEqual('pubdir/multiqc/*');
    expect(scored[0].MatchCount).toEqual(1);
  });
});

describe('groupKeyOutputExamples', () => {
  it('shows one consensus example and the unique MultiQC report', () => {
    const files = [
      ...consensusFiles.map((RelativePath) => ({ Key: `root/${RelativePath}`, RelativePath, Size: 1000 })),
      { Key: 'root/multiqc/multiqc_report.html', RelativePath: 'multiqc/multiqc_report.html', Size: 3200000 },
    ];
    const groups = groupKeyOutputExamples(files);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.Pattern.endsWith('*.consensus.fa'))).toMatchObject({
      MatchCount: 48,
      Directory: 'variants/ivar/consensus/bcftools',
    });
    expect(groups.find((group) => group.ExamplePath === 'multiqc/multiqc_report.html')).toMatchObject({
      MatchCount: 1,
      Pattern: 'multiqc/multiqc_report.html',
    });
  });
});

describe('listKeyOutputMatches', () => {
  it('returns the matching files with their sizes', () => {
    const files = [
      ...consensusFiles.map((RelativePath, index) => ({
        Key: `root/${RelativePath}`,
        RelativePath,
        Size: 1000 + index,
      })),
      { Key: 'root/multiqc/multiqc_report.html', RelativePath: 'multiqc/multiqc_report.html', Size: 3200000 },
    ];

    const matches = listKeyOutputMatches('variants/ivar/consensus/bcftools/*.consensus.fa', files);
    expect(matches).toHaveLength(48);
    expect(matches[0].RelativePath).toEqual(consensusFiles[0]);
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

  it('rejects ** and more than four stars in one segment', () => {
    const doubleStar = parseKeyOutputsJson('[{"label":"Reads","pattern":"results/**/*.bam"}]');
    expect(doubleStar.ok).toBe(false);
    const crowded = WorkflowKeyOutputSchema.safeParse({
      KeyOutputId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      Label: 'Reads',
      Pattern: 'results/*a*b*c*d*e.bam',
    });
    expect(crowded.success).toBe(false);
  });

  it('round-trips through formatKeyOutputsJson', () => {
    const formatted = formatKeyOutputsJson([{ Label: 'QC report', Pattern: 'multiqc/multiqc_report.html' }]);
    expect(parseKeyOutputsJson(formatted)).toEqual({
      ok: true,
      outputs: [{ Label: 'QC report', Pattern: 'multiqc/multiqc_report.html' }],
    });
  });
});
