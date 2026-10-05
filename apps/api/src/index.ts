import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { PRODUCT_NAME } from '@twynn/shared';

const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: 'ok', product: PRODUCT_NAME });
});

const port = process.env.TWYNN_API_PORT ? parseInt(process.env.TWYNN_API_PORT, 10) : 3000;

console.log(`Starting ${PRODUCT_NAME} API on port ${port}...`);

serve({
  fetch: app.fetch,
  port
});
