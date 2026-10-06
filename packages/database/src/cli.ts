import { bootstrap, dropDatabase } from './bootstrap.ts';
import { databaseUrl, rolePasswords } from './config.ts';
import { migrate } from './migrate.ts';

const command = process.argv[2];

if (command === 'bootstrap') {
  const database = process.env.ULYSSE_DB_NAME ?? 'ulysse';
  await bootstrap({ adminUrl: databaseUrl('admin'), database, passwords: rolePasswords() });
  console.warn(`bootstrap: roles and database "${database}" are ready`);
} else if (command === 'migrate') {
  const result = await migrate(databaseUrl('migrator'));
  console.warn(
    `migrate: applied ${result.applied.length} (${result.applied.join(', ') || 'none'}), already applied ${result.alreadyApplied.length}; job queues installed`,
  );
} else if (command === 'recreate') {
  // Disposable databases only (end-to-end runs): drop, bootstrap and migrate from scratch.
  const database = process.env.ULYSSE_DB_NAME ?? '';
  if (!/^ulysse_(e2e|test_[a-z0-9_]+)$/.test(database)) throw new Error('recreate is limited to ulysse_e2e or ulysse_test_* databases');
  await dropDatabase(databaseUrl('admin'), database);
  await bootstrap({ adminUrl: databaseUrl('admin'), database, passwords: rolePasswords() });
  const result = await migrate(databaseUrl('migrator'));
  console.warn(`recreate: ${database} ready (${String(result.applied.length)} migrations)`);
} else {
  console.error('usage: cli.ts bootstrap|migrate|recreate');
  process.exitCode = 2;
}
