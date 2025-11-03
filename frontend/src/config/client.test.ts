import { describe, it, expect, beforeEach, vi } from 'vitest';

// dynamic import so we can control env/window before module evaluation
async function importClient() {
  return await import('./client');
}

declare global {
  // eslint-disable-next-line no-var
  var __CHATAPP_CONFIG: any;
}

describe('config/client runtime resolution', () => {
  beforeEach(() => {
    // reset runtime config and env for each test
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.__CHATAPP_CONFIG = {};
    (globalThis as any).__CHATAPP_CONFIG = (globalThis as any).window.__CHATAPP_CONFIG;
    // vitest exposes import.meta.env through Vite; emulate by patching process.env
    delete (process.env as any).VITE_KEYCLOAK_URL;
    delete (process.env as any).VITE_KEYCLOAK_REALM;
    delete (process.env as any).VITE_KEYCLOAK_CLIENT_ID;
  });

  it('uses env when runtime provides empty values', async () => {
    (globalThis as any).window.__CHATAPP_CONFIG = { keycloak: { url: '', realm: '', clientId: '' } };
    (process.env as any).VITE_KEYCLOAK_URL = 'http://env.example:8080';
    (process.env as any).VITE_KEYCLOAK_REALM = 'garden';
    (process.env as any).VITE_KEYCLOAK_CLIENT_ID = 'app';

    const { getKeycloakRuntime } = await importClient();
    const kc = getKeycloakRuntime();
    expect(kc.url).toBe('http://env.example:8080');
    expect(kc.realm).toBe('garden');
    expect(kc.clientId).toBe('app');
  });

  it('prefers runtime-config over env when non-empty', async () => {
    (globalThis as any).window.__CHATAPP_CONFIG = { keycloak: { url: 'http://rc.local:8080', realm: 'rg', clientId: 'rc-app' } };
    (process.env as any).VITE_KEYCLOAK_URL = 'http://env.example:8080';
    (process.env as any).VITE_KEYCLOAK_REALM = 'garden';
    (process.env as any).VITE_KEYCLOAK_CLIENT_ID = 'app';

    const { getKeycloakRuntime } = await importClient();
    const kc = getKeycloakRuntime();
    expect(kc.url).toBe('http://rc.local:8080');
    expect(kc.realm).toBe('rg');
    expect(kc.clientId).toBe('rc-app');
  });
});

