export function formatPln(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
}

export function formatReceipts(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pl-PL').format(value);
}

