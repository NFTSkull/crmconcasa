import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSatProxyConfig,
  isProxyOrNetworkError,
  maxProxySessions,
  newProxySessionId,
  planProxySessionRetry,
  proxyNetworkErrorType,
  proxySafeSummary,
  requestBudgetMs,
  satProxyPresence,
} from '../src/proxy-config.js'

function withEnv(vars, fn) {
  const prev = {}
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k]
    const v = vars[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k]
      else process.env[k] = prev[k]
    }
  }
}

test('satProxyPresence present/absent sin filtrar URL completa en logs del helper', () => {
  withEnv({ SAT_PROXY_URL: undefined }, () => {
    assert.equal(satProxyPresence(), 'absent')
  })
  withEnv({ SAT_PROXY_URL: 'http://pr-eu.proxies.fo:13337' }, () => {
    assert.equal(satProxyPresence(), 'present')
  })
})

test('buildSatProxyConfig undefined si no hay SAT_PROXY_URL', () => {
  withEnv(
    {
      SAT_PROXY_URL: undefined,
      SAT_PROXY_USER_PREFIX: 'grecojcwy1-country-mx-state-nuevoleon',
      SAT_PROXY_PASSWORD: 'secret-never-log',
    },
    () => {
      assert.equal(buildSatProxyConfig({ sessionId: 'abc' }), undefined)
    },
  )
})

test('buildSatProxyConfig arma username prefix-session-id-ttl-5', () => {
  withEnv(
    {
      SAT_PROXY_URL: 'http://pr-eu.proxies.fo:13337',
      SAT_PROXY_USER_PREFIX: 'grecojcwy1-country-mx-state-nuevoleon',
      SAT_PROXY_PASSWORD: 'secret-never-log',
    },
    () => {
      const cfg = buildSatProxyConfig({ sessionId: 'deadbeefcafebabe' })
      assert.ok(cfg)
      assert.equal(cfg.server, 'http://pr-eu.proxies.fo:13337')
      assert.equal(
        cfg.username,
        'grecojcwy1-country-mx-state-nuevoleon-session-deadbeefcafebabe-ttl-5',
      )
      assert.equal(cfg.password, 'secret-never-log')
      const safe = proxySafeSummary(cfg)
      assert.equal(safe.used, true)
      assert.equal(safe.serverHost, 'pr-eu.proxies.fo:13337')
      assert.equal(safe.sessionHint, 'deadbe')
      assert.doesNotMatch(JSON.stringify(safe), /secret-never-log/)
    },
  )
})

test('buildSatProxyConfig exige prefix y password si hay URL', () => {
  withEnv(
    {
      SAT_PROXY_URL: 'http://pr-eu.proxies.fo:13337',
      SAT_PROXY_USER_PREFIX: undefined,
      SAT_PROXY_PASSWORD: 'x',
    },
    () => {
      assert.throws(() => buildSatProxyConfig({ sessionId: 'a' }), /SAT_PROXY_USER_PREFIX_REQUIRED/)
    },
  )
  withEnv(
    {
      SAT_PROXY_URL: 'http://pr-eu.proxies.fo:13337',
      SAT_PROXY_USER_PREFIX: 'grecojcwy1-country-mx-state-nuevoleon',
      SAT_PROXY_PASSWORD: '',
    },
    () => {
      assert.throws(() => buildSatProxyConfig({ sessionId: 'a' }), /SAT_PROXY_PASSWORD_REQUIRED/)
    },
  )
})

test('newProxySessionId es hex aleatorio', () => {
  const a = newProxySessionId()
  const b = newProxySessionId()
  assert.match(a, /^[a-f0-9]{16}$/)
  assert.match(b, /^[a-f0-9]{16}$/)
  assert.notEqual(a, b)
})

