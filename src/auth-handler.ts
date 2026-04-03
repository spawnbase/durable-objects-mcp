// Adapted from https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access

import { Buffer } from 'node:buffer'
import { env } from 'cloudflare:workers'
import type {
  AuthRequest,
  GrantType,
  OAuthHelpers,
  TokenExchangeCallbackOptions,
  TokenExchangeCallbackResult,
} from '@cloudflare/workers-oauth-provider'

import {
  addApprovedClient,
  createOAuthState,
  fetchUpstreamAuthToken,
  generateCSRFProtection,
  getUpstreamAuthorizeUrl,
  isClientApproved,
  OAuthError,
  type Props,
  refreshUpstreamToken,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from './oauth-utils'

type EnvWithOauth = Env & { OAUTH_PROVIDER: OAuthHelpers }

function cfAccessUrls(team: string, clientId: string) {
  const base = `https://${team}.cloudflareaccess.com/cdn-cgi/access/sso/oidc/${clientId}`
  return {
    authorization: `${base}/authorization`,
    token: `${base}/token`,
    jwks: `${base}/jwks`,
  }
}

export default {
  async fetch(request: Request, env: EnvWithOauth): Promise<Response> {
    const { pathname, searchParams } = new URL(request.url)
    const urls = cfAccessUrls(env.ACCESS_TEAM, env.ACCESS_CLIENT_ID)

    // GET /authorize — show approval dialog or redirect to CF Access
    if (request.method === 'GET' && pathname === '/authorize') {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request)
      if (!oauthReqInfo.clientId) {
        return new Response('Invalid request', { status: 400 })
      }

      // Skip approval if client already approved
      if (
        await isClientApproved(
          request,
          oauthReqInfo.clientId,
          env.COOKIE_ENCRYPTION_KEY,
        )
      ) {
        const { stateToken } = await createOAuthState(
          oauthReqInfo,
          env.OAUTH_KV,
        )
        return redirectToAccess(request, env, urls, stateToken)
      }

      const { token: csrfToken, setCookie } = generateCSRFProtection()
      return renderApprovalDialog(request, {
        client: await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId),
        csrfToken,
        server: {
          name: 'Durable Objects MCP',
          description:
            'Read-only SQL access to Cloudflare Durable Object storage.',
        },
        setCookie,
        state: { oauthReqInfo },
      })
    }

    // POST /authorize — validate CSRF, approve client, redirect to CF Access
    if (request.method === 'POST' && pathname === '/authorize') {
      try {
        const formData = await request.formData()
        validateCSRFToken(formData, request)

        const encodedState = formData.get('state')
        if (!encodedState || typeof encodedState !== 'string') {
          return new Response('Missing state in form data', { status: 400 })
        }

        let state: { oauthReqInfo?: AuthRequest }
        try {
          state = JSON.parse(atob(encodedState))
        } catch {
          return new Response('Invalid state data', { status: 400 })
        }

        if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
          return new Response('Invalid request', { status: 400 })
        }

        const approvedClientCookie = await addApprovedClient(
          request,
          state.oauthReqInfo.clientId,
          env.COOKIE_ENCRYPTION_KEY,
        )

        const { stateToken } = await createOAuthState(
          state.oauthReqInfo,
          env.OAUTH_KV,
        )

        return redirectToAccess(request, env, urls, stateToken, {
          'Set-Cookie': approvedClientCookie,
        })
      } catch (error) {
        if (error instanceof OAuthError) {
          return error.toResponse()
        }
        return new Response('Internal server error', { status: 500 })
      }
    }

    // GET /callback — exchange code for token, verify JWT, complete auth
    if (request.method === 'GET' && pathname === '/callback') {
      let oauthReqInfo: AuthRequest

      try {
        const result = await validateOAuthState(request, env.OAUTH_KV)
        oauthReqInfo = result.oauthReqInfo
      } catch (error) {
        if (error instanceof OAuthError) {
          return error.toResponse()
        }
        return new Response('Internal server error', { status: 500 })
      }

      if (!oauthReqInfo.clientId) {
        return new Response('Invalid OAuth request data', { status: 400 })
      }

      const [tokens, errResponse] = await fetchUpstreamAuthToken({
        client_id: env.ACCESS_CLIENT_ID,
        client_secret: env.ACCESS_CLIENT_SECRET,
        code: searchParams.get('code') ?? undefined,
        redirect_uri: new URL('/callback', request.url).href,
        upstream_url: urls.token,
      })
      if (errResponse) {
        return errResponse
      }

      const claims = await verifyToken(urls.jwks, tokens.idToken, {
        audience: env.ACCESS_CLIENT_ID,
        issuer: `https://${env.ACCESS_TEAM}.cloudflareaccess.com`,
      })

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: claims.sub,
        metadata: { label: claims.name ?? claims.email },
        scope: oauthReqInfo.scope,
        props: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          email: claims.email,
          login: claims.sub,
          name: claims.name,
        } satisfies Props,
      })

      return Response.redirect(redirectTo, 302)
    }

    return new Response('Not Found', { status: 404 })
  },
}

