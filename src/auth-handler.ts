import type {
  AuthRequest,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'

/**
 * CF Access OAuth handler.
 * Redirects to CF Access login, handles callback, completes authorization.
 *
 * Required env vars:
 *   ACCESS_CLIENT_ID, ACCESS_CLIENT_SECRET,
 *   ACCESS_AUTHORIZATION_URL, ACCESS_TOKEN_URL, ACCESS_JWKS_URL
 */

interface AccessTokenResponse {
  access_token?: string
  id_token?: string
  token_type?: string
  error?: string
}

interface AccessUserInfo {
  email?: string
  sub?: string
  name?: string
}

async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
): Promise<string> {
  const stateToken = crypto.randomUUID()
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: 600,
  })
  return stateToken
}

async function validateOAuthState(
  stateToken: string,
  kv: KVNamespace,
): Promise<AuthRequest> {
  const data = await kv.get(`oauth:state:${stateToken}`)
  if (!data) {
    throw new Error('Invalid or expired state')
  }
  await kv.delete(`oauth:state:${stateToken}`)
  return JSON.parse(data) as AuthRequest
}

export default {
  async fetch(
    request: Request,
    env: Env & { OAUTH_PROVIDER: OAuthHelpers },
  ): Promise<Response> {
    const url = new URL(request.url)

    // Authorize: redirect to CF Access login
    if (url.pathname === '/authorize') {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request)
      if (!oauthReqInfo.clientId) {
        return new Response('Invalid request', { status: 400 })
      }

      const stateToken = await createOAuthState(oauthReqInfo, env.OAUTH_KV)

      const authUrl = new URL(env.ACCESS_AUTHORIZATION_URL)
      authUrl.searchParams.set('client_id', env.ACCESS_CLIENT_ID)
      authUrl.searchParams.set(
        'redirect_uri',
        new URL('/callback', request.url).href,
      )
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('state', stateToken)

      return Response.redirect(authUrl.toString(), 302)
    }

    // Callback: exchange code for token, complete authorization
    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code')
      const stateToken = url.searchParams.get('state')

      if (!code || !stateToken) {
        return new Response('Missing code or state', { status: 400 })
      }

      const oauthReqInfo = await validateOAuthState(stateToken, env.OAUTH_KV)

      // Exchange code for access token
      const tokenResponse = await fetch(env.ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.ACCESS_CLIENT_ID,
          client_secret: env.ACCESS_CLIENT_SECRET,
          code,
          redirect_uri: new URL('/callback', request.url).href,
          grant_type: 'authorization_code',
        }),
      })

      const tokenData = (await tokenResponse.json()) as AccessTokenResponse
      if (!tokenData.access_token) {
        return new Response('Token exchange failed', { status: 500 })
      }

      // Get user info from CF Access
      const userInfoUrl = env.ACCESS_AUTHORIZATION_URL.replace(
        '/authorize',
        '/userinfo',
      )
      const userInfoResponse = await fetch(userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      })
      const userInfo = (await userInfoResponse.json()) as AccessUserInfo

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthReqInfo,
        userId: userInfo.email ?? userInfo.sub ?? 'unknown',
        metadata: { label: userInfo.email ?? 'DO Explorer' },
        scope: oauthReqInfo.scope,
        props: {},
      })

      return Response.redirect(redirectTo, 302)
    }

    return new Response('Not found', { status: 404 })
  },
}
