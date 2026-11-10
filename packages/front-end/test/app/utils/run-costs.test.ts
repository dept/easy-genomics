import type { RunCostsReport } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';
import {
  formatChange,
  formatUsd,
  periodLabel,
  recentMonths,
  runCostsCsv,
  runCostsCsvFileName,
} from '../../../src/app/utils/run-costs';

const ORG_ID = '1f6e0f8e-5d0c-4c58-9d3b-1a2b3c4d5e6f';

describe('recentMonths', () => {
  it('lists the current month first, then the eleven before it', () => {
    const months = recentMonths(new Date(Date.UTC(2026, 10, 10)));
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: '2026-11', label: 'Nov 2026' });
    expect(months[1]).toEqual({ value: '2026-10', label: 'Oct 2026' });
    expect(months[11]).toEqual({ value: '2025-12', label: 'Dec 2025' });
  });

  it('crosses the year boundary and honours the count', () => {
    expect(recentMonths(new Date(Date.UTC(2026, 0, 31)), 2)).toEqual([
      { value: '2026-01', label: 'Jan 2026' },
      { value: '2025-12', label: 'Dec 2025' },
    ]);
  });
});

describe('periodLabel', () => {
  it('names a calendar month in full', () => {
    expect(periodLabel({ organizationId: ORG_ID, period: 'month', month: '2026-11' })).toBe('November 2026');
  });

  it.each([
    ['30d', 'Last 30 days'],
    ['60d', 'Last 60 days'],
    ['90d', 'Last 90 days'],
  ] as const)('names %s as "%s"', (period, label) => {
    expect(periodLabel({ organizationId: ORG_ID, period })).toBe(label);
  });
});

describe('formatUsd', () => {
  it('rounds to cents with thousands separators', () => {
    expect(formatUsd(1234.5)).toBe('US$1,234.50');
    expect(formatUsd(0.30000000000000004)).toBe('US$0.30');
    expect(formatUsd(0)).toBe('US$0.00');
  });
});

describe('formatChange', () => {
  it('signs and rounds the percentage', () => {
    expect(formatChange(12.4)).toBe('+12%');
    expect(formatChange(-5.2)).toBe('−5%');
    expect(formatChange(0)).toBe('0%');
  });

  it('shows a dash when there is nothing to compare with', () => {
    expect(formatChange(null)).toBe('—');
  });
});

describe('runCostsCsv', () => {
  const figures = { FinishedRuns: 3, WarnedRuns: 1, BlockedLaunches: 0 };
  const report: RunCostsReport = {
    Period: { Start: '2026-11-01', End: '2026-11-30' },
    PreviousPeriod: { Start: '2026-10-01', End: '2026-10-31' },
    Totals: { ...figures, EstimatedCostUsd: 10.123 },
    PreviousTotals: { ...figures, EstimatedCostUsd: 8 },
    Labs: [
      {
        ...figures,
        LaboratoryId: 'lab-1',
        LaboratoryName: 'Sequencing, "Main"',
        EstimatedCostUsd: 10.123,
        PreviousEstimatedCostUsd: 8,
        ChangePercent: 26.5375,
        SharePercent: 100,
        Workflows: [
          {
            ...figures,
            Platform: 'AWS HealthOmics',
            WorkflowExternalId: 'wf-1',
            WorkflowName: 'Bactopia',
            EstimatedCostUsd: 0.30000000000000004,
            PreviousEstimatedCostUsd: 0,
            ChangePercent: null,
            SharePercent: 2.9634,
          },
        ],
      },
    ],
  };

  it('writes a header, a lab row, its workflow rows and a total', () => {
    expect(runCostsCsv(report).split('\r\n')).toEqual([
      'Lab,Workflow,Runs,Estimated cost (USD),Previous (USD),Change (%),Share (%)',
      '"Sequencing, ""Main""",,3,10.12,8.00,26.54,100.00',
      '"Sequencing, ""Main""",Bactopia,3,0.30,0.00,,2.96',
      'Total,,3,10.12,8.00,26.54,100.00',
    ]);
  });

  it('quotes a field with a newline', () => {
    const multiline = { ...report, Labs: [{ ...report.Labs[0], LaboratoryName: 'Line\nbreak', Workflows: [] }] };
    expect(runCostsCsv(multiline).split('\r\n')[1]).toBe('"Line\nbreak",,3,10.12,8.00,26.54,100.00');
  });

  it('writes only the header and a zero total for an empty report', () => {
    const zero = { EstimatedCostUsd: 0, FinishedRuns: 0, WarnedRuns: 0, BlockedLaunches: 0 };
    const empty: RunCostsReport = { ...report, Totals: zero, PreviousTotals: zero, Labs: [] };
    expect(runCostsCsv(empty).split('\r\n')).toEqual([
      'Lab,Workflow,Runs,Estimated cost (USD),Previous (USD),Change (%),Share (%)',
      'Total,,0,0.00,0.00,,0.00',
    ]);
  });
});

describe('runCostsCsvFileName', () => {
  it('slugs the organization and the period', () => {
    expect(runCostsCsvFileName('Default Organization', 'November 2026')).toBe(
      'run-costs-default-organization-november-2026.csv',
    );
    expect(runCostsCsvFileName('  WSLH / Lab #1 ', 'Last 30 days')).toBe('run-costs-wslh-lab-1-last-30-days.csv');
  });
});
