// Adapted from https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-cf-access
// OAuth utility functions with CSRF and state validation

import type {
  AuthRequest,
  ClientInfo,
} from '@cloudflare/workers-oauth-provider'

export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public statusCode = 400,
  ) {
    super(description)
    this.name = 'OAuthError'
  }

  toResponse(): Response {
    return new Response(
      JSON.stringify({
        error: this.code,
        error_description: this.description,
      }),
      {
        status: this.statusCode,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}

export interface OAuthStateResult {
  stateToken: string
}

export interface ValidateStateResult {
  oauthReqInfo: AuthRequest
  clearCookie: string
}

export interface CSRFProtectionResult {
  token: string
  setCookie: string
}

export interface ValidateCSRFResult {
  clearCookie: string
}

export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function sanitizeUrl(url: string): string {
  const normalized = url.trim()
  if (normalized.length === 0) return ''

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
      return ''
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(normalized)
  } catch {
    return ''
  }

  const allowedSchemes = ['https', 'http']
  const scheme = parsedUrl.protocol.slice(0, -1).toLowerCase()
  if (!allowedSchemes.includes(scheme)) return ''

  return normalized
}

export function generateCSRFProtection(): CSRFProtectionResult {
  const csrfCookieName = '__Host-CSRF_TOKEN'
  const token = crypto.randomUUID()
  const setCookie = `${csrfCookieName}=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=600`
  return { token, setCookie }
}

export function validateCSRFToken(
  formData: FormData,
  request: Request,
): ValidateCSRFResult {
  const csrfCookieName = '__Host-CSRF_TOKEN'
  const tokenFromForm = formData.get('csrf_token')

  if (!tokenFromForm || typeof tokenFromForm !== 'string') {
    throw new OAuthError(
      'invalid_request',
      'Missing CSRF token in form data',
      400,
    )
  }

  const cookieHeader = request.headers.get('Cookie') || ''
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const csrfCookie = cookies.find((c) => c.startsWith(`${csrfCookieName}=`))
  const tokenFromCookie = csrfCookie
    ? csrfCookie.substring(csrfCookieName.length + 1)
    : null

  if (!tokenFromCookie) {
    throw new OAuthError('invalid_request', 'Missing CSRF token cookie', 400)
  }

  if (tokenFromForm !== tokenFromCookie) {
    throw new OAuthError('invalid_request', 'CSRF token mismatch', 400)
  }

  const clearCookie = `${csrfCookieName}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`
  return { clearCookie }
}

export async function createOAuthState(
  oauthReqInfo: AuthRequest,
  kv: KVNamespace,
  stateTTL = 600,
): Promise<OAuthStateResult> {
  const stateToken = crypto.randomUUID()
  await kv.put(`oauth:state:${stateToken}`, JSON.stringify(oauthReqInfo), {
    expirationTtl: stateTTL,
  })
  return { stateToken }
}

export async function validateOAuthState(
  request: Request,
  kv: KVNamespace,
): Promise<ValidateStateResult> {
  const url = new URL(request.url)
  const stateFromQuery = url.searchParams.get('state')

  if (!stateFromQuery) {
    throw new OAuthError('invalid_request', 'Missing state parameter', 400)
  }

  const storedDataJson = await kv.get(`oauth:state:${stateFromQuery}`)
  if (!storedDataJson) {
    throw new OAuthError('invalid_request', 'Invalid or expired state', 400)
  }

  let oauthReqInfo: AuthRequest
  try {
    oauthReqInfo = JSON.parse(storedDataJson) as AuthRequest
  } catch {
    throw new OAuthError('server_error', 'Invalid state data', 500)
  }

  await kv.delete(`oauth:state:${stateFromQuery}`)
  return { oauthReqInfo, clearCookie: '' }
}

export async function isClientApproved(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<boolean> {
  const approvedClients = await getApprovedClientsFromCookie(
    request,
    cookieSecret,
  )
  return approvedClients?.includes(clientId) ?? false
}

export async function addApprovedClient(
  request: Request,
  clientId: string,
  cookieSecret: string,
): Promise<string> {
  const approvedClientsCookieName = '__Host-APPROVED_CLIENTS'
  const THIRTY_DAYS_IN_SECONDS = 2592000

  const existingApprovedClients =
    (await getApprovedClientsFromCookie(request, cookieSecret)) || []
  const updatedApprovedClients = Array.from(
    new Set([...existingApprovedClients, clientId]),
  )

  const payload = JSON.stringify(updatedApprovedClients)
  const signature = await signData(payload, cookieSecret)
  const cookieValue = `${signature}.${btoa(payload)}`

  return `${approvedClientsCookieName}=${cookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${THIRTY_DAYS_IN_SECONDS}`
}

export interface ApprovalDialogOptions {
  client: ClientInfo | null
  server: {
    name: string
    logo?: string
    description?: string
  }
  state: Record<string, unknown>
  csrfToken: string
  setCookie: string
}

export function renderApprovalDialog(
  request: Request,
  options: ApprovalDialogOptions,
): Response {
  const { client, server, state, csrfToken, setCookie } = options
  const encodedState = btoa(JSON.stringify(state))

  const serverName = sanitizeText(server.name)
  const clientName = client?.clientName
    ? sanitizeText(client.clientName)
    : 'Unknown MCP Client'

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${clientName} | Authorization Request</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #f9fafb; margin: 0; padding: 2rem; }
          .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 8px 36px rgba(0,0,0,0.1); padding: 2rem; }
          h1 { font-size: 1.2rem; text-align: center; }
          .actions { display: flex; gap: 1rem; justify-content: flex-end; margin-top: 2rem; }
          button { padding: 0.75rem 1.5rem; border-radius: 6px; font-size: 1rem; cursor: pointer; border: none; }
          .primary { background: #0070f3; color: #fff; }
          .secondary { background: transparent; border: 1px solid #e5e7eb; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1><strong>${clientName}</strong> wants to connect to <strong>${serverName}</strong></h1>
          <p>Approve to continue with authentication.</p>
          <form method="post" action="${new URL(request.url).pathname}">
            <input type="hidden" name="state" value="${encodedState}">
            <input type="hidden" name="csrf_token" value="${csrfToken}">
            <div class="actions">
              <button type="button" class="secondary" onclick="window.history.back()">Cancel</button>
              <button type="submit" class="primary">Approve</button>
            </div>
          </form>
        </div>
      </body>
    </html>
  `

  return new Response(htmlContent, {
    headers: {
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': setCookie,
      'X-Frame-Options': 'DENY',
    },
  })
}

export function getUpstreamAuthorizeUrl(params: {
  upstream_url: string
  client_id: string
  redirect_uri: string
  scope: string
  state: string
}): string {
  const url = new URL(params.upstream_url)
  url.searchParams.set('client_id', params.client_id)
  url.searchParams.set('redirect_uri', params.redirect_uri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', params.scope)
  url.searchParams.set('state', params.state)
  return url.toString()
}

export async function fetchUpstreamAuthToken(params: {
  upstream_url: string
  client_id: string
  client_secret: string
  code?: string
  redirect_uri: string
}): Promise<[string, string, null] | [null, null, Response]> {
  if (!params.code) {
    return [
      null,
      null,
      new Response('Missing authorization code', { status: 400 }),
    ]
  }

  const response = await fetch(params.upstream_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      client_id: params.client_id,
      client_secret: params.client_secret,
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirect_uri,
    }).toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return [
      null,
      null,
      new Response(`Failed to exchange code for token: ${errorText}`, {
        status: response.status,
      }),
    ]
  }

  const body = (await response.json()) as Record<string, unknown>
  const accessToken = body.access_token as string
  if (!accessToken) {
    return [null, null, new Response('Missing access token', { status: 400 })]
  }

  const idToken = body.id_token as string
  if (!idToken) {
    return [null, null, new Response('Missing id token', { status: 400 })]
  }

  return [accessToken, idToken, null]
}

export interface Props {
  accessToken: string
  email: string
  login: string
  name: string
  [key: string]: unknown
}

// --- Internal helpers ---

async function getApprovedClientsFromCookie(
  request: Request,
  cookieSecret: string,
): Promise<string[] | null> {
  const approvedClientsCookieName = '__Host-APPROVED_CLIENTS'
  const cookieHeader = request.headers.get('Cookie')
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const targetCookie = cookies.find((c) =>
    c.startsWith(`${approvedClientsCookieName}=`),
  )
  if (!targetCookie) return null

  const cookieValue = targetCookie.substring(
    approvedClientsCookieName.length + 1,
  )
  const parts = cookieValue.split('.')
  if (parts.length !== 2) return null

  const [signatureHex, base64Payload] = parts
  const payload = atob(base64Payload)
  const isValid = await verifySignature(signatureHex, payload, cookieSecret)
  if (!isValid) return null

  try {
    const approvedClients = JSON.parse(payload)
    if (
      !Array.isArray(approvedClients) ||
      !approvedClients.every((item) => typeof item === 'string')
    ) {
      return null
    }
    return approvedClients as string[]
  } catch {
    return null
  }
}

async function signData(data: string, secret: string): Promise<string> {
  const key = await importKey(secret)
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data),
  )
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function verifySignature(
  signatureHex: string,
  data: string,
  secret: string,
): Promise<boolean> {
  const key = await importKey(secret)
  try {
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)),
    )
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes.buffer,
      new TextEncoder().encode(data),
    )
  } catch {
    return false
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('cookieSecret is required')
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign', 'verify'],
  )
}
