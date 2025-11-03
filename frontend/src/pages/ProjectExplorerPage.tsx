import { useCallback, useEffect, useState } from 'react';
import { ProjectsSidebar } from '../components/ProjectsSidebar';
import { DocumentViewer } from '../components/DocumentViewer';
import { useAuthorizedFetch } from '../hooks/useAuthorizedFetch';
import { useAuth } from '../auth/AuthProvider';

function resolveBaseUrl(): string {
  const explicit = (typeof window !== 'undefined' ? window.__CHATAPP_CONFIG?.chatApiUrl : undefined) as string | undefined;
  if (explicit && explicit.length > 0) {
    return explicit;
  }

  const fallbackPort = (import.meta as any)?.env?.VITE_CHATAPI_PORT ?? '4025';
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(window.location.href);
      url.port = fallbackPort;
      return url.origin;
    } catch (error) {
      // ignore
    }
  }
  return `http://localhost:${fallbackPort}`;
}

export function ProjectExplorerPage() {
  const auth = useAuth();
  const authorizedFetch = useAuthorizedFetch();
  const [baseUrl] = useState<string>(() => resolveBaseUrl());
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedDocPath, setSelectedDocPath] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const authReady = !auth.enabled || (auth.ready && auth.isAuthenticated);
  const authLoading = auth.enabled && !auth.ready;
  const requiresLogin = auth.enabled && auth.ready && !auth.isAuthenticated;

  const handleLogin = useCallback(() => {
    if (!auth.login) {
      return;
    }
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    void auth.login().catch(() => {
      const base = ((typeof window !== 'undefined' ? window.__CHATAPP_CONFIG?.keycloak?.url : undefined) as string | undefined)?.replace(/\/$/, '') ?? '';
      const realm = (typeof window !== 'undefined' ? window.__CHATAPP_CONFIG?.keycloak?.realm : undefined) as string | undefined;
      const clientId = (typeof window !== 'undefined' ? window.__CHATAPP_CONFIG?.keycloak?.clientId : undefined) as string | undefined;
      if (!base || !realm || !clientId) {
        return;
      }
      const loginUrl = `${base}/realms/${realm}/protocol/openid-connect/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid`;
      window.location.href = loginUrl;
    });
  }, [auth]);

  const handleSelectProject = useCallback((projectId: string) => {
    const normalized = projectId && projectId.trim().length > 0 ? projectId : null;
    setSelectedProjectId(normalized);
    setSelectedDocPath(null);
    setRefreshKey((tick) => tick + 1);
  }, []);

  const handleOpenDoc = useCallback((path: string) => {
    setSelectedDocPath(path);
    setPreviewHtml(null);
    setPreviewError(null);
  }, []);

  const handleOpenEditor = useCallback(() => {
    setIsEditorOpen(true);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setIsEditorOpen(false);
  }, []);

  useEffect(() => {
    if (!selectedProjectId || !selectedDocPath) {
      setPreviewHtml(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const url = `${baseUrl}/projects/${encodeURIComponent(selectedProjectId)}/doc/${selectedDocPath.split('/').map(encodeURIComponent).join('/')}`;
        const res = await authorizedFetch(url);
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `HTTP ${res.status}`);
        }
        const txt = await res.text();
        if (!cancelled) {
          setPreviewHtml(txt);
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, baseUrl, refreshKey, selectedDocPath, selectedProjectId]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
        <div className="glass-panel w-full max-w-md px-6 py-8 text-center text-slate-200">Ładowanie sesji…</div>
      </div>
    );
  }

  if (requiresLogin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
        <div className="glass-panel w-full max-w-md space-y-4 px-6 py-8 text-center">
          <h1 className="text-xl font-semibold text-white">Wymagane logowanie</h1>
          <p className="text-sm text-slate-300">Zaloguj się, aby zarządzać dokumentami projektów.</p>
          {auth.error ? <p className="rounded-2xl border border-danger/40 bg-danger/20 px-4 py-2 text-sm text-danger">{auth.error}</p> : null}
          <button
            type="button"
            onClick={handleLogin}
            className="inline-flex items-center justify-center rounded-full border border-accent/40 bg-accent/20 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-accent transition hover:bg-accent/30"
          >
            Zaloguj się
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-screen-2xl flex-col gap-4 px-4 pb-16 pt-6 lg:flex-row">
        <div className="lg:hidden">
          <ProjectsSidebar
            baseUrl={baseUrl}
            authorizedFetch={authorizedFetch}
            open
            selectedProjectId={selectedProjectId}
            onSelectProject={handleSelectProject}
            onOpenDoc={handleOpenDoc}
            refreshKey={refreshKey}
          />
        </div>
        <div className="hidden lg:block lg:w-80 lg:flex-shrink-0">
          <ProjectsSidebar
            baseUrl={baseUrl}
            authorizedFetch={authorizedFetch}
            open
            selectedProjectId={selectedProjectId}
            onSelectProject={handleSelectProject}
            onOpenDoc={handleOpenDoc}
            refreshKey={refreshKey}
          />
        </div>
        <section className="glass-panel flex min-h-[calc(100vh-6rem)] flex-1 flex-col gap-4 p-6">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-white">Eksplorator projektów</h1>
              <p className="text-sm text-slate-400">Przeglądaj i edytuj statyczne dokumenty HTML w projektach.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              {selectedProjectId ? <span className="chip chip-accent">Projekt: {selectedProjectId}</span> : <span className="chip chip-muted">Wybierz projekt</span>}
              {selectedDocPath ? <span className="chip chip-primary">Dokument: {selectedDocPath}</span> : <span className="chip chip-muted">Brak dokumentu</span>}
            </div>
          </header>

          <div className="flex-1 overflow-hidden rounded-2xl border border-white/5 bg-white/5">
            {!selectedProjectId || !selectedDocPath ? (
              <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center text-slate-300">
                <p className="text-base">Wybierz dokument z panelu, aby zobaczyć jego podgląd.</p>
                <p className="text-sm text-slate-400">Możesz utworzyć nowy dokument za pomocą przycisku „Nowy dokument”.</p>
              </div>
            ) : previewLoading ? (
              <div className="flex h-full min-h-[60vh] items-center justify-center px-6 text-slate-300">Ładowanie dokumentu…</div>
            ) : previewError ? (
              <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-2 px-6 text-center text-danger">
                <p>Nie udało się pobrać dokumentu.</p>
                <p className="text-xs text-danger/80">{previewError}</p>
              </div>
            ) : previewHtml ? (
              <iframe
                key={`${selectedProjectId}-${selectedDocPath}-${refreshKey}`}
                srcDoc={previewHtml}
                title={`Podgląd ${selectedDocPath}`}
                className="h-full min-h-[60vh] w-full border-0 bg-white"
                sandbox="allow-same-origin"
              />
            ) : (
              <div className="flex h-full min-h-[60vh] items-center justify-center px-6 text-slate-300">Dokument jest pusty.</div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={!selectedProjectId || !selectedDocPath}
              onClick={handleOpenEditor}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-primary/40 hover:bg-primary/20 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Edytuj HTML
            </button>
          </div>
        </section>
      </div>

      {isEditorOpen && selectedProjectId && selectedDocPath ? (
        <DocumentViewer
          baseUrl={baseUrl}
          projectId={selectedProjectId}
          path={selectedDocPath}
          authorizedFetch={authorizedFetch}
          onClose={handleCloseEditor}
          onSaved={() => setRefreshKey((tick) => tick + 1)}
        />
      ) : null}
    </div>
  );
}

export default ProjectExplorerPage;
