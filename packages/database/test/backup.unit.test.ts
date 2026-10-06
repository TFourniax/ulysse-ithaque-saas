import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  decryptToFile,
  encryptToFile,
  keyFingerprint,
  parseBackupKey,
  parseManifest,
} from '../src/backup.ts';

const dir = await mkdtemp(path.join(os.tmpdir(), 'ulysse-backup-test-'));
after(() => rm(dir, { recursive: true, force: true }));

async function* chunks(...parts: string[]) {
  for (const part of parts) yield Buffer.from(part);
}

test('backups round-trip and are authenticated', async () => {
  const key = randomBytes(32);
  const encrypted = path.join(dir, 'a.enc');
  const written = await encryptToFile(chunks('PGDMP', ' fictional ', 'payload'), encrypted, key);
  assert.equal(written.bytes, 8 + 12 + 'PGDMP fictional payload'.length + 16);
  assert.ok(!(await readFile(encrypted)).includes('fictional'), 'no plaintext in the file');

  await decryptToFile(encrypted, path.join(dir, 'a.out'), key);
  assert.equal(await readFile(path.join(dir, 'a.out'), 'utf8'), 'PGDMP fictional payload');

  await assert.rejects(
    decryptToFile(encrypted, path.join(dir, 'b.out'), randomBytes(32)),
    /authentication failed/,
  );
  const altered = await readFile(encrypted);
  altered[25] = (altered[25] ?? 0) ^ 1;
  await writeFile(path.join(dir, 'altered.enc'), altered);
  await assert.rejects(
    decryptToFile(path.join(dir, 'altered.enc'), path.join(dir, 'c.out'), key),
    /authentication failed/,
  );
  await assert.rejects(readFile(path.join(dir, 'c.out')), 'no partial output is left behind');
  await writeFile(path.join(dir, 'short.enc'), altered.subarray(0, altered.length - 5));
  await assert.rejects(
    decryptToFile(path.join(dir, 'short.enc'), path.join(dir, 'd.out'), key),
    /authentication failed/,
  );
});

test('backup keys are 32 bytes and identified by a fingerprint, never printed', () => {
  assert.throws(() => parseBackupKey(undefined), /32 random bytes/);
  assert.throws(() => parseBackupKey(Buffer.alloc(16).toString('base64')), /32 random bytes/);
  const key = parseBackupKey(Buffer.alloc(32, 7).toString('base64'));
  assert.match(keyFingerprint(key), /^[0-9a-f]{16}$/);
});

test('a manifest read back from disk is validated before use', () => {
  const valid = {
    format: 'ulysse-backup/1',
    createdAt: '2026-10-06T00:00:00.000Z',
    database: 'ulysse',
    serverVersion: '18.6',
    keyFingerprint: '0123456789abcdef',
    cipherSha256: 'ab',
    cipherBytes: 10,
    migrations: [{ version: '0001_x.sql', checksum: 'c' }],
    rowCounts: { 'public.tenants': 2 },
  };
  assert.equal(parseManifest(valid).database, 'ulysse');
  for (const broken of [
    null,
    { ...valid, format: 'other' },
    { ...valid, cipherBytes: '10' },
    { ...valid, migrations: [{ version: 1 }] },
    { ...valid, rowCounts: { 'public.tenants': -1 } },
  ])
    assert.throws(() => parseManifest(broken), /invalid backup manifest/);
});
