import type { FastifyReply } from 'fastify';

export function sendError(
  reply: FastifyReply<any, any, any, any, any, any, any, any>,
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  reply.status(status);
  const payload: any = { error: message, code };
  if (details !== undefined) payload.details = details;
  return payload;
}
