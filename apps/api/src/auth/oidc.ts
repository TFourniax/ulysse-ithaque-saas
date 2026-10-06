import * as client from 'openid-client';

export type VerifiedIdentity = Readonly<{
  issuer: string;
  subject: string;
  email: string | null;
  displayName: string | null;
}>;

export type AuthorizationChecks = Readonly<{ state: string; nonce: string; codeVerifier: string }>;

/** Minimal OIDC surface used by the API; implemented with openid-client. */
export interface OidcProvider {
  readonly issuer: string;
  authorizationUrl(input: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): URL;
  /** Exchanges the code and verifies the ID token (signature, iss, aud, exp, iat, nonce). */
  exchange(callbackUrl: URL, checks: AuthorizationChecks): Promise<VerifiedIdentity>;
  endSessionUrl(postLogoutRedirectUri: string): URL | null;
}

export class OidcError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OidcError';
  }
}

/**
 * Split-horizon support: the browser reaches the identity provider on its public
 * origin, while a containerized API may need an internal address for back-channel
 * calls (discovery, JWKS, token). The issuer identifier stays the public one.
 */
function backChannelFetch(
  issuer: string,
  internalBaseUrl: string | undefined,
): client.CustomFetch | undefined {
  if (!internalBaseUrl) return undefined;
  const publicOrigin = new URL(issuer).origin;
  const internal = new URL(internalBaseUrl);
  return (url, init) => {
    const target = new URL(url);
    if (target.origin === publicOrigin) {
      target.protocol = internal.protocol;
      target.host = internal.host;
    }
    return fetch(target, init);
  };
}

export async function createOidcProvider(options: {
  issuer: string;
  clientId: string;
  clientSecret: string;
  allowInsecureHttp: boolean;
  internalBaseUrl?: string;
}): Promise<OidcProvider> {
  const customFetch = backChannelFetch(options.issuer, options.internalBaseUrl);
  const config = await client.discovery(
    new URL(options.issuer),
    options.clientId,
    { client_secret: options.clientSecret, id_token_signed_response_alg: 'RS256' },
    client.ClientSecretBasic(options.clientSecret),
    {
      // Always verify ID token signatures against the issuer JWKS. openid-client otherwise relies on
      // TLS for tokens received from the token endpoint, which is not enough for our threat model
      // (and provides nothing over plain HTTP in development).
      execute: [
        client.enableNonRepudiationChecks,
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- development identity provider over HTTP only; refused in production (config.ts)
        ...(options.allowInsecureHttp ? [client.allowInsecureRequests] : []),
      ],
      timeout: 10,
      ...(customFetch ? { [client.customFetch]: customFetch } : {}),
    },
  );
  if (customFetch) config[client.customFetch] = customFetch;
  const issuer = config.serverMetadata().issuer;
  return {
    issuer,
    authorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
      return client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        response_type: 'code',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });
    },
    async exchange(callbackUrl, checks) {
      try {
        const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
          pkceCodeVerifier: checks.codeVerifier,
          expectedState: checks.state,
          expectedNonce: checks.nonce,
          idTokenExpected: true,
        });
        const claims = tokens.claims();
        if (!claims) throw new OidcError('missing id_token claims');
        const name =
          typeof claims.name === 'string'
            ? claims.name
            : typeof claims.preferred_username === 'string'
              ? claims.preferred_username
              : null;
        return {
          issuer: claims.iss,
          subject: claims.sub,
          email: typeof claims.email === 'string' ? claims.email : null,
          displayName: name,
        };
      } catch (error) {
        if (error instanceof OidcError) throw error;
        throw new OidcError('authorization code exchange or ID token validation failed', {
          cause: error,
        });
      }
    },
    endSessionUrl(postLogoutRedirectUri) {
      if (!config.serverMetadata().end_session_endpoint) return null;
      return client.buildEndSessionUrl(config, {
        client_id: options.clientId,
        post_logout_redirect_uri: postLogoutRedirectUri,
      });
    },
  };
}

export const randomState = client.randomState;
export const randomNonce = client.randomNonce;
export const randomPKCECodeVerifier = client.randomPKCECodeVerifier;
export const calculatePKCECodeChallenge = client.calculatePKCECodeChallenge;
