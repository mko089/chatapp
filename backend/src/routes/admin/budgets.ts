import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { listBudgets, getBudget, upsertBudget, deleteBudget } from '../../services/budgetService.js';
import { evaluateBudgetsForContext } from '../../services/budgetEvaluator.js';
import { normalizeRoleName, resolveEffectivePermissions } from '../../rbac/index.js';
import { sendError } from '../../utils/errors.js';

const ScopeTypeSchema = z.enum(['account', 'role', 'user']);

const UpsertBudgetSchema = z.object({
  id: z.string().optional(),
  scopeType: ScopeTypeSchema,
  scopeId: z.string().min(1),
  period: z.enum(['monthly', 'daily', 'rolling_30d']).default('monthly'),
  currency: z.string().min(1).default('USD'),
  limitCents: z.number().int().nonnegative(),
  hardLimit: z.boolean().optional().default(false),
  resetDay: z.number().int().min(1).max(28).nullable().optional(),
});

const EvaluationQuerySchema = z.object({
  accountId: z.string().optional(),
  userId: z.string().optional(),
  role: z.string().optional(),
});

const ADMIN_ROLES = new Set(['owner', 'admin']);

function ensureAdmin(request: any) {
  const roles = request.auth?.roles ?? [];
  const normalized = roles.map((role: string) => normalizeRoleName(role));
  const hasTokenAdmin = normalized.some((role: string) => ADMIN_ROLES.has(role));
  if (hasTokenAdmin) {
    return;
  }

  // Fall back to effective RBAC resolution (supports env-based owner/admin mappings)
  const effective = resolveEffectivePermissions(request.auth);
  const hasEffectiveAdmin = effective.appliedRoles.some((role) => ADMIN_ROLES.has(role));
  if (!hasEffectiveAdmin) {
    throw request.httpErrors.forbidden('Insufficient permissions to manage budgets');
  }
}

export async function registerAdminBudgetsRoutes(app: FastifyInstance<any>) {
  app.get('/admin/budgets', async (request) => {
    ensureAdmin(request);
    const items = await listBudgets();
    return { items };
  });

  app.get('/admin/budgets/:scopeType/:scopeId', async (request, reply) => {
    ensureAdmin(request);
    const params = request.params as { scopeType: string; scopeId: string };
    const parse = ScopeTypeSchema.safeParse(params.scopeType);
    if (!parse.success) {
      return sendError(reply, 400, 'invalid_scope_type', 'Invalid scope type');
    }
    const budget = await getBudget(parse.data, params.scopeId);
    if (!budget) {
      return sendError(reply, 404, 'not_found', 'Budget not found');
    }
    return { budget };
  });

  app.post('/admin/budgets', async (request, reply) => {
    ensureAdmin(request);
    const body = UpsertBudgetSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(reply, 400, 'invalid_payload', 'Invalid payload', body.error.issues);
    }
    const record = await upsertBudget(body.data);
    return { budget: record };
  });

  app.delete('/admin/budgets/:scopeType/:scopeId', async (request, reply) => {
    ensureAdmin(request);
    const params = request.params as { scopeType: string; scopeId: string };
    const parse = ScopeTypeSchema.safeParse(params.scopeType);
    if (!parse.success) {
      return sendError(reply, 400, 'invalid_scope_type', 'Invalid scope type');
    }
    const removed = await deleteBudget(parse.data, params.scopeId);
    if (!removed) {
      return sendError(reply, 404, 'not_found', 'Budget not found');
    }
    return { ok: true };
  });

  app.get('/admin/budgets/evaluate', async (request, reply) => {
    ensureAdmin(request);
    const query = EvaluationQuerySchema.safeParse(request.query ?? {});
    if (!query.success) {
      return sendError(reply, 400, 'invalid_query', 'Invalid query parameters', query.error.issues);
    }
    const { accountId, userId, role } = query.data;
    const result = await evaluateBudgetsForContext({
      accountId: accountId ?? undefined,
      userId: userId ?? undefined,
      roles: role ? [role] : undefined,
    });
    return { result };
  });
}
