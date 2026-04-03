import { describe, expect, it } from 'vitest'
import {
  getQueryableDOs,
  HEX_ID_RE,
  EXCLUDED_BINDINGS,
} from '../../src/mcp-agent'

const mockNamespace = {
  idFromName: () => {},
  get: () => {},
  getByName: () => {},
}

describe('getQueryableDOs', () => {
  it('discovers DO bindings with idFromName', () => {
    const env = {
      AI_AGENT: mockNamespace,
      WORKFLOW_DRAFT: mockNamespace,
    }
    const result = getQueryableDOs(env as unknown as Env)
    expect(Object.keys(result)).toEqual(['AI_AGENT', 'WORKFLOW_DRAFT'])
  })

  it('excludes DO_MCP_AGENT', () => {
    const env = {
      DO_MCP_AGENT: mockNamespace,
      AI_AGENT: mockNamespace,
    }
    const result = getQueryableDOs(env as unknown as Env)
    expect(Object.keys(result)).toEqual(['AI_AGENT'])
  })

  it('excludes OAUTH_KV', () => {
    const env = {
      OAUTH_KV: { get: () => {}, put: () => {} },
      AI_AGENT: mockNamespace,
    }
    const result = getQueryableDOs(env as unknown as Env)
    expect(Object.keys(result)).toEqual(['AI_AGENT'])
  })

  it('excludes non-DO bindings (no idFromName)', () => {
    const env = {
      SOME_KV: { get: () => {}, put: () => {} },
      SOME_STRING: 'hello',
      SOME_NUMBER: 42,
      AI_AGENT: mockNamespace,
    }
    const result = getQueryableDOs(env as unknown as Env)
    expect(Object.keys(result)).toEqual(['AI_AGENT'])
  })

  it('returns empty when only excluded bindings', () => {
    const env = {
      DO_MCP_AGENT: mockNamespace,
      OAUTH_KV: { get: () => {} },
    }
    const result = getQueryableDOs(env as unknown as Env)
    expect(Object.keys(result)).toEqual([])
  })
})

describe('HEX_ID_RE', () => {
  it('matches 64-char lowercase hex', () => {
    expect(
      HEX_ID_RE.test(
        '4b92bfbd0a31236befb4ce19a18c813e2324021f5660ca5675c44c34165f62e1',
      ),
    ).toBe(true)
  })

  it('matches 64-char uppercase hex', () => {
    expect(
      HEX_ID_RE.test(
        '4B92BFBD0A31236BEFB4CE19A18C813E2324021F5660CA5675C44C34165F62E1',
      ),
    ).toBe(true)
  })

  it('rejects short strings', () => {
    expect(HEX_ID_RE.test('abc123')).toBe(false)
  })

  it('rejects 32-char hex (half length)', () => {
    expect(HEX_ID_RE.test('4b92bfbd0a31236befb4ce19a18c813e')).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(
      HEX_ID_RE.test(
        'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      ),
    ).toBe(false)
  })

  it('rejects user names', () => {
    expect(HEX_ID_RE.test('user_abc123')).toBe(false)
  })
})

describe('EXCLUDED_BINDINGS', () => {
  it('excludes DO_MCP_AGENT', () => {
    expect(EXCLUDED_BINDINGS.has('DO_MCP_AGENT')).toBe(true)
  })

  it('excludes OAUTH_KV', () => {
    expect(EXCLUDED_BINDINGS.has('OAUTH_KV')).toBe(true)
  })

  it('does not exclude user bindings', () => {
    expect(EXCLUDED_BINDINGS.has('AI_AGENT')).toBe(false)
  })
})
