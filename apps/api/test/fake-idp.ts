/**
 * Minimal OpenID Provider for tests. It signs real RS256 ID tokens so that the
 * API's verification (signature, iss, aud, exp, nonce, PKCE) runs unmodified;
 * each code can be configured to produce a specific defect.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CryptoKey, JWK } from 'jose';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

export type CodeSpec = {
  subject: string;
  nonce: string;
  codeChallenge: string;
  email?: string;
  name?: string;
  issuer?: string;
  audience?: string;
  expiresInSeconds?: number;
  signWithForeignKey?: boolean;
};

export type FakeIdp = Readonly<{
  issuer: string;
  clientId: string;
  clientSecret: string;
  registerCode(code: string, spec: CodeSpec): void;
  close(): Promise<void>;
}>;

export async function startFakeIdp(): Promise<FakeIdp> {
  const clientId = 'ulysse-api-test';
  const clientSecret = 'test-client-secret-not-a-real-secret';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, CodeSpec>();
  let issuer = '';

  async function idToken(spec: CodeSpec): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const key: CryptoKey = spec.signWithForeignKey ? foreign.privateKey : privateKey;
    return new SignJWT({ nonce: spec.nonce, email: spec.email, name: spec.name })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(spec.issuer ?? issuer)
      .setAudience(spec.audience ?? clientId)
      .setSubject(spec.subject)
      .setIssuedAt(now - 5)
      .setExpirationTime(now + (spec.expiresInSeconds ?? 300))
      .sign(key);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      });
    }
    if (req.method === 'GET' && url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (req.method === 'POST' && url.pathname === '/token') {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        void (async () => {
          const form = new URLSearchParams(body);
          // RFC 6749 §2.3.1: client id and secret are form-urlencoded before Basic encoding.
          const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
          const [rawId = '', rawSecret = ''] = Buffer.from(basic, 'base64')
            .toString('utf8')
            .split(':');
          const decode = (v: string) => decodeURIComponent(v.replace(/\+/g, ' '));
          if (decode(rawId) !== clientId || decode(rawSecret) !== clientSecret)
            return json(401, { error: 'invalid_client' });
          const code = form.get('code') ?? '';
          const spec = codes.get(code);
          codes.delete(code);
          if (!spec || form.get('grant_type') !== 'authorization_code')
            return json(400, { error: 'invalid_grant' });
          const verifier = form.get('code_verifier') ?? '';
          const challenge = createHash('sha256').update(verifier).digest('base64url');
          if (challenge !== spec.codeChallenge)
            return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
          return json(200, {
            access_token: 'opaque-test-access-token',
            token_type: 'Bearer',
            expires_in: 300,
            id_token: await idToken(spec),
          });
        })();
      });
      return undefined;
    }
    return json(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return {
    issuer,
    clientId,
    clientSecret,
    registerCode: (code, spec) => codes.set(code, spec),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
