import { randomBytes } from 'node:crypto'

/**
 * Config de proxy residencial para Playwright (proxies.fo / Bright Data–like).
 * Nunca loguear password ni username completo con secretos.
 *
 * Env:
 * - SAT_PROXY_URL (ej. http://host:port) — si ausente → conexión directa
 * - SAT_PROXY_USER_PREFIX (ej. grecojcwy1-country-mx-state-nuevoleon)
 * - SAT_PROXY_PASSWORD
 */

/** @returns {'present'|'absent'} */
export function satProxyPresence() {
  return String(process.env.SAT_PROXY_URL || '').trim() ? 'present' : 'absent'
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
