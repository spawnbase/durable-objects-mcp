import { describe, expect, it } from 'vitest'
import { cfAccessUrls } from '../../src/auth-handler'

describe('cfAccessUrls', () => {
  it('derives correct URLs from team + clientId', () => {
    const urls = cfAccessUrls('myteam', 'abc123')
    expect(urls.authorization).toBe(
      'https://myteam.cloudflareaccess.com/cdn-cgi/access/sso/oidc/abc123/authorization',
    )
    expect(urls.token).toBe(
      'https://myteam.cloudflareaccess.com/cdn-cgi/access/sso/oidc/abc123/token',
    )
    expect(urls.jwks).toBe(
      'https://myteam.cloudflareaccess.com/cdn-cgi/access/sso/oidc/abc123/jwks',
    )
  })

  it('handles real-world values', () => {
    const urls = cfAccessUrls(
      'alexanderzuev',
      'd9254f61d1e4476deaa39d5ecc80976e',
    )
    expect(urls.authorization).toContain('alexanderzuev.cloudflareaccess.com')
    expect(urls.token).toContain('d9254f61d1e4476deaa39d5ecc80976e')
  })
})
