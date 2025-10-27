import 'fastify';
import type { AuthContext } from '../auth/context.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}
