import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { pino } from 'pino';
import { correlationIdFrom, pathOnly, REDACT_PATHS } from '../src/index.ts';

test('query strings never reach request logs', () => {
  assert.equal(pathOnly('/auth/callback?code=abc&state=xyz'), '/auth/callback');
  assert.equal(pathOnly(undefined), '');
});

test('secrets and source content are redacted from structured logs', () => {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, sink);
  logger.info({ connection: { token: 'SECRET-TOKEN', payload: 'PRIVATE-EMAIL-BODY' }, req: { headers: { cookie: 'ulysse_session=abc' } } }, 'x');
  const output = lines.join('');
  assert.doesNotMatch(output, /SECRET-TOKEN|PRIVATE-EMAIL-BODY|ulysse_session=abc/);
});

test('correlation ids are accepted only when well-formed', () => {
  assert.equal(correlationIdFrom('abcdef12-correlation'), 'abcdef12-correlation');
  assert.notEqual(correlationIdFrom('<script>'), '<script>');
  assert.notEqual(correlationIdFrom(undefined), undefined);
});
