import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import pg from 'pg';
import { prepareDatabase } from './bootstrap.ts';
import { ConfigError } from './config.ts';

/**
 * Encrypted logical backups (pg_dump custom format, AES-256-GCM) and verified
 * restores into a new database. The file layout is MAGIC | IV (12) | ciphertext |
 * tag (16); the tag authenticates the whole dump, so a truncated or altered file
 * is refused before anything reaches pg_restore.
 */
const MAGIC = Buffer.from('ULYSBK01');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES;

export type BackupManifest = Readonly<{
  format: 'ulysse-backup/1';
  createdAt: string;
  database: string;
  serverVersion: string;
  keyFingerprint: string;
  cipherSha256: string;
  cipherBytes: number;
  migrations: ReadonlyArray<{ version: string; checksum: string }>;
  rowCounts: Readonly<Record<string, number>>;
}>;

/**
 * How PostgreSQL client tools are reached. `execPrefix` runs them inside the
 * database container (e.g. `docker compose ... exec -T postgres`) so their major
 * version matches the server; otherwise local binaries connect over TCP.
 */
export type PgTools = Readonly<{
  execPrefix: readonly string[];
  adminUrl: string;
}>;

/** The manifest is read back from disk: validate it instead of trusting its shape. */
export function parseManifest(value: unknown): BackupManifest {
  const fail = (): never => {
    throw new Error('invalid backup manifest');
  };
  if (typeof value !== 'object' || value === null) return fail();
  const m = value as Record<string, unknown>;
  if (m.format !== 'ulysse-backup/1') return fail();
  for (const key of ['createdAt', 'database', 'serverVersion', 'keyFingerprint', 'cipherSha256'])
    if (typeof m[key] !== 'string') fail();
  if (typeof m.cipherBytes !== 'number') fail();
  const migrations = Array.isArray(m.migrations) ? (m.migrations as unknown[]) : fail();
  for (const item of migrations) {
    const entry = (typeof item === 'object' && item !== null ? item : fail()) as Record<
      string,
      unknown
    >;
    if (typeof entry.version !== 'string' || typeof entry.checksum !== 'string') fail();
  }
  const counts = (
    typeof m.rowCounts === 'object' && m.rowCounts !== null ? m.rowCounts : fail()
  ) as Record<string, unknown>;
  for (const count of Object.values(counts))
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) fail();
  return value as BackupManifest;
}

export function parseBackupKey(value: string | undefined): Buffer {
  const key = Buffer.from(value ?? '', 'base64');
  if (key.length !== 32)
    throw new ConfigError('BACKUP_ENCRYPTION_KEY must be 32 random bytes encoded in base64');
  return key;
}

export const keyFingerprint = (key: Buffer): string =>
  createHash('sha256').update(key).digest('hex').slice(0, 16);

/** Encrypts a stream to `outPath`; returns the SHA-256 and size of the written file. */
export async function encryptToFile(
  input: AsyncIterable<Buffer>,
  outPath: string,
  key: Buffer,
): Promise<{ sha256: string; bytes: number }> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const hash = createHash('sha256');
  const file = await open(outPath, 'wx', 0o600);
  let bytes = 0;
  const write = async (chunk: Buffer) => {
    if (chunk.length === 0) return;
    hash.update(chunk);
    bytes += chunk.length;
    await file.write(chunk);
  };
  try {
    await write(Buffer.concat([MAGIC, iv]));
    for await (const chunk of input) await write(cipher.update(chunk));
    await write(cipher.final());
    await write(cipher.getAuthTag());
  } catch (error) {
    await file.close();
    await rm(outPath, { force: true });
    throw error;
  }
  await file.close();
  return { sha256: hash.digest('hex'), bytes };
}

