import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { config } from '../config.js';
import logger from '../logger.js';
import type { AuthContext } from '../auth/context.js';

type OnRequestHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const AUTHORIZATION_HEADER = 'authorization';

const acceptedAlgorithms = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'] as const;

function normaliseIssuer(issuer: string): string {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

function buildJwksUrl(issuer: string): URL {
  return new URL(`${normaliseIssuer(issuer)}/protocol/openid-connect/certs`);
}

function parsePatterns(rawPatterns: string[]): string[] {
  const unique = new Set<string>();
  for (const pattern of rawPatterns) {
    if (!pattern) continue;
    unique.add(pattern);
  }
  return [...unique];
}

const publicPathPatterns = parsePatterns(config.auth.publicPaths);
const optionalAuthPathPatterns = parsePatterns(config.auth.optionalAuthPaths);

const issuerUrl = config.auth.issuer ? buildJwksUrl(config.auth.issuer) : undefined;

const remoteJwks = issuerUrl
  ? createRemoteJWKSet(issuerUrl, {
      cacheMaxAge: config.auth.jwksCacheMs,
      cooldownDuration: 30_000,
    })
  : undefined;

const configuredRolePaths = (() => {
  const raw = config.auth.rolesPath
    .split(/[|,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const defaults = [
    'realm_access.roles',
    'groups',
    config.auth.clientId ? `resource_access.${config.auth.clientId}.roles` : undefined,
    'resource_access.*.roles',
  ].filter((value): value is string => Boolean(value));

  return parsePatterns([...raw, ...defaults]);
})();

function collectValues(node: unknown, segments: string[], index = 0): unknown[] {
  if (node === undefined || node === null) {
    return [];
  }

  if (index >= segments.length) {
    return [node];
  }

  const segment = segments[index];

  if (segment === '*') {
    if (typeof node !== 'object') {
      return [];
    }

    const values: unknown[] = [];
    for (const value of Object.values(node as Record<string, unknown>)) {
      values.push(...collectValues(value, segments, index + 1));
    }
    return values;
  }

  if (typeof node !== 'object' || !(segment in (node as Record<string, unknown>))) {
    return [];
  }

  return collectValues((node as Record<string, unknown>)[segment], segments, index + 1);
}

function getFirstValue(payload: JWTPayload, path: string): unknown {
  const values = collectValues(payload as Record<string, unknown>, path.split('.'));
  return values[0];
}

function resolveAccountId(payload: JWTPayload): string | undefined {
  const candidatePaths = parsePatterns([
    config.auth.accountClaim,
    'account',
    'tenant',
    'tenantId',
    'orgId',
    'organizationId',
    'garden_account_id',
  ]);

  for (const path of candidatePaths) {
    const value = getFirstValue(payload, path);
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function resolveRoles(payload: JWTPayload): string[] {
  const roles = new Set<string>();

  for (const path of configuredRolePaths) {
    const value = collectValues(payload as Record<string, unknown>, path.split('.'));
    for (const entry of value) {
      if (typeof entry === 'string' && entry.length > 0) {
        roles.add(entry);
      } else if (Array.isArray(entry)) {
        for (const item of entry) {
          if (typeof item === 'string' && item.length > 0) {
            roles.add(item);
          }
        }
      }
    }
  }

  return [...roles];
}

function matchesAnyPattern(pathname: string, method: string, patterns: string[]): boolean {
  if (!patterns.length) {
    return false;
  }

  const target = pathname.toLowerCase();
  const targetWithMethod = `${method.toLowerCase()} ${target}`;

  return patterns.some((pattern) => {
    const candidate = pattern.toLowerCase();
    if (candidate.includes(' ')) {
      return matchPattern(targetWithMethod, candidate);
    }
    return matchPattern(target, candidate);
  });
}

function matchPattern(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) {
    return value === pattern;
  }

  const [prefix, suffix] = pattern.split('*');
  if (prefix && !value.startsWith(prefix)) {
    return false;
  }
  if (suffix && !value.endsWith(suffix)) {
    return false;
  }
  return value.length >= prefix.length + suffix.length;
}

function toDate(seconds?: number): Date | undefined {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) {
    return undefined;
  }
  return new Date(seconds * 1000);
}

function buildAuthContext(token: string, payload: JWTPayload): AuthContext {
  const sub = typeof payload.sub === 'string' ? payload.sub : '';

  if (!sub) {
    throw new Error('Token missing subject (sub) claim');
  }

  return {
    token,
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    username: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    accountId: resolveAccountId(payload),
    roles: resolveRoles(payload),
    issuedAt: toDate(typeof payload.iat === 'number' ? payload.iat : undefined),
    expiresAt: toDate(typeof payload.exp === 'number' ? payload.exp : undefined),
    payload,
  };
}

function extractBearerToken(headerValue?: string): string | undefined {
  if (!headerValue) {
    return undefined;
  }

  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function buildAuthHook(): OnRequestHook {
  if (!config.auth.enabled) {
    throw new Error('Attempted to build auth hook while auth is disabled');
  }

  if (!remoteJwks) {
    throw new Error('JWKS client is not initialised');
  }

  return async function authHook(request: FastifyRequest, reply: FastifyReply) {
    // Skip auth for CORS preflight
    if (request.method?.toUpperCase() === 'OPTIONS') {
      return;
    }
    const rawPath = request.raw.url ? request.raw.url.split('?')[0] : '';
    const pathIsPublic = matchesAnyPattern(rawPath, request.method, publicPathPatterns);
    const pathAllowsAnonymous = matchesAnyPattern(rawPath, request.method, optionalAuthPathPatterns);

    const token = extractBearerToken(request.headers[AUTHORIZATION_HEADER] as string | undefined);

    if (!token) {
      if (pathIsPublic || pathAllowsAnonymous) {
        return;
      }
      request.log.warn({ path: rawPath }, 'Missing bearer token');
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    try {
      const rawAudience = config.auth.audience?.trim();
      const expectedAudience = rawAudience && rawAudience.includes(',')
        ? rawAudience
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : rawAudience;

      const { payload } = await jwtVerify(token, remoteJwks, {
        issuer: config.auth.issuer,
        audience: expectedAudience,
        algorithms: [...acceptedAlgorithms],
        clockTolerance: config.auth.clockSkewMs / 1000,
      });

      request.auth = buildAuthContext(token, payload);
      return;
    } catch (error) {
      request.log.warn({ err: error }, 'Failed to verify access token');
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  };
}

export function logAuthStartupDetails(): void {
  if (!config.auth.enabled) {
    logger.warn('Keycloak authentication is disabled; relying solely on IP whitelist');
    return;
  }

  logger.info(
    {
      issuer: config.auth.issuer,
      audience: config.auth.audience,
      publicPaths: publicPathPatterns,
      optionalAuthPaths: optionalAuthPathPatterns,
    },
    'Keycloak authentication enabled',
  );
}
