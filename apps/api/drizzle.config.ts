import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env.example' }); // Fallback to example for dev setup if .env is missing

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.TWYNN_DB_URL || 'postgres://twynn_user:twynn_password@localhost:5432/twynn',
  },
});
