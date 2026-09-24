import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHealthPayload, createApp } from '../src/server.js'

test('buildHealthPayload reporta present/absent sin valores', () => {
  const prevKey = process.env.CAPSOLVER_API_KEY
  const prevSecret = process.env.SAT_VALIDATOR_SECRET
  const prevMode = process.env.SAT_VALIDATOR_MODE
  try {
    process.env.SAT_VALIDATOR_MODE = 'live'
    process.env.CAPSOLVER_API_KEY = 'sk-test-never-log'
    process.env.SAT_VALIDATOR_SECRET = 'secret-test-never-log'
    const withBoth = buildHealthPayload()
    assert.deepEqual(withBoth, {
      ok: true,
      mode: 'live',
      CAPSOLVER_API_KEY: 'present',
      SAT_VALIDATOR_SECRET: 'present',
    })
    assert.doesNotMatch(JSON.stringify(withBoth), /sk-test|secret-test/)

    delete process.env.CAPSOLVER_API_KEY
    delete process.env.SAT_VALIDATOR_SECRET
    const absent = buildHealthPayload()
    assert.equal(absent.CAPSOLVER_API_KEY, 'absent')
    assert.equal(absent.SAT_VALIDATOR_SECRET, 'absent')
  } finally {
    if (prevKey === undefined) delete process.env.CAPSOLVER_API_KEY
    else process.env.CAPSOLVER_API_KEY = prevKey
    if (prevSecret === undefined) delete process.env.SAT_VALIDATOR_SECRET
    else process.env.SAT_VALIDATOR_SECRET = prevSecret
    if (prevMode === undefined) delete process.env.SAT_VALIDATOR_MODE
    else process.env.SAT_VALIDATOR_MODE = prevMode
  }
})

test('GET /diagnostics/sat exige secret y no consulta RFC', async () => {
  const prevSecret = process.env.SAT_VALIDATOR_SECRET
  process.env.SAT_VALIDATOR_SECRET = 'diag-secret'
  const calls = []
  const app = createApp({
    probeSat: async () => {
      calls.push('probe')
      return { ok: true, loadMs: 42, error: null }
    },
  })

  try {
    const unauthorized = await fetchDiag(app, null)
    assert.equal(unauthorized.status, 401)
    assert.equal(calls.length, 0)

    const ok = await fetchDiag(app, 'diag-secret')
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.deepEqual(body, { ok: true, loadMs: 42, error: null })
    assert.equal(calls.length, 1)
    assert.doesNotMatch(JSON.stringify(body), /RFC|CURP|cliente/i)
  } finally {
    if (prevSecret === undefined) delete process.env.SAT_VALIDATOR_SECRET
    else process.env.SAT_VALIDATOR_SECRET = prevSecret
  }
})

test('GET /diagnostics/sat falla cerrado con error y loadMs', async () => {
  const prevSecret = process.env.SAT_VALIDATOR_SECRET
  process.env.SAT_VALIDATOR_SECRET = 'diag-secret'
  const app = createApp({
    probeSat: async () => ({
      ok: false,
      loadMs: 1200,
      error: 'RFC_DIAG_PAGE_NOT_READY',
    }),
  })
  try {
    const res = await fetchDiag(app, 'diag-secret')
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.ok, false)
    assert.equal(body.loadMs, 1200)
    assert.equal(body.error, 'RFC_DIAG_PAGE_NOT_READY')
  } finally {
    if (prevSecret === undefined) delete process.env.SAT_VALIDATOR_SECRET
    else process.env.SAT_VALIDATOR_SECRET = prevSecret
  }
})

/** Express 5 no tiene app.request; levantar listener efímero. */
async function fetchDiag(app, secret) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  try {
    const { port } = server.address()
    const headers = {}
    if (secret) headers['x-concasa-worker-secret'] = secret
    return await fetch(`http://127.0.0.1:${port}/diagnostics/sat`, { headers })
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  }
}
