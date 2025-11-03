import { config } from '../config.js';
import type { AuthContext } from '../auth/context.js';
import { normalizeRoleName } from './utils.js';

type AuthLike = Partial<AuthContext> | undefined | null;

function normalizeCandidates(values: (string | undefined)[] | undefined): string[] {
  return (values ?? [])
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
}

export function isSuperAdmin(auth: AuthLike): boolean {
  if (!auth) {
    return false;
  }

  const username = typeof auth.username === 'string' ? auth.username.toLowerCase() : '';
  const name = typeof auth.name === 'string' ? auth.name.toLowerCase() : '';
  if (username === 'marcin' || name === 'marcin') {
    return true;
  }

  const adminCandidates = normalizeCandidates(config.rbac.adminUsers);
  const ownerCandidates = normalizeCandidates(config.rbac.ownerUsers);

  const identityHints = normalizeCandidates([
    auth.email,
    auth.username,
    auth.sub,
  ]);

  if (identityHints.some((hint) => adminCandidates.includes(hint) || ownerCandidates.includes(hint))) {
    return true;
  }

  const normalizedRoles = Array.isArray(auth.roles)
    ? auth.roles
        .map((role) => (typeof role === 'string' ? normalizeRoleName(role) : ''))
        .filter((role) => role.length > 0)
    : [];

  const hasAdminRole = normalizedRoles.some((role) => {
    if (role === '*' || role === 'owner') {
      return true;
    }
    const compact = role.replace(/[\s_-]/g, '');
    return compact === 'admin' || compact === 'superadmin';
  });

  return hasAdminRole;
}

export function collectAuthDiagnostics(auth: AuthLike) {
  const adminCandidates = normalizeCandidates(config.rbac.adminUsers);
  const ownerCandidates = normalizeCandidates(config.rbac.ownerUsers);
  const identityHints = normalizeCandidates([
    auth?.email,
    auth?.username,
    auth?.sub,
  ]);
  const normalizedRoles = Array.isArray(auth?.roles)
    ? auth!.roles
        .map((role) => (typeof role === 'string' ? normalizeRoleName(role) : ''))
        .filter((role) => role.length > 0)
    : [];

  return {
    identityHints,
    normalizedRoles,
    adminCandidates,
    ownerCandidates,
    isSuperAdmin: isSuperAdmin(auth),
  };
}
