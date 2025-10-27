import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

loadEnv();

const allowedIpsFromEnv = (process.env.ALLOWED_IPS ?? '192.168.2.145,192.168.4.170')
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

const authPublicPathsFromEnv = (process.env.AUTH_PUBLIC_PATHS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

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
  port: z.coerce.number().int().positive().default(4025),
  logLevel: z
    .string()
    .optional()
    .default(process.env.LOG_LEVEL ?? 'info'),
  openAiApiKey: z.string().min(1, 'OPENAI_API_KEY is required'),
  llmModel: z.string().optional().default(process.env.LLM_MODEL ?? 'gpt-4.1'),
  requestTimeoutMs: z.coerce.number().int().positive().optional().default(20000),
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
  port: process.env.PORT,
  logLevel: process.env.LOG_LEVEL,
  openAiApiKey: process.env.OPENAI_API_KEY,
  llmModel: process.env.LLM_MODEL,
  requestTimeoutMs: process.env.REQUEST_TIMEOUT_MS,
  mcpConfigPath: process.env.MCP_CONFIG,
  databasePath: process.env.DATABASE_FILE,
  allowedIps: allowedIpsFromEnv,
  chatMaxIterations: process.env.CHAT_MAX_ITERATIONS,
  promptTokenCostUsd: process.env.PROMPT_TOKEN_COST_USD,
  completionTokenCostUsd: process.env.COMPLETION_TOKEN_COST_USD,
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
    publicPaths: authPublicPathsFromEnv,
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
