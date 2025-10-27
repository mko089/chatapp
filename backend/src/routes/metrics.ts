import type { FastifyInstance } from 'fastify';
import { getAllSessionsTotals, getGlobalTotals } from '../metrics/costTracker.js';
import { getGlobalUsageTotals, getUsageTotalsForAccount } from '../services/usageService.js';

export async function registerMetricsRoutes(app: FastifyInstance<any>) {
  app.get('/metrics/cost', async (request) => {
    const persistedGlobal = getGlobalUsageTotals();
    const accountId = request.auth?.accountId;
    const persistedAccount = accountId ? getUsageTotalsForAccount(accountId) : null;

    return {
      global: getGlobalTotals(),
      sessions: getAllSessionsTotals(),
      persisted: {
        global: {
          promptTokens: persistedGlobal.promptTokens,
          cachedPromptTokens: persistedGlobal.cachedPromptTokens,
          completionTokens: persistedGlobal.completionTokens,
          totalTokens: persistedGlobal.totalTokens,
          costUsd: persistedGlobal.costCents / 100,
        },
        account: persistedAccount
          ? {
              accountId,
              promptTokens: persistedAccount.promptTokens,
              cachedPromptTokens: persistedAccount.cachedPromptTokens,
              completionTokens: persistedAccount.completionTokens,
              totalTokens: persistedAccount.totalTokens,
              costUsd: persistedAccount.costCents / 100,
            }
          : null,
      },
    };
  });
}
