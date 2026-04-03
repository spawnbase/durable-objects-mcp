import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Points to real entry — exports DOMcpAgent + TestQueryableDO for tests
      main: './test/fixtures/test-entry.ts',
      miniflare: {
        compatibilityFlags: ['nodejs_compat'],
        compatibilityDate: '2026-03-24',
        // Override wrangler bindings — remove cross-worker refs, add test DO
        durableObjects: {
          DO_MCP_AGENT: { className: 'DOMcpAgent', useSQLite: true },
          TEST_DO: { className: 'TestQueryableDO', useSQLite: true },
        },
        kvNamespaces: ['OAUTH_KV'],
      },
    }),
  ],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          dir: 'test/unit',
          include: ['**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          dir: 'test/integration',
          include: ['**/*.test.ts'],
        },
      },
    ],
  },
})
