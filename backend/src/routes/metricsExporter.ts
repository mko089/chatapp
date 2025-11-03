import type { FastifyInstance } from 'fastify';
import { renderPrometheus } from '../metrics/prometheus.js';

export async function registerPrometheusMetricsRoute(app: FastifyInstance<any>) {
  app.get('/metrics', async (request, reply) => {
    const body = renderPrometheus();
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.send(body);
  });
}

