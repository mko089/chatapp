import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadEnv();

const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
const defaultAppEnv = process.env.APP_ENV ?? (isProd ? 'production' : 'development');
// Secure default: always use a whitelist, also in development
const defaultAllowedIps = '192.168.2.145,192.168.4.170';
const allowedIpsFromEnv = (process.env.ALLOWED_IPS ?? defaultAllowedIps)
  .split(',')
  .map((ip) => ip.trim())
  .filter((ip) => ip.length > 0);

const keycloakIssuerFromEnv =
  process.env.KEYCLOAK_ISSUER ??
  (process.env.KEYCLOAK_URL && process.env.KEYCLOAK_REALM
    ? `${process.env.KEYCLOAK_URL.replace(/\/$/, '')}/realms/${process.env.KEYCLOAK_REALM}`
    : undefined);

const keycloakAudienceFromEnv = process.env.KEYCLOAK_AUDIENCE ?? process.env.KEYCLOAK_CLIENT_ID ?? undefined;

const keycloakEnabledFromEnv =
  process.env.KEYCLOAK_ENABLED !== undefined
    ? process.env.KEYCLOAK_ENABLED !== 'false'
    : Boolean(keycloakIssuerFromEnv);

function parseEnvList(raw: string | undefined): string[] {
  const unique = new Set<string>();
  if (!raw) {
    return [];
  }
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }
  return [...unique];
}

const authPublicPathsFromEnv = parseEnvList(process.env.AUTH_PUBLIC_PATHS);
const authOptionalPathsFromEnv = parseEnvList(process.env.AUTH_OPTIONAL_PATHS);
const defaultPublicAuthPaths = ['GET /health'];

const defaultRolesPath = process.env.KEYCLOAK_ROLES_PATH ?? 'realm_access.roles';
const defaultAccountClaim = process.env.KEYCLOAK_ACCOUNT_CLAIM ?? 'accountId';

const jwksCacheMsFromEnv = process.env.KEYCLOAK_JWKS_CACHE_MS
  ? Number.parseInt(process.env.KEYCLOAK_JWKS_CACHE_MS, 10)
  : 600_000;

const clockSkewMsFromEnv = process.env.KEYCLOAK_CLOCK_SKEW_MS
  ? Number.parseInt(process.env.KEYCLOAK_CLOCK_SKEW_MS, 10)
  : 5_000;

const rbacEnabledFromEnv =
  process.env.RBAC_ENABLED !== undefined ? process.env.RBAC_ENABLED !== 'false' : true;

const rbacDefaultRolesFromEnv = (process.env.RBAC_DEFAULT_ROLES ?? 'viewer')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const rbacFallbackRolesFromEnv = (process.env.RBAC_FALLBACK_ROLES ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

const rbacUnauthenticatedBehaviourFromEnv =
  process.env.RBAC_UNAUTHENTICATED_MODE?.toLowerCase() ?? 'default';

const llmModelsFromEnv = (process.env.LLM_MODELS ?? '')
  .split(',')
  .map((model) => model.trim())
  .filter((model) => model.length > 0);

const DEFAULT_ALLOWED_MODELS = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1-nano'];

const ConfigSchema = z.object({
  nodeEnv: z.string().optional().default(process.env.NODE_ENV ?? 'development'),
  appEnv: z.string().optional().default(defaultAppEnv),
  port: z.coerce.number().int().positive().default(4025),
  logLevel: z
    .string()
    .optional()
    .default(process.env.LOG_LEVEL ?? 'info'),
  openAiApiKey: z.string().min(1, 'OPENAI_API_KEY is required'),
  llmModel: z.string().optional().default(process.env.LLM_MODEL ?? 'gpt-4.1'),
  requestTimeoutMs: z.coerce.number().int().positive().optional().default(20000),
  // Toggle registration of streaming chat route (/chat/stream)
  chatStreamingEnabled: z
    .boolean()
    .optional()
    .default(
      process.env.CHAT_STREAM_ENABLED !== undefined
        ? process.env.CHAT_STREAM_ENABLED !== 'false'
        : false,
    ),
  mcpConfigPath: z
    .string()
    .optional()
    .default(process.env.MCP_CONFIG ?? path.resolve('backend/mcp.config.json')),
  databasePath: z
    .string()
    .optional()
    .default(process.env.DATABASE_FILE ?? path.resolve('backend/data/chatapp.sqlite')),
  allowedIps: z.array(z.string().min(1)).default(allowedIpsFromEnv.length ? allowedIpsFromEnv : ['192.168.2.145']),
  chatMaxIterations: z
    .coerce.number()
    .int()
    .positive()
    .max(12)
    .optional()
    .default(process.env.CHAT_MAX_ITERATIONS ? Number.parseInt(process.env.CHAT_MAX_ITERATIONS, 10) : 6),
  // Controls whether backend applies heuristics to infer/normalize tool arguments
  // like timeframes (from/to), default locations, tz, etc. When false, full
  // control of arguments stays with the model/user messages.
  chatInferArgsEnabled: z
    .boolean()
    .optional()
    .default(
      process.env.CHAT_INFER_ARGS_ENABLED !== undefined
        ? process.env.CHAT_INFER_ARGS_ENABLED !== 'false'
        : false,
    ),
  promptTokenCostUsd: z
    .coerce.number()
    .nonnegative()
    .optional()
    .default(process.env.PROMPT_TOKEN_COST_USD ? Number.parseFloat(process.env.PROMPT_TOKEN_COST_USD) : 0.0),
  completionTokenCostUsd: z
    .coerce.number()
    .nonnegative()
    .optional()
    .default(process.env.COMPLETION_TOKEN_COST_USD ? Number.parseFloat(process.env.COMPLETION_TOKEN_COST_USD) : 0.0),
  // Enable recording LLM request/response traces for debugging (stored in DB)
  llmTraceEnabled: z
    .boolean()
    .optional()
    .default(
      process.env.LLM_TRACE_ENABLED !== undefined
        ? process.env.LLM_TRACE_ENABLED !== 'false'
        : false,
    ),
  llmAllowedModels: z
    .array(z.string().min(1))
    .default(llmModelsFromEnv.length ? llmModelsFromEnv : DEFAULT_ALLOWED_MODELS),
  auth: z
    .object({
      enabled: z.boolean(),
      issuer: z.string().optional(),
      audience: z.string().optional(),
      clientId: z.string().optional(),
      rolesPath: z.string(),
      accountClaim: z.string(),
      jwksCacheMs: z.number().int().positive(),
      clockSkewMs: z.number().int().nonnegative(),
      publicPaths: z.array(z.string()),
      optionalAuthPaths: z.array(z.string()),
    })
    .superRefine((value, ctx) => {
      if (!value.enabled) {
        return;
      }

      if (!value.issuer || value.issuer.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'KEYCLOAK_ISSUER (or KEYCLOAK_URL + KEYCLOAK_REALM) is required when auth is enabled',
        });
      }

      if (!value.audience || value.audience.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'KEYCLOAK_AUDIENCE or KEYCLOAK_CLIENT_ID is required when auth is enabled',
        });
      }

      const forbidden = value.publicPaths.filter((pattern) => pattern.toLowerCase().includes('/sessions'));
      if (forbidden.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `AUTH_PUBLIC_PATHS contains sensitive entries (${forbidden.join(', ')}). Sesje wymagają uwierzytelnienia.`,
        });
      }
    }),
  rbac: z
    .object({
      enabled: z.boolean(),
      defaultRoles: z.array(z.string().min(1)).nonempty(),
      fallbackRoles: z.array(z.string().min(1)).optional(),
      unauthenticatedMode: z.enum(['default', 'deny', 'allow']),
      ownerUsers: z.array(z.string().min(1)).optional().default([]),
      adminUsers: z.array(z.string().min(1)).optional().default([]),
    })
    .superRefine((value, ctx) => {
      if (!value.enabled) {
        return;
      }
      if (value.unauthenticatedMode === 'deny' && !value.defaultRoles.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'RBAC_DEFAULT_ROLES must define at least one role when RBAC is enabled' });
      }
    }),
});

