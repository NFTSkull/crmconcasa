import { randomBytes } from 'node:crypto'

/**
 * Config de proxy residencial para Playwright (proxies.fo / Bright Data–like).
 * Nunca loguear password ni username completo con secretos.
 *
 * Env:
 * - SAT_PROXY_URL (ej. http://host:port) — si ausente → conexión directa
 * - SAT_PROXY_USER_PREFIX (ej. grecojcwy1-country-mx-state-nuevoleon)
 * - SAT_PROXY_PASSWORD
 * - SAT_PROXY_MAX_SESSIONS (default 3) — rotaciones ante error de red/proxy
 * - SAT_REQUEST_BUDGET_MS (default 50000) — presupuesto total por solicitud
 */

/** Marcadores de fallo de proxy/red (rotan sesión). No incluyen captcha/RFC inválido. */
export const PROXY_NETWORK_ERROR_MARKERS = [
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_EMPTY_RESPONSE',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_NETWORK_CHANGED',
  'ERR_SOCKS_CONNECTION_FAILED',
  'ERR_SSL_PROTOCOL_ERROR',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_TIMED_OUT',
  'ProxyConnectionError',
]

/** @returns {'present'|'absent'} */
export function satProxyPresence() {
  return String(process.env.SAT_PROXY_URL || '').trim() ? 'present' : 'absent'
}

/** Máx. sesiones/IP por solicitud (default 3). */
export function maxProxySessions() {
  return Math.max(1, Math.min(5, Number(process.env.SAT_PROXY_MAX_SESSIONS || 3) || 3))
}

/** Presupuesto total ms por solicitud (default 50s, alineado al route). */
export function requestBudgetMs() {
  return Math.max(10_000, Number(process.env.SAT_REQUEST_BUDGET_MS || 50_000) || 50_000)
}

/**
 * ¿Error de proxy/red/timeout de navegación? → rotar sesión.
 * Captcha rechazado / RFC inválido / SAT business NO rotan.
 * @param {unknown} error
 */
export function isProxyOrNetworkError(error) {
  const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (PROXY_NETWORK_ERROR_MARKERS.some((m) => msg.includes(m))) return true
  // Playwright page.goto / waitFor timeouts
  if (/Timeout/i.test(msg) && /(page\.goto|Navigation|waiting for|exceeded)/i.test(msg)) {
    return true
  }
  if (/net::ERR_/i.test(msg)) return true
  return false
}

/**
 * Tipo corto para logs (sin credenciales ni stack).
 * @param {unknown} error
 */
export function proxyNetworkErrorType(error) {
  const msg = error instanceof Error ? error.message : String(error)
  for (const m of PROXY_NETWORK_ERROR_MARKERS) {
    if (msg.includes(m)) return m
  }
  if (/Timeout/i.test(msg)) return 'NAV_TIMEOUT'
  const net = msg.match(/net::(ERR_[A-Z0-9_]+)/i)
  if (net) return net[1]
  return 'NETWORK_OR_PROXY'
}

/**
 * ¿Rotar a otra sesión de proxy tras un error?
 * Captcha/RFC inválido no llegan aquí (no son throws de red).
 * @param {{ error: unknown, sessionNum: number, maxSessions: number, remainingMs: number, minMsForNewSession?: number }} args
 */
export function planProxySessionRetry(args) {
  const minMs = args.minMsForNewSession ?? 8_000
  if (!isProxyOrNetworkError(args.error)) {
    return { rotate: false, reason: 'NOT_NETWORK', errorType: proxyNetworkErrorType(args.error) }
  }
  if (args.sessionNum >= args.maxSessions) {
    return { rotate: false, reason: 'MAX_SESSIONS', errorType: proxyNetworkErrorType(args.error) }
  }
  if (args.remainingMs < minMs) {
    return { rotate: false, reason: 'BUDGET', errorType: proxyNetworkErrorType(args.error) }
  }
  return { rotate: true, reason: 'NETWORK', errorType: proxyNetworkErrorType(args.error) }
}

/**
 * Genera sessionId aleatorio corto (hex).
 * @param {number} [bytes=8]
 */
export function newProxySessionId(bytes = 8) {
  return randomBytes(bytes).toString('hex')
}

/**
 * Arma username: `<prefix>-session-<sessionId>-ttl-5`
 * Misma sesión para RFC + CURP de una llamada /validate.
 *
 * @param {{ sessionId?: string }} [opts]
 * @returns {{ server: string, username: string, password: string } | undefined}
 */
export function buildSatProxyConfig(opts = {}) {
  const server = String(process.env.SAT_PROXY_URL || '').trim()
  if (!server) return undefined

  const prefix = String(process.env.SAT_PROXY_USER_PREFIX || '').trim()
  const password = String(process.env.SAT_PROXY_PASSWORD || '')
  const sessionId = opts.sessionId || newProxySessionId()

  if (!prefix) {
    throw new Error('SAT_PROXY_USER_PREFIX_REQUIRED')
  }
  if (!password) {
    throw new Error('SAT_PROXY_PASSWORD_REQUIRED')
  }

  return {
    server,
    username: `${prefix}-session-${sessionId}-ttl-5`,
    password,
  }
}

/**
 * Resumen seguro para logs/health (sin credenciales).
 * @param {{ server: string, username: string, password: string } | undefined} proxy
 */
export function proxySafeSummary(proxy) {
  if (!proxy) return { used: false, serverHost: null, sessionHint: null }
  let serverHost = null
  try {
    const u = new URL(proxy.server)
    serverHost = u.host
  } catch {
    serverHost = 'invalid_url'
  }
  // Solo hint de sesión (último segmento antes de -ttl)
  const m = String(proxy.username).match(/-session-([a-f0-9]+)-ttl-/i)
  return {
    used: true,
    serverHost,
    sessionHint: m ? m[1].slice(0, 6) : 'set',
  }
}