test('misma sessionId reutilizable RFC+CURP (una llamada)', () => {
  withEnv(
    {
      SAT_PROXY_URL: 'http://host:1',
      SAT_PROXY_USER_PREFIX: 'pref',
      SAT_PROXY_PASSWORD: 'pw',
    },
    () => {
      const sid = '1111222233334444'
      const a = buildSatProxyConfig({ sessionId: sid })
      const b = buildSatProxyConfig({ sessionId: sid })
      assert.equal(a.username, b.username)
      assert.equal(a.username, 'pref-session-1111222233334444-ttl-5')
    },
  )
})

test('isProxyOrNetworkError detecta túnel/empty/timeout; no captcha ni RFC inválido', () => {
  assert.equal(
    isProxyOrNetworkError(new Error('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://x')),
    true,
  )
  assert.equal(
    isProxyOrNetworkError(new Error('page.goto: net::ERR_EMPTY_RESPONSE at https://x')),
    true,
  )
  assert.equal(
    isProxyOrNetworkError(new Error('page.goto: Timeout 45000ms exceeded')),
    true,
  )
  assert.equal(
    isProxyOrNetworkError(new Error('locator.click: Timeout 30000ms exceeded.')),
    false,
  )
  assert.equal(
    isProxyOrNetworkError(new Error('ERR_PROXY_CONNECTION_FAILED')),
    true,
  )
  assert.equal(
    isProxyOrNetworkError(new Error('ERR_CONNECTION_RESET')),
    true,
  )
  // SAT business / captcha — no rotar
  assert.equal(
    isProxyOrNetworkError(new Error('EL CODIGO QUE ESCRIBIO NO ES CORRECTO')),
    false,
  )
  assert.equal(
    isProxyOrNetworkError(new Error('EL RFC CAPTURADO NO SE ENCUENTRA EN LA LISTA')),
    false,
  )
  assert.equal(proxyNetworkErrorType(new Error('net::ERR_EMPTY_RESPONSE')), 'ERR_EMPTY_RESPONSE')
  assert.equal(
    proxyNetworkErrorType(new Error('page.goto: Timeout 45000ms exceeded')),
    'NAV_TIMEOUT',
  )
})

test('planProxySessionRetry rota en red hasta max; no rota por presupuesto/máx', () => {
  const tunnel = new Error('net::ERR_TUNNEL_CONNECTION_FAILED')
  assert.deepEqual(
    planProxySessionRetry({ error: tunnel, sessionNum: 1, maxSessions: 3, remainingMs: 40_000 }),
    { rotate: true, reason: 'NETWORK', errorType: 'ERR_TUNNEL_CONNECTION_FAILED' },
  )
  assert.equal(
    planProxySessionRetry({ error: tunnel, sessionNum: 3, maxSessions: 3, remainingMs: 40_000 }).rotate,
    false,
  )
  assert.equal(
    planProxySessionRetry({ error: tunnel, sessionNum: 3, maxSessions: 3, remainingMs: 40_000 }).reason,
    'MAX_SESSIONS',
  )
  assert.equal(
    planProxySessionRetry({ error: tunnel, sessionNum: 1, maxSessions: 3, remainingMs: 500 }).reason,
    'BUDGET',
  )
  assert.equal(
    planProxySessionRetry({
      error: new Error('EL CODIGO QUE ESCRIBIO NO ES CORRECTO'),
      sessionNum: 1,
      maxSessions: 3,
      remainingMs: 40_000,
    }).reason,
    'NOT_NETWORK',
  )
})

test('maxProxySessions y requestBudgetMs defaults/clamp', () => {
  withEnv({ SAT_PROXY_MAX_SESSIONS: undefined, SAT_REQUEST_BUDGET_MS: undefined }, () => {
    assert.equal(maxProxySessions(), 3)
    assert.equal(requestBudgetMs(), 50_000)
  })
  withEnv({ SAT_PROXY_MAX_SESSIONS: '99', SAT_REQUEST_BUDGET_MS: '1000' }, () => {
    assert.equal(maxProxySessions(), 5)
    assert.equal(requestBudgetMs(), 10_000)
  })
})
