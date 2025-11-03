#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const envPath = path.join(root, '.env');
const rcPath = path.join(__dirname, '..', 'public', 'runtime-config.js');

// Load chatapp/.env if present (simple parser)
try {
  const envRaw = require('fs').readFileSync(envPath, 'utf8');
  for (const line of envRaw.split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}

const requireAuthRaw = process.env.VITE_REQUIRE_AUTH ?? 'true';
const requireAuth = !['false', '0', ''].includes(String(requireAuthRaw).trim().toLowerCase());

function pick(...values) {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s.length > 0) return s;
  }
  return '';
}

function readRuntimeConfig() {
  let rc = '';
  try { rc = fs.readFileSync(rcPath, 'utf8'); } catch {}
  const extract = (key) => {
    const re = new RegExp(`\\b${key}\\s*:\\s*['\"]?([^'\",\n]+)`, 'i');
    const m = rc.match(re);
    return m ? m[1] : '';
  };
  return {
    url: extract('url'),
    realm: extract('realm'),
    clientId: extract('clientId'),
  };
}

const rc = readRuntimeConfig();
const effUrl = pick(rc.url, process.env.VITE_KEYCLOAK_URL);
const effRealm = pick(rc.realm, process.env.VITE_KEYCLOAK_REALM);
const effClient = pick(rc.clientId, process.env.VITE_KEYCLOAK_CLIENT_ID);

if (requireAuth && (!effUrl || !effRealm || !effClient)) {
  console.error('[check-runtime-config] requireAuth=true but Keycloak config is incomplete.');
  console.error(`  keycloak.url   = '${effUrl}'`);
  console.error(`  keycloak.realm = '${effRealm}'`);
  console.error(`  keycloak.clientId = '${effClient}'`);
  console.error(`  Files checked: .env=${fs.existsSync(envPath)}, runtime-config.js=${fs.existsSync(rcPath)}`);
  process.exit(1);
}

console.log('[check-runtime-config] OK');
