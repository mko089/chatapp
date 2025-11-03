import type { SessionSummary } from '../types';

export function formatSessionTimestamp(value?: string): string {
  if (!value) {
    return 'Nieznana data';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Nieznana data';
  }
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function deriveSessionTitle(session: SessionSummary): string {
  const primary = session.title?.trim();
  if (primary && primary.length > 0) {
    return primary;
  }
  const fallback = session.lastMessagePreview?.trim();
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return `Sesja ${session.id.slice(0, 8)}`;
}

