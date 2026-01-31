import { FastifyInstance } from 'fastify';

export async function zipRoutes(app: FastifyInstance) {
  app.get('/zip/lookup/:zip', async (req, reply) => {
    return {
      status: 'NO_DATA_AVAILABLE',
      reason: 'ZIP centroid dataset not yet ingested',
      source: 'census_zip_data',
      timestamp: new Date().toISOString()
    };
  });
}
