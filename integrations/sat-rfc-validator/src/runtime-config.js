function normalizeProxyServer(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return `http://${raw}`
}

function proxyPassword(env) {
  return String(env.PROXY_PASSWORD ?? env.PROXY_PASS ?? '').trim()
}

function explicitProxyUsername(env) {
  return String(env.PROXY_USERNAME ?? '').trim()
}

function legacyProxyUsername(env) {
  const userPrefix = String(env.PROXY_USER_PREFIX ?? '').trim()
  if (!userPrefix) return ''

  const country = String(env.PROXY_COUNTRY ?? 'mx').trim().toLowerCase() || 'mx'
  const state = String(env.PROXY_STATE ?? '').trim().toLowerCase()
  const sessionId =
    String(env.PROXY_SESSION_ID ?? '').trim() ||
    `sat${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  const geo = state
    ? `country-${country}-state-${state}`
    : `country-${country}`

  return `${userPrefix}-${geo}-session-${sessionId}`
}

export function buildPlaywrightProxy(env = process.env) {
  const requireProxy = String(env.SAT_REQUIRE_PROXY ?? '1').trim() !== '0'
  const server = normalizeProxyServer(env.PROXY_URL)
  const password = proxyPassword(env)
  const username = explicitProxyUsername(env) || legacyProxyUsername(env)

  if (!server || !username || !password) {
    if (requireProxy) throw new Error('SAT_PROXY_NOT_CONFIGURED')
    return undefined
  }

  return { server, username, password }
}

export function satRuntimeReadiness(env = process.env) {
  const mode = String(env.SAT_VALIDATOR_MODE ?? 'fixture').trim().toLowerCase()
  const capsolverConfigured = Boolean(String(env.CAPSOLVER_API_KEY ?? '').trim())
  const requireProxy = String(env.SAT_REQUIRE_PROXY ?? '1').trim() !== '0'
  const proxyConfigured = Boolean(
    normalizeProxyServer(env.PROXY_URL) &&
      (explicitProxyUsername(env) || String(env.PROXY_USER_PREFIX ?? '').trim()) &&
      proxyPassword(env),
  )

  if (mode !== 'live') {
    return {
      ok: true,
      mode: 'fixture',
      capsolverConfigured,
      proxyConfigured,
      proxyRequired: requireProxy,
    }
  }

  return {
    ok: capsolverConfigured && (!requireProxy || proxyConfigured),
    mode: 'live',
    capsolverConfigured,
    proxyConfigured,
    proxyRequired: requireProxy,
  }
}
