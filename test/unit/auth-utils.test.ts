import { describe, expect, it } from 'vitest'
import {
  createOAuthState,
  validateOAuthState,
  OAuthError,
  isClientApproved,
  addApprovedClient,
} from '../../src/oauth-utils'
import { env } from 'cloudflare:workers'

describe('OAuth state management', () => {
  it('creates and validates state round-trip', async () => {
    const oauthReqInfo = {
      clientId: 'test-client',
      scope: 'openid',
      redirectUri: 'https://example.com/callback',
    }

    const { stateToken } = await createOAuthState(
      oauthReqInfo as any,
      env.OAUTH_KV,
    )
    expect(stateToken).toBeDefined()

    const request = new Request(
      `https://example.com/callback?state=${stateToken}`,
    )
    const result = await validateOAuthState(request, env.OAUTH_KV)
    expect(result.oauthReqInfo.clientId).toBe('test-client')
  })

  it('rejects missing state parameter', async () => {
    const request = new Request('https://example.com/callback')
    await expect(validateOAuthState(request, env.OAUTH_KV)).rejects.toThrow(
      OAuthError,
    )
  })

  it('rejects invalid/expired state', async () => {
    const request = new Request(
      'https://example.com/callback?state=nonexistent',
    )
    await expect(validateOAuthState(request, env.OAUTH_KV)).rejects.toThrow(
      OAuthError,
    )
  })

  it('state is one-time use (deleted after validation)', async () => {
    const { stateToken } = await createOAuthState(
      { clientId: 'test' } as any,
      env.OAUTH_KV,
    )

    const request = new Request(
      `https://example.com/callback?state=${stateToken}`,
    )
    await validateOAuthState(request, env.OAUTH_KV)

    // Second use should fail
    await expect(validateOAuthState(request, env.OAUTH_KV)).rejects.toThrow(
      OAuthError,
    )
  })
})

describe('client approval cookies', () => {
  const secret = 'test-secret-key-for-hmac-signing'

  it('returns false for unapproved client', async () => {
    const request = new Request('https://example.com')
    const approved = await isClientApproved(request, 'client-1', secret)
    expect(approved).toBe(false)
  })

  it('approves and verifies client round-trip', async () => {
    const request = new Request('https://example.com')
    const cookie = await addApprovedClient(request, 'client-1', secret)
    expect(cookie).toContain('__Host-APPROVED_CLIENTS=')

    const requestWithCookie = new Request('https://example.com', {
      headers: { Cookie: cookie.split(';')[0] },
    })
    const approved = await isClientApproved(
      requestWithCookie,
      'client-1',
      secret,
    )
    expect(approved).toBe(true)
  })

  it('rejects tampered cookie', async () => {
    const request = new Request('https://example.com', {
      headers: {
        Cookie: '__Host-APPROVED_CLIENTS=invalid.dGVzdA==',
      },
    })
    const approved = await isClientApproved(request, 'client-1', secret)
    expect(approved).toBe(false)
  })
})
