import { useCallback, useEffect, useState } from 'react';

interface DocumentViewerProps {
  baseUrl: string;
  projectId: string;
  path: string;
  authorizedFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSaved?: (path: string) => void;
}

export function DocumentViewer({ baseUrl, projectId, path, authorizedFetch, onClose, onSaved }: DocumentViewerProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [html, setHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}/doc/${path.split('/').map(encodeURIComponent).join('/')}`;
      const res = await authorizedFetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      const txt = await res.text();
      setHtml(txt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch, baseUrl, path, projectId]);

  useEffect(() => {
    fetchDoc().catch(() => {});
  }, [fetchDoc, version]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authorizedFetch(`${baseUrl}/projects/${encodeURIComponent(projectId)}/doc`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, html }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMode('view');
      setVersion((v) => v + 1);
      onSaved?.(path);
    } catch (err) {
      alert(`Nie udało się zapisać: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-panel w-full max-w-5xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div>
            <div className="text-lg font-semibold text-white">{path}</div>
            <div className="text-sm text-slate-400">Projekt: {projectId}</div>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'view' ? (
              <button
                type="button"
                onClick={() => setMode('edit')}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
              >
                Edytuj HTML
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-full border border-primary/50 bg-primary/20 px-3 py-1 text-sm font-semibold text-primary hover:bg-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Zapisywanie…' : 'Zapisz'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('view')}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
                >
                  Podgląd
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300 hover:border-white/30 hover:bg-white/10"
            >
              Zamknij
            </button>
          </div>
        </div>
        <div className="max-h-[80vh] overflow-auto">
          <div className="p-4">
            {loading ? (
              <div className="text-sm text-slate-400">Ładowanie…</div>
            ) : error ? (
              <div className="rounded-xl border border-danger/40 bg-danger/15 px-3 py-2 text-sm text-danger">{error}</div>
            ) : mode === 'view' ? (
              <iframe
                key={version}
                title={path}
                srcDoc={html}
                className="h-[70vh] w-full border-0 bg-white"
                sandbox="allow-same-origin"
              />
            ) : (
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                className="h-[70vh] w-full resize-none rounded-xl bg-white/5 p-3 font-mono text-sm text-slate-100 focus:outline-none"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
