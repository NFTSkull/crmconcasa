export function buildPlaywrightProxy(env = process.env) {
  const requireProxy = String(env.SAT_REQUIRE_PROXY ?? '1').trim() !== '0'
  const server = String(env.PROXY_URL ?? '').trim()
  const password = String(env.PROXY_PASS ?? '').trim()

  if (!server || !password) {
    if (requireProxy) throw new Error('SAT_PROXY_NOT_CONFIGURED')
    return undefined
  }

  const country = String(env.PROXY_COUNTRY ?? 'mx').trim().toLowerCase() || 'mx'
  const state = String(env.PROXY_STATE ?? '').trim().toLowerCase()
  const userPrefix = String(env.PROXY_USER_PREFIX ?? 'grecojcwy1').trim()
  if (!userPrefix) throw new Error('SAT_PROXY_USER_NOT_CONFIGURED')

  const sessionId = `sat${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  const geo = state
    ? `country-${country}-state-${state}`
    : `country-${country}`

  return {
    server,
    username: `${userPrefix}-${geo}-session-${sessionId}`,
    password,
  }
}

export function satRuntimeReadiness(env = process.env) {
  const mode = String(env.SAT_VALIDATOR_MODE ?? 'fixture').trim().toLowerCase()
  if (mode !== 'live') {
    return {
      ok: true,
      mode: 'fixture',
      capsolverConfigured: Boolean(String(env.CAPSOLVER_API_KEY ?? '').trim()),
      proxyConfigured: Boolean(
        String(env.PROXY_URL ?? '').trim() && String(env.PROXY_PASS ?? '').trim(),
      ),
    }
  }

  const capsolverConfigured = Boolean(String(env.CAPSOLVER_API_KEY ?? '').trim())
  const requireProxy = String(env.SAT_REQUIRE_PROXY ?? '1').trim() !== '0'
  const proxyConfigured = Boolean(
    String(env.PROXY_URL ?? '').trim() && String(env.PROXY_PASS ?? '').trim(),
  )

  return {
    ok: capsolverConfigured && (!requireProxy || proxyConfigured),
    mode: 'live',
    capsolverConfigured,
    proxyConfigured,
  }
}
