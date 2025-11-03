import React, { useMemo } from 'react';
import { getKeycloakRuntime } from '../config/client';

type LoginGateProps = {
  baseUrl: string;
  error?: string | null;
  onLogin: () => void;
};

export function LoginGate({ baseUrl, error, onLogin }: LoginGateProps) {
  const { url, realm, clientId } = useMemo(() => getKeycloakRuntime(), []);
  const keycloakBase = (url || '').replace(/\/$/, '');
  const redirectUri = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
  const directAuthUrl = keycloakBase && realm && clientId
    ? `${keycloakBase}/realms/${realm}/protocol/openid-connect/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid`
    : '';

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="glass-panel w-full max-w-md space-y-4 px-6 py-8 text-center">
        <h1 className="text-xl font-semibold text-white">Wymagane logowanie</h1>
        <p className="text-sm text-slate-300">Zaloguj się, aby korzystać z aplikacji i narzędzi MCP.</p>
        {error ? (
          <p className="rounded-2xl border border-danger/40 bg-danger/20 px-4 py-2 text-sm text-danger">{error}</p>
        ) : null}
        <button
          type="button"
          onClick={onLogin}
          className="inline-flex items-center justify-center rounded-full border border-accent/40 bg-accent/20 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-accent transition hover:bg-accent/30"
        >
          Zaloguj przez Keycloak
        </button>
        <details className="mt-4 text-left">
          <summary className="cursor-pointer text-xs text-slate-400">Diagnostyka logowania</summary>
          <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
            <div>API base: <code className="text-slate-200">{baseUrl}</code></div>
            <div>Keycloak URL: <code className="text-slate-200">{keycloakBase || '(brak)'}</code></div>
            <div>Realm: <code className="text-slate-200">{realm || '(brak)'}</code></div>
            <div>ClientId: <code className="text-slate-200">{clientId || '(brak)'}</code></div>
            {directAuthUrl ? (
              <div className="mt-2">
                <a className="underline text-accent" href={directAuthUrl}>Otwórz bezpośredni URL logowania</a>
              </div>
            ) : null}
          </div>
        </details>
      </div>
    </div>
  );
}

