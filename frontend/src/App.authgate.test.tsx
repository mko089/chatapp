import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';

// We mock only useAuth to control auth state; other exports stay real
vi.mock('./auth/AuthProvider', async (orig) => {
  const actual = await (orig as any)();
  let currentAuth = {
    enabled: true,
    ready: true,
    isAuthenticated: false,
    token: null as string | null,
    user: undefined,
    serverProfile: null,
    isSuperAdmin: false,
    error: null as string | null,
  };
  return {
    ...actual,
    useAuth: () => ({
      ...currentAuth,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(async () => null),
    }),
    // helper for tests to flip auth state
    __setAuthState: (next: Partial<typeof currentAuth>) => {
      currentAuth = { ...currentAuth, ...next };
    },
  };
});

// Import AFTER the mock so it sees mocked useAuth
import App from './App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":sessionId" element={<App />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Auth gate integration', () => {
  beforeEach(() => {
    (globalThis as any).__CHATAPP_CONFIG = { requireAuth: true };
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('shows LoginGate when unauthenticated and does not fetch sessions', async () => {
    const { __setAuthState } = await import('./auth/AuthProvider' as any);
    __setAuthState({ isAuthenticated: false, enabled: true, ready: true, token: null });
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    renderAt('/abc');

    const gate = await screen.findByText(/Wymagane logowanie/i);
    expect(gate).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('when authenticated, fetches sessions and health', async () => {
    const { __setAuthState } = await import('./auth/AuthProvider' as any);
    __setAuthState({ isAuthenticated: true, enabled: true, ready: true, token: 't' });
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/health$/.test(url)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              backend: 'ok',
              mcp: { status: 'ok' },
              openai: { status: 'ok', model: 'gpt-4o-mini', allowedModels: [] },
              rbac: { enabled: false, roles: [] },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      if (/\/mcp\/tools$/.test(url)) {
        return Promise.resolve(new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (/\/sessions(\?.*)?$/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    });

    renderAt('/abc');

    await waitFor(() => {
      // At least one of expected endpoints should be hit
      expect(fetchSpy.mock.calls.find((c) => `${c[0]}`.includes('/sessions'))).toBeTruthy();
      expect(fetchSpy.mock.calls.find((c) => `${c[0]}`.includes('/health'))).toBeTruthy();
    });

    // And LoginGate should not be visible
    expect(screen.queryByText(/Wymagane logowanie/i)).toBeNull();
  });
});
