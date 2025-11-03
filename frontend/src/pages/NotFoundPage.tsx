import { useEffect } from 'react';

export function NotFoundPage() {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const previousTitle = document.title;
    document.title = '404 — Nie znaleziono';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-center text-slate-100">
      <div>
        <p className="text-base uppercase tracking-widest text-slate-400">Błąd</p>
        <h1 className="text-5xl font-semibold tracking-tight text-white">404 — Nie znaleziono</h1>
      </div>
      <p className="max-w-lg text-lg text-slate-300">
        Wygląda na to, że ta strona nie istnieje. Sprawdź adres lub wróć na ekran główny aplikacji.
      </p>
      <a
        className="rounded-md bg-blue-500 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
        href="/"
      >
        Wróć do aplikacji
      </a>
    </div>
  );
}