/** Decrypts and authenticates `inPath` into `outPath`; the output is removed on failure. */
export async function decryptToFile(inPath: string, outPath: string, key: Buffer): Promise<void> {
  const { size } = await stat(inPath);
  if (size < HEADER_BYTES + TAG_BYTES) throw new Error('backup file is truncated');
  const handle = await open(inPath, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await handle.read(header, 0, HEADER_BYTES, 0);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not an Ulysse backup');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const out = await open(outPath, 'wx', 0o600);
  try {
    if (size > HEADER_BYTES + TAG_BYTES) {
      const body = createReadStream(inPath, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 });
      for await (const chunk of body as AsyncIterable<Buffer>)
        await out.write(decipher.update(chunk));
    }
    await out.write(decipher.final());
  } catch (error) {
    await out.close();
    await rm(outPath, { force: true });
    throw new Error('backup authentication failed (wrong key, truncated or altered file)', {
      cause: error,
    });
  }
  await out.close();
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk);
  return hash.digest('hex');
}

function pgToolArgs(tools: PgTools, tool: string, database: string, extra: string[]) {
  const url = new URL(tools.adminUrl);
  const user = decodeURIComponent(url.username);
  const connection =
    tools.execPrefix.length > 0
      ? ['-U', user, '-d', database]
      : ['-h', url.hostname, '-p', url.port || '5432', '-U', user, '-d', database];
  const [command, ...prefixArgs] = tools.execPrefix.length > 0 ? tools.execPrefix : [tool];
  const toolArgs = tools.execPrefix.length > 0 ? [...prefixArgs, tool] : prefixArgs;
  return {
    command: command ?? tool,
    args: [...toolArgs, ...connection, '--no-password', ...extra],
    env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  };
}

async function waitFor(
  child: ReturnType<typeof spawn>,
  label: string,
  stderr: string[],
): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0)
    throw new Error(`${label} exited with ${String(code)}: ${stderr.join('').slice(-2000)}`);
}

function collect(stream: Readable | null, into: string[]): void {
  stream?.on('data', (chunk: Buffer) => into.push(chunk.toString('utf8')));
}

const scopedUrl = (adminUrl: string, database: string): string => {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

async function inventory(client: pg.ClientBase): Promise<{
  migrations: Array<{ version: string; checksum: string }>;
  rowCounts: Record<string, number>;
}> {
  const migrations = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM public.schema_migrations ORDER BY version',
  );
  const tables = await client.query<{ schema: string; name: string }>(
    `SELECT table_schema AS schema, table_name AS name FROM information_schema.tables
      WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1, 2`,
  );
  const rowCounts: Record<string, number> = {};
  for (const t of tables.rows) {
    const qualified = `${client.escapeIdentifier(t.schema)}.${client.escapeIdentifier(t.name)}`;
    const count = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${qualified}`);
    rowCounts[`${t.schema}.${t.name}`] = Number(count.rows[0]?.n ?? 0);
  }
  return { migrations: migrations.rows, rowCounts };
}

/**
 * Dumps `database` with pg_dump inside an exported snapshot, so the row counts in
 * the manifest describe exactly the dumped state, and encrypts the dump.
 */
export async function backupDatabase(options: {
  tools: PgTools;
  database: string;
  outPath: string;
  key: Buffer;
  now?: Date;
}): Promise<BackupManifest> {
  const client = new pg.Client({
    connectionString: scopedUrl(options.tools.adminUrl, options.database),
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await client.query<{ id: string }>('SELECT pg_export_snapshot() AS id');
    const version = await client.query<{ v: string }>('SHOW server_version');
    const { migrations, rowCounts } = await inventory(client);
    const { command, args, env } = pgToolArgs(options.tools, 'pg_dump', options.database, [
      '--format=custom',
      `--snapshot=${snapshot.rows[0]?.id ?? ''}`,
    ]);
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr: string[] = [];
    collect(child.stderr, stderr);
    const [written] = await Promise.all([
      encryptToFile(child.stdout as AsyncIterable<Buffer>, options.outPath, options.key),
      waitFor(child, 'pg_dump', stderr),
    ]);
    await client.query('COMMIT');
    const manifest: BackupManifest = {
      format: 'ulysse-backup/1',
      createdAt: (options.now ?? new Date()).toISOString(),
      database: options.database,
      serverVersion: version.rows[0]?.v ?? 'unknown',
      keyFingerprint: keyFingerprint(options.key),
      cipherSha256: written.sha256,
      cipherBytes: written.bytes,
      migrations,
      rowCounts,
    };
    await writeFile(`${options.outPath}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return manifest;
  } catch (error) {
    await rm(options.outPath, { force: true });
    throw error;
  } finally {
    await client.end();
  }
}

