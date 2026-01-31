import Fastify from 'fastify';

const app = Fastify();

app.get('/health', async () => ({ status: 'OK' }));

app.listen({ port: 3000 });