const parsed = ConfigSchema.parse({
  nodeEnv: process.env.NODE_ENV,
  appEnv: process.env.APP_ENV,
  port: process.env.PORT,
  logLevel: process.env.LOG_LEVEL,
  openAiApiKey: process.env.OPENAI_API_KEY,
  llmModel: process.env.LLM_MODEL,
  requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
  chatStreamingEnabled:
    process.env.CHAT_STREAM_ENABLED !== undefined
      ? process.env.CHAT_STREAM_ENABLED !== 'false'
      : undefined,
  mcpConfigPath: process.env.MCP_CONFIG,
  databasePath: process.env.DATABASE_FILE,
  allowedIps: allowedIpsFromEnv,
  chatMaxIterations: process.env.CHAT_MAX_ITERATIONS,
  chatInferArgsEnabled:
    process.env.CHAT_INFER_ARGS_ENABLED !== undefined
      ? process.env.CHAT_INFER_ARGS_ENABLED !== 'false'
      : undefined,
  promptTokenCostUsd: process.env.PROMPT_TOKEN_COST_USD,
  completionTokenCostUsd: process.env.COMPLETION_TOKEN_COST_USD,
  llmTraceEnabled:
    process.env.LLM_TRACE_ENABLED !== undefined
      ? process.env.LLM_TRACE_ENABLED !== 'false'
      : undefined,
  llmAllowedModels: llmModelsFromEnv.length ? llmModelsFromEnv : undefined,
  auth: {
    enabled: keycloakEnabledFromEnv,
    issuer: keycloakIssuerFromEnv,
    audience: keycloakAudienceFromEnv,
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    rolesPath: defaultRolesPath,
    accountClaim: defaultAccountClaim,
    jwksCacheMs: Number.isFinite(jwksCacheMsFromEnv) ? jwksCacheMsFromEnv : 600_000,
    clockSkewMs: Number.isFinite(clockSkewMsFromEnv) ? clockSkewMsFromEnv : 5_000,
    publicPaths: authPublicPathsFromEnv.length ? authPublicPathsFromEnv : defaultPublicAuthPaths,
    optionalAuthPaths: authOptionalPathsFromEnv,
  },
  rbac: {
    enabled: rbacEnabledFromEnv,
    defaultRoles: rbacDefaultRolesFromEnv.length ? rbacDefaultRolesFromEnv : ['viewer'],
    fallbackRoles: rbacFallbackRolesFromEnv.length ? rbacFallbackRolesFromEnv : undefined,
    unauthenticatedMode:
      rbacUnauthenticatedBehaviourFromEnv === 'allow'
        ? 'allow'
        : rbacUnauthenticatedBehaviourFromEnv === 'deny'
          ? 'deny'
          : 'default',
    ownerUsers: (process.env.RBAC_OWNER_USERS ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
    adminUsers: (process.env.RBAC_ADMIN_USERS ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  },
});

if (!parsed.llmAllowedModels.includes(parsed.llmModel)) {
  parsed.llmAllowedModels = [...parsed.llmAllowedModels, parsed.llmModel];
}

export type AppConfig = typeof parsed;

export const config: AppConfig = parsed;
