import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { AdminClient } from './admin.ts';
import { backupDatabase, parseBackupKey, restoreDatabase } from './backup.ts';
import { bootstrap, dropDatabase } from './bootstrap.ts';
import { databaseUrl, rolePasswords } from './config.ts';
import { migrate } from './migrate.ts';

const command = process.argv[2];
const { values: flags } = parseArgs({
  args: process.argv.slice(3),
  options: {
    database: { type: 'string' },
    out: { type: 'string', default: 'backups' },
    file: { type: 'string' },
    target: { type: 'string' },
    'drop-after': { type: 'boolean', default: false },
    slug: { type: 'string' },
    name: { type: 'string' },
    issuer: { type: 'string' },
    subject: { type: 'string' },
    email: { type: 'string' },
    tenant: { type: 'string' },
    user: { type: 'string' },
    role: { type: 'string' },
    status: { type: 'string' },
  },
});

const ROLES = ['owner', 'reviewer', 'viewer'] as const;
const pick = <T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T => {
  const match = allowed.find((a) => a === value);
  if (!match) throw new Error(`--${flag} must be one of ${allowed.join(', ')}`);
  return match;
};
const need = (value: string | undefined, flag: string): string => {
  if (!value) throw new Error(`--${flag} is required`);
  return value;
};

/** Operator commands through the definer functions of migration 0005 (migrator credentials). */
async function adminCommand(name: string): Promise<void> {
  const admin = await AdminClient.connect(databaseUrl('migrator'));
  try {
    if (name === 'admin:tenant') {
      const id = await admin.provisionTenant(need(flags.slug, 'slug'), need(flags.name, 'name'));
      console.warn(`tenant ${String(flags.slug)} → ${id}`);
    } else if (name === 'admin:user') {
      const id = await admin.provisionUser({
        issuer: need(flags.issuer, 'issuer'),
        subject: need(flags.subject, 'subject'),
        email: flags.email ?? null,
        displayName: need(flags.name, 'name'),
      });
      console.warn(`user ${String(flags.name)} → ${id}`);
    } else if (name === 'admin:member') {
      const status = flags.status === 'revoked' ? 'revoked' : 'active';
      await admin.setMembership(
        need(flags.tenant, 'tenant'),
        need(flags.user, 'user'),
        pick(flags.role, ROLES, 'role'),
        status,
      );
      console.warn(`membership ${status}: ${String(flags.role)}`);
    } else {
      await admin.setUserStatus(
        need(flags.user, 'user'),
        pick(flags.status, ['active', 'disabled'] as const, 'status'),
      );
      console.warn(`user status: ${String(flags.status)}`);
    }
  } finally {
    await admin.close();
  }
}
// Optional: run pg_dump/pg_restore inside the database container so versions match,
// e.g. ULYSSE_PG_EXEC="docker compose -f infra/compose.yaml --env-file infra/.env exec -T postgres".
const tools = () => ({
  execPrefix: (process.env.ULYSSE_PG_EXEC ?? '').split(' ').filter(Boolean),
  adminUrl: databaseUrl('admin'),
});

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
  if (!/^ulysse_(e2e|test_[a-z0-9_]+)$/.test(database))
    throw new Error('recreate is limited to ulysse_e2e or ulysse_test_* databases');
  await dropDatabase(databaseUrl('admin'), database);
  await bootstrap({ adminUrl: databaseUrl('admin'), database, passwords: rolePasswords() });
  const result = await migrate(databaseUrl('migrator'));
  console.warn(`recreate: ${database} ready (${String(result.applied.length)} migrations)`);
} else if (command === 'backup') {
  const database = flags.database ?? process.env.ULYSSE_DB_NAME ?? 'ulysse';
  const stamp = new Date()
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const outPath = path.resolve(flags.out, `${database}-${stamp}.dump.enc`);
  const manifest = await backupDatabase({
    tools: tools(),
    database,
    outPath,
    key: parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY),
  });
  const rows = Object.values(manifest.rowCounts).reduce((sum, n) => sum + n, 0);
  console.warn(
    `backup: ${outPath} (${String(manifest.cipherBytes)} bytes, ${String(Object.keys(manifest.rowCounts).length)} tables, ${String(rows)} rows, key ${manifest.keyFingerprint})`,
  );
} else if (command === 'restore') {
  if (!flags.file || !flags.target) throw new Error('restore requires --file and --target');
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'ulysse-restore-'));
  try {
    const report = await restoreDatabase({
      tools: tools(),
      file: path.resolve(flags.file),
      target: flags.target,
      key: parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY),
      workDir,
      ...(process.env.ULYSSE_DB_APP_PASSWORD ? { appUrl: databaseUrl('app') } : {}),
    });
    console.warn(`restore: verified ${JSON.stringify(report)}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
    // Drills only: dropDatabase refuses anything but ulysse_e2e / ulysse_test_* names.
    if (flags['drop-after']) await dropDatabase(databaseUrl('admin'), flags.target);
  }
} else if (
  command === 'admin:tenant' ||
  command === 'admin:user' ||
  command === 'admin:member' ||
  command === 'admin:user-status'
) {
  await adminCommand(command);
} else {
  console.error(
    [
      'usage: cli.ts bootstrap | migrate | recreate',
      '  backup [--database d] [--out dir] | restore --file f --target db [--drop-after]',
      '  admin:tenant --slug s --name n | admin:user --issuer i --subject s --name n [--email e]',
      '  admin:member --tenant id --user id --role owner|reviewer|viewer [--status revoked]',
      '  admin:user-status --user id --status active|disabled',
    ].join('\n'),
  );
  process.exitCode = 2;
}
