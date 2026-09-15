import {
  format,
  parseISO,
  isValid,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarYears,
} from 'date-fns';

function parseAndValidateDate(input: string | null | undefined) {
  if (!input) {
    console.error('Invalid or missing date string provided:', input);
    return null;
  }
  const date = parseISO(input); // ISO 8601 format '2007-12-03T10:15:30Z'
  if (!isValid(date)) {
    console.error('Invalid date string provided:', input);
    return null;
  }
  return date;
}

/**
 * Return the date in the format yyyy-MM-dd, e.g. '2021-01-01'
 * @param input
 */
export function getDate(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const date = parseAndValidateDate(input);
  if (!date) return null;

  return format(date, 'yyyy-MM-dd');
}

/**
 * Return the time in the format hh:mm:ss a GMT+/-offset, e.g. '09:38:13 AM GMT+10'
 * @param input
 */
export function getTime(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const date = parseAndValidateDate(input);
  if (!date) return null;

  const offsetInHours = -date.getTimezoneOffset() / 60;
  const offset = offsetInHours >= 0 ? `+${Math.abs(offsetInHours)}` : `-${Math.abs(offsetInHours)}`;
  const formattedDate = format(date, 'hh:mm:ss a');
  return `${formattedDate} GMT${offset}`;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular} ago` : `${count} ${plural} ago`;
}

/**
 * Relative display for run timestamps (local calendar day boundaries):
 * - today → time
 * - yesterday → "Yesterday"
 * - 2–30 days ago → "N days ago"
 * - 1–12 months ago → "N month(s) ago"
 * - older → "N year(s) ago"
 * - future → absolute date (yyyy-MM-dd)
 */
export function formatRelativeDateTime(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }

  const date = parseAndValidateDate(input);
  if (!date) return null;

  const now = new Date();
  const daysAgo = differenceInCalendarDays(now, date);

  // Future timestamps are unexpected for CreatedAt; show an absolute date rather than a
  // relative label (negative day/month diffs would otherwise fall through incorrectly).
  if (daysAgo < 0) {
    return getDate(input);
  }

  if (daysAgo === 0) {
    return getTime(input);
  }

  if (daysAgo === 1) {
    return 'Yesterday';
  }

  if (daysAgo <= 30) {
    return pluralize(daysAgo, 'day', 'days');
  }

  const monthsAgo = differenceInCalendarMonths(now, date);
  // daysAgo > 30 implies at least one calendar month in normal cases; guard anyway.
  if (monthsAgo <= 12) {
    return pluralize(Math.max(1, monthsAgo), 'month', 'months');
  }

  const yearsAgo = Math.max(1, differenceInCalendarYears(now, date));
  return pluralize(yearsAgo, 'year', 'years');
}
