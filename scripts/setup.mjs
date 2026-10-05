// One-command local setup: env file, infrastructure, migrations. Safe to re-run.
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

let env = existsSync('.env') ? readFileSync('.env', 'utf8') : readFileSync('.env.example', 'utf8');
if (!/^TWYNN_ENCRYPTION_KEY=\S+/m.test(env)) {
  const line = `TWYNN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`;
  env = /^TWYNN_ENCRYPTION_KEY=$/m.test(env)
    ? env.replace(/^TWYNN_ENCRYPTION_KEY=$/m, line)
    : `${env.trimEnd()}\n${line}\n`;
  writeFileSync('.env', env);
  console.log('Wrote .env with a fresh encryption key');
}

run('docker compose up -d --wait');
run('npm run db:migrate');
console.log('\nSetup complete. Start the app with: npm run dev');
