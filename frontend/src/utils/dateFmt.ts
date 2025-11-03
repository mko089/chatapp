export function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

export function describeRelativeDay(date: Date): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  const oneDay = 24 * 60 * 60 * 1000;

  if (Math.abs(diffMs) < oneDay / 2) return 'Dziś';
  if (Math.abs(diffMs + oneDay) < oneDay / 2) return 'Wczoraj';
  if (Math.abs(diffMs - oneDay) < oneDay / 2) return 'Jutro';
  return null;
}

export function formatSessionPeriodLabel(from?: string | null, to?: string | null): string | null {
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to);
  if (!fromDate && !toDate) return null;

  const formatter = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium' });
  if (fromDate && toDate) {
    if (fromDate.getTime() === toDate.getTime()) {
      return describeRelativeDay(fromDate) ?? formatter.format(fromDate);
    }
    return `${formatter.format(fromDate)} → ${formatter.format(toDate)}`;
  }
  const single = fromDate ?? toDate;
  if (!single) return null;
  return describeRelativeDay(single) ?? formatter.format(single);
}

