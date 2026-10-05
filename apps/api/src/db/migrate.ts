import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../../.env.example') });

const pool = new Pool({
  connectionString: process.env.TWYNN_DB_URL || 'postgres://twynn_user:twynn_password@localhost:5432/twynn',
});

const db = drizzle(pool);

async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: path.join(__dirname, '../../drizzle') });
  console.log('Migrations complete!');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
