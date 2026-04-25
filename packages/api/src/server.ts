import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true, service: 'podcast-forge-api' }));

app.listen({ port: Number(process.env.PORT || 3450), host: '0.0.0.0' });
