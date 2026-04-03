import { describe, expect, it } from 'vitest'
import {
  sanitizeText,
  sanitizeUrl,
  OAuthError,
  generateCSRFProtection,
  validateCSRFToken,
} from '../../src/oauth-utils'

describe('sanitizeText', () => {
  it('escapes HTML special characters', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    )
  })

  it('escapes ampersands', () => {
    expect(sanitizeText('a & b')).toBe('a &amp; b')
  })

  it('escapes single quotes', () => {
    expect(sanitizeText("it's")).toBe('it&#039;s')
  })

  it('passes through safe text', () => {
    expect(sanitizeText('hello world')).toBe('hello world')
  })
})

describe('sanitizeUrl', () => {
  it('allows https URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
  })

  it('allows http URLs', () => {
    expect(sanitizeUrl('http://localhost:8787')).toBe('http://localhost:8787')
  })

  it('rejects javascript: URLs', () => {
    expect(sanitizeUrl("javascript:alert('xss')")).toBe('')
  })

  it('rejects data: URLs', () => {
    expect(sanitizeUrl('data:text/html,<h1>hi</h1>')).toBe('')
  })

  it('rejects empty string', () => {
    expect(sanitizeUrl('')).toBe('')
  })

  it('rejects control characters', () => {
    expect(sanitizeUrl('https://example.com/\x00')).toBe('')
  })

  it('rejects invalid URLs', () => {
    expect(sanitizeUrl('not a url')).toBe('')
  })

  it('trims whitespace', () => {
    expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com')
  })
})

describe('OAuthError', () => {
  it('creates JSON error response', () => {
    const err = new OAuthError('invalid_request', 'Bad request', 400)
    const res = err.toResponse()

    expect(res.status).toBe(400)
    expect(res.headers.get('Content-Type')).toBe('application/json')
  })

  it('defaults to 400 status', () => {
    const err = new OAuthError('invalid_request', 'Bad')
    expect(err.statusCode).toBe(400)
  })
})

describe('generateCSRFProtection', () => {
  it('returns token and cookie', () => {
    const result = generateCSRFProtection()
    expect(result.token).toBeDefined()
    expect(result.token.length).toBeGreaterThan(0)
    expect(result.setCookie).toContain('__Host-CSRF_TOKEN=')
    expect(result.setCookie).toContain('HttpOnly')
    expect(result.setCookie).toContain('Secure')
  })
})

describe('validateCSRFToken', () => {
  it('throws on missing form token', () => {
    const formData = new FormData()
    const request = new Request('https://example.com', {
      headers: { Cookie: '__Host-CSRF_TOKEN=abc' },
    })

    expect(() => validateCSRFToken(formData, request)).toThrow(OAuthError)
  })

  it('throws on missing cookie', () => {
    const formData = new FormData()
    formData.set('csrf_token', 'abc')
    const request = new Request('https://example.com')

    expect(() => validateCSRFToken(formData, request)).toThrow(OAuthError)
  })

  it('throws on mismatch', () => {
    const formData = new FormData()
    formData.set('csrf_token', 'abc')
    const request = new Request('https://example.com', {
      headers: { Cookie: '__Host-CSRF_TOKEN=xyz' },
    })

    expect(() => validateCSRFToken(formData, request)).toThrow(OAuthError)
  })

  it('passes on match', () => {
    const formData = new FormData()
    formData.set('csrf_token', 'matching-token')
    const request = new Request('https://example.com', {
      headers: { Cookie: '__Host-CSRF_TOKEN=matching-token' },
    })

    const result = validateCSRFToken(formData, request)
    expect(result.clearCookie).toContain('Max-Age=0')
  })
})
