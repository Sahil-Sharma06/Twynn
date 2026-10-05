// One-command local setup: env file, infrastructure, migrations.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example');
}

run('docker compose up -d --wait');
run('npm run db:migrate');
console.log('\nSetup complete. Start the app with: npm run dev');
