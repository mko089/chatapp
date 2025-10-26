import type { FastifyInstance } from 'fastify';
import { getAllSessionsTotals, getGlobalTotals } from '../metrics/costTracker.js';

export async function registerMetricsRoutes(app: FastifyInstance<any>) {
  app.get('/metrics/cost', async () => {
    return {
      global: getGlobalTotals(),
      sessions: getAllSessionsTotals(),
    };
  });
}
