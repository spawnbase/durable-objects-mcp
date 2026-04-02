import OAuthProvider from '@cloudflare/workers-oauth-provider'

import { DurableObjectsMcpAgent } from './mcp-agent'
import authHandler from './auth-handler'

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
})
