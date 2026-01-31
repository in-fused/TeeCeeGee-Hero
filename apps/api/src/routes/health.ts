import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'OK',
    timestamp: new Date().toISOString()
  }));
}