function redirectToAccess(
  request: Request,
  env: Env,
  urls: { authorization: string },
  stateToken: string,
  headers: Record<string, string> = {},
) {
  return new Response(null, {
    status: 302,
    headers: {
      ...headers,
      location: getUpstreamAuthorizeUrl({
        client_id: env.ACCESS_CLIENT_ID,
        redirect_uri: new URL('/callback', request.url).href,
        scope: 'openid email profile',
        state: stateToken,
        upstream_url: urls.authorization,
      }),
    },
  })
}

async function fetchAccessPublicKey(jwksUrl: string, kid: string) {
  const resp = await fetch(jwksUrl)
  const keys = (await resp.json()) as {
    keys: (JsonWebKey & { kid: string })[]
  }
  const jwk = keys.keys.find((key) => key.kid === kid)
  if (!jwk) throw new Error(`Key ${kid} not found in JWKS`)
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' },
    false,
    ['verify'],
  )
}

function parseJWT(token: string) {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT')
  return {
    data: `${parts[0]}.${parts[1]}`,
    header: JSON.parse(Buffer.from(parts[0], 'base64url').toString()),
    payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString()),
    signature: parts[2],
  }
}

async function verifyToken(
  jwksUrl: string,
  token: string,
  expected: { audience: string; issuer: string },
): Promise<{ sub: string; email: string; name: string; exp: number }> {
  const jwt = parseJWT(token)

  if (jwt.header.alg !== 'RS256') {
    throw new Error(`Unexpected JWT algorithm: ${jwt.header.alg}`)
  }

  const key = await fetchAccessPublicKey(jwksUrl, jwt.header.kid)

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    Buffer.from(jwt.signature, 'base64url'),
    Buffer.from(jwt.data),
  )
  if (!verified) throw new Error('Invalid JWT signature')

  const now = Math.floor(Date.now() / 1000)

  if (jwt.payload.exp < now) {
    throw new Error('Expired token')
  }

  if (jwt.payload.iat !== undefined && jwt.payload.iat > now + 60) {
    throw new Error('Token issued in the future')
  }

  if (jwt.payload.nbf !== undefined && jwt.payload.nbf > now) {
    throw new Error('Token not yet valid')
  }

  const aud = jwt.payload.aud
  const audArray = Array.isArray(aud) ? aud : [aud]
  if (!audArray.includes(expected.audience)) {
    throw new Error('Invalid token audience')
  }

  if (jwt.payload.iss !== expected.issuer) {
    throw new Error('Invalid token issuer')
  }

  return jwt.payload
}

/**
 * Called by OAuthProvider on every token issuance/refresh.
 * On refresh: validates the upstream CF Access session is still active
 * by attempting to refresh the upstream token. If the user was removed
 * from the Access policy, the refresh fails and we reject the MCP session.
 */
export async function tokenExchangeCallback({
  grantType,
  props,
}: TokenExchangeCallbackOptions): Promise<
  TokenExchangeCallbackResult | void
> {
  const typedProps = props as Props

  // Only validate upstream session on refresh
  if (grantType !== ('refresh_token' as GrantType)) return
  if (!typedProps.refreshToken) return

  const typedEnv = env as Env
  const tokenUrl = cfAccessUrls(typedEnv.ACCESS_TEAM, typedEnv.ACCESS_CLIENT_ID).token

  const result = await refreshUpstreamToken({
    upstream_url: tokenUrl,
    client_id: typedEnv.ACCESS_CLIENT_ID,
    client_secret: typedEnv.ACCESS_CLIENT_SECRET,
    refresh_token: typedProps.refreshToken,
  })

  if (!result) {
    throw new Error('Upstream session revoked')
  }

  return {
    newProps: {
      ...typedProps,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken ?? typedProps.refreshToken,
    },
  }
}
