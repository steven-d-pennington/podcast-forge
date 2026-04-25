import { buildApp } from './app.js';

const app = buildApp({ logger: true });
const port = Number(process.env.PORT || 3450);
const host = process.env.HOST || '0.0.0.0';

await app.listen({ port, host });
