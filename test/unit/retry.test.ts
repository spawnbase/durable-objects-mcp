import { describe, expect, it, vi } from 'vitest'
import { callWithRetry, getStub } from '../../src/mcp-agent'

function mockNamespace(queryFn: (...args: unknown[]) => unknown) {
  const stub = { query: queryFn }
  return {
    idFromName: () => ({ toString: () => 'mock-id' }),
    idFromString: () => ({ toString: () => 'mock-id' }),
    get: () => stub,
    getByName: () => stub,
  } as unknown as DurableObjectNamespace
}

describe('callWithRetry', () => {
  it('returns result on first success', async () => {
    const ns = mockNamespace(() => ({ columns: ['a'], rows: [[1]] }))
    const result = await callWithRetry(ns, 'test', 'SELECT 1')
    expect(result).toEqual({ columns: ['a'], rows: [[1]] })
  })

  it('retries on retryable error and succeeds', async () => {
    let calls = 0
    const ns = mockNamespace(() => {
      calls++
      if (calls < 3) {
        const err = new Error('temporary') as Error & { retryable: boolean }
        err.retryable = true
        throw err
      }
      return { columns: ['a'], rows: [[1]] }
    })

    const result = await callWithRetry(ns, 'test', 'SELECT 1', 3)
    expect(result).toEqual({ columns: ['a'], rows: [[1]] })
    expect(calls).toBe(3)
  })

  it('throws immediately on non-retryable error', async () => {
    let calls = 0
    const ns = mockNamespace(() => {
      calls++
      throw new Error('permanent')
    })

    await expect(callWithRetry(ns, 'test', 'SELECT 1')).rejects.toThrow(
      'permanent',
    )
    expect(calls).toBe(1)
  })

  it('throws immediately on overloaded error', async () => {
    let calls = 0
    const ns = mockNamespace(() => {
      calls++
      const err = new Error('overloaded') as Error & {
        retryable: boolean
        overloaded: boolean
      }
      err.retryable = true
      err.overloaded = true
      throw err
    })

    await expect(callWithRetry(ns, 'test', 'SELECT 1')).rejects.toThrow(
      'overloaded',
    )
    expect(calls).toBe(1)
  })

  it('throws after max attempts exhausted', async () => {
    let calls = 0
    const ns = mockNamespace(() => {
      calls++
      const err = new Error('keep failing') as Error & { retryable: boolean }
      err.retryable = true
      throw err
    })

    await expect(callWithRetry(ns, 'test', 'SELECT 1', 3)).rejects.toThrow(
      'keep failing',
    )
    expect(calls).toBe(3)
  })

  it('creates fresh stub per attempt', async () => {
    let getByNameCalls = 0
    const queryFn = vi.fn()
    const ns = {
      idFromName: () => ({ toString: () => 'mock-id' }),
      idFromString: () => ({ toString: () => 'mock-id' }),
      get: () => ({ query: queryFn }),
      getByName: () => {
        getByNameCalls++
        if (getByNameCalls < 3) {
          const err = new Error('broken stub') as Error & {
            retryable: boolean
          }
          err.retryable = true
          throw err
        }
        return { query: () => ({ columns: [], rows: [] }) }
      },
    } as unknown as DurableObjectNamespace

    // getByName is called for non-hex names — each retry creates a new stub
    const result = await callWithRetry(ns, 'my-instance', 'SELECT 1', 3)
    expect(getByNameCalls).toBe(3)
  })
})
