import { bootstrap } from './bootstrap.ts';
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
} else {
  console.error('usage: cli.ts bootstrap|migrate');
  process.exitCode = 2;
}
