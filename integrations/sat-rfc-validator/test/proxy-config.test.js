import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSatProxyConfig,
  newProxySessionId,
  proxySafeSummary,
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
