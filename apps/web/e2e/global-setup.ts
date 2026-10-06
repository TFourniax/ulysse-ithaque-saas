import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recreates and seeds the disposable e2e database (fictional data only). */
export default function globalSetup(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const env = { ...process.env, ULYSSE_DB_NAME: 'ulysse_e2e' };
  execSync('npm run db:recreate -w @ulysse/database', { cwd: root, env, stdio: 'inherit' });
  execSync('npm run db:seed', { cwd: root, env, stdio: 'inherit' });
}
