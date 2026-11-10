import type { RunCostsQuery } from '@easy-genomics/shared-lib/src/app/schema/easy-genomics/run-costs';
import type { RunCostsReport } from '@easy-genomics/shared-lib/src/app/types/easy-genomics/usage-totals';

export type MonthOption = { value: string; label: string };

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const CSV_HEADER = ['Lab', 'Workflow', 'Runs', 'Estimated cost (USD)', 'Previous (USD)', 'Change (%)', 'Share (%)'];

/** Calendar months (UTC) ending with the one containing `today`, newest first. */
export function recentMonths(today: Date, count = 12): MonthOption[] {
  const months: MonthOption[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const month = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
    const year = month.getUTCFullYear();
    const monthIndex = month.getUTCMonth();
    months.push({
      value: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[monthIndex].slice(0, 3)} ${year}`,
    });
  }
  return months;
}

export function periodLabel(query: RunCostsQuery): string {
  if (query.period === 'month') {
    const [year, month] = query.month.split('-');
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
  }
  return `Last ${query.period.replace('d', '')} days`;
}

export function formatUsd(value: number): string {
  return `US$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatChange(percent: number | null): string {
  if (percent === null) return '—';
  const rounded = Math.round(percent);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `−${Math.abs(rounded)}%`;
  return '0%';
}

/** The organization-wide change, computed the same way the back-end computes each row's. */
export function totalsChangePercent(report: RunCostsReport): number | null {
  const previous = report.PreviousTotals.EstimatedCostUsd;
  return previous === 0 ? null : ((report.Totals.EstimatedCostUsd - previous) / previous) * 100;
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map(csvField).join(',');
}

function twoDecimals(value: number | null): string {
  return value === null ? '' : value.toFixed(2);
}

/** Every lab row followed by all of its workflow rows, whether or not they are expanded on screen. */
export function runCostsCsv(report: RunCostsReport): string {
  const rows = [csvRow(CSV_HEADER)];

  for (const lab of report.Labs) {
    rows.push(
      csvRow([
        lab.LaboratoryName,
        '',
        lab.FinishedRuns,
        twoDecimals(lab.EstimatedCostUsd),
        twoDecimals(lab.PreviousEstimatedCostUsd),
        twoDecimals(lab.ChangePercent),
        twoDecimals(lab.SharePercent),
      ]),
    );
    for (const workflow of lab.Workflows) {
      rows.push(
        csvRow([
          lab.LaboratoryName,
          workflow.WorkflowName,
          workflow.FinishedRuns,
          twoDecimals(workflow.EstimatedCostUsd),
          twoDecimals(workflow.PreviousEstimatedCostUsd),
          twoDecimals(workflow.ChangePercent),
          twoDecimals(workflow.SharePercent),
        ]),
      );
    }
  }

  rows.push(
    csvRow([
      'Total',
      '',
      report.Totals.FinishedRuns,
      twoDecimals(report.Totals.EstimatedCostUsd),
      twoDecimals(report.PreviousTotals.EstimatedCostUsd),
      twoDecimals(totalsChangePercent(report)),
      twoDecimals(report.Totals.EstimatedCostUsd === 0 ? 0 : 100),
    ]),
  );

  return rows.join('\r\n');
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function runCostsCsvFileName(orgName: string, label: string): string {
  return `run-costs-${slug(orgName)}-${slug(label)}.csv`;
}