export type RestoreReport = Readonly<{
  target: string;
  tables: number;
  rows: number;
  migrations: number;
  forcedRlsTables: number;
  appRoleSeesNoRowWithoutTenant: boolean | null;
}>;

/**
 * Restores an encrypted backup into a NEW database and verifies it: same
 * migrations and checksums, same row count per table as the dumped snapshot,
 * row-level security still forced on every tenant table, and (when the
 * application password is given) no row visible to the API role without a tenant.
 */
export async function restoreDatabase(options: {
  tools: PgTools;
  file: string;
  target: string;
  key: Buffer;
  workDir: string;
  appUrl?: string;
}): Promise<RestoreReport> {
  const manifest = parseManifest(
    JSON.parse(await readFile(`${options.file}.manifest.json`, 'utf8')) as unknown,
  );
  if (manifest.keyFingerprint !== keyFingerprint(options.key))
    throw new Error('this key did not encrypt the backup (fingerprint mismatch)');
  if ((await sha256File(options.file)) !== manifest.cipherSha256)
    throw new Error('backup file does not match its manifest checksum');

  const admin = new pg.Client({ connectionString: options.tools.adminUrl });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      options.target,
    ]);
    if (exists.rowCount) throw new Error(`target database ${options.target} already exists`);
  } finally {
    await admin.end();
  }

  const plain = `${options.workDir}/restore.dump`;
  await decryptToFile(options.file, plain, options.key);
  try {
    await prepareDatabase(options.tools.adminUrl, options.target);
    const { command, args, env } = pgToolArgs(options.tools, 'pg_restore', options.target, [
      '--exit-on-error',
      '--single-transaction',
    ]);
    const child = spawn(command, args, { env, stdio: ['pipe', 'ignore', 'pipe'] });
    const stderr: string[] = [];
    collect(child.stderr, stderr);
    const done = waitFor(child, 'pg_restore', stderr);
    const stdin = child.stdin;
    for await (const chunk of createReadStream(plain) as AsyncIterable<Buffer>)
      if (!stdin.write(chunk)) await new Promise((resolve) => stdin.once('drain', resolve));
    stdin.end();
    await done;
  } finally {
    await rm(plain, { force: true });
  }

  const restored = new pg.Client({
    connectionString: scopedUrl(options.tools.adminUrl, options.target),
  });
  await restored.connect();
  let report: RestoreReport;
  try {
    const { migrations, rowCounts } = await inventory(restored);
    if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations))
      throw new Error('restored migrations differ from the backup manifest');
    const expected = Object.entries(manifest.rowCounts);
    for (const [table, count] of expected)
      if (rowCounts[table] !== count)
        throw new Error(
          `row count mismatch on ${table}: ${String(rowCounts[table])} vs ${String(count)}`,
        );
    if (Object.keys(rowCounts).length !== expected.length)
      throw new Error('restored tables differ from the backup manifest');
    const rls = await restored.query<{ name: string; forced: boolean }>(
      `SELECT c.relname AS name, c.relrowsecurity AND c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)`,
    );
    const unprotected = rls.rows.filter((r) => !r.forced).map((r) => r.name);
    if (unprotected.length > 0)
      throw new Error(`row-level security not forced on: ${unprotected.join(', ')}`);
    report = {
      target: options.target,
      tables: expected.length,
      rows: expected.reduce((sum, [, n]) => sum + n, 0),
      migrations: migrations.length,
      forcedRlsTables: rls.rows.length,
      appRoleSeesNoRowWithoutTenant: null,
    };
  } finally {
    await restored.end();
  }
  if (options.appUrl) {
    const app = new pg.Client({ connectionString: scopedUrl(options.appUrl, options.target) });
    await app.connect();
    try {
      const visible = await app.query<{ n: string }>(
        'SELECT (SELECT count(*) FROM recommendations) + (SELECT count(*) FROM source_records) AS n',
      );
      const isolated = Number(visible.rows[0]?.n ?? -1) === 0;
      if (!isolated) throw new Error('the application role sees rows without a tenant context');
      report = { ...report, appRoleSeesNoRowWithoutTenant: true };
    } finally {
      await app.end();
    }
  }
  return report;
}
