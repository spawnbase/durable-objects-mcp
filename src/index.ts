import OAuthProvider from '@cloudflare/workers-oauth-provider'

import { DurableObjectsMcpAgent } from './mcp-agent'
import authHandler, { tokenExchangeCallback } from './auth-handler'

export { DurableObjectsMcpAgent as DOMcpAgent }

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: DurableObjectsMcpAgent.serve('/mcp', {
    binding: 'DO_MCP_AGENT',
  }),
  defaultHandler: authHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  allowPlainPKCE: false,
  refreshTokenTTL: 604800, // 7 days — matches CF Access refresh token lifetime
  tokenExchangeCallback,
  onError({ code, description, status }) {
    console.error(`OAuth error [${status}]: ${code} — ${description}`)
  },
})
