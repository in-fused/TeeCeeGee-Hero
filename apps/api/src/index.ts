import Fastify from 'fastify';
import { healthRoutes } from './routes/health.js';
import { zipRoutes } from './routes/zip.js';

const app = Fastify({ logger: true });

app.register(healthRoutes);
app.register(zipRoutes);

app.listen({ port: 3000 }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`API listening at ${address}`);
});
