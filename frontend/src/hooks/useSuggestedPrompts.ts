import { useMemo } from 'react';

function formatHumanLocation(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function useSuggestedPrompts(params: { location: string | null }) {
  const { location } = params;
  return useMemo(() => {
    return [
      'Pokaż dzisiejsze obroty',
      'Zestawienie brutto/netto',
      'Top 5 pozycji sprzedaży',
      'Ile było paragonów?',
      location ? `Oraz to samo dla ${formatHumanLocation(String(location))}` : undefined,
      'Zużycie narzędzi MCP w tej sesji',
    ].filter(Boolean) as string[];
  }, [location]);
}

