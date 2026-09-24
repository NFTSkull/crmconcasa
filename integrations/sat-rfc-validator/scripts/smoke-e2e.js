#!/usr/bin/env node
/**
 * Smoke E2E local vía HTTP POST /validate (mismo contrato que el worker).
 * No toca CRM ni DB. Enmascara RFC/CURP (4 chars + ***).
 *
 * Uso: node scripts/smoke-e2e.js [N]
 * .env: SAT_VALIDATOR_SECRET, SMOKE_RFC, SMOKE_CURP, CAPSOLVER_API_KEY (en el server),
 *       SMOKE_RFC_INVALID?, SMOKE_BASE_URL? (default http://127.0.0.1:3002)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const INTEGRATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASE = 'http://127.0.0.1:3002'
const REQUEST_TIMEOUT_MS = 5 * 60_000

function loadLocalEnvFile() {
  const envPath = path.join(INTEGRATION_ROOT, '.env')
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function maskId(value) {
  const s = String(value ?? '')
  if (!s) return '(empty)'
  return `${s.slice(0, 4)}***`
}

function fmtCaptcha(c) {
  if (!c) return 'solve=- submit=- refresh=-'
  return `solve=${c.solveAttempts ?? 0} submit=${c.submitAttempts ?? 0} refresh=${c.refreshes ?? 0}`
}

function retryReason(body) {
  if (!body) return 'otro'
  if (body.code === 'TECHNICAL_FAILURE') return 'timeout'
  if (body.rfc?.status === 'captcha_failed' || body.curp?.status === 'captcha_failed') {
    return 'captcha_failed'
  }
  if (body.code) return String(body.code)
  return 'otro'
}

function isInfraFailure(err, httpStatus, body) {
  if (err) {
    const msg = String(err.message || err)
    if (/timeout|aborted|ECONNREFUSED|ECONNRESET|fetch failed|network/i.test(msg)) return true
  }
  if (httpStatus === 503 && body?.code === 'TECHNICAL_FAILURE') return true
  if (httpStatus === 0) return true
  return false
}

async function postValidate({ baseUrl, secret, rfc, curp }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  const started = Date.now()
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-concasa-worker-secret': secret,
      },
      body: JSON.stringify({ rfc, curp }),
      signal: ctrl.signal,
    })
    const body = await res.json().catch(() => ({}))
    return {
      httpStatus: res.status,
      body,
      seconds: (Date.now() - started) / 1000,
      error: null,
    }
  } catch (error) {
    return {
      httpStatus: 0,
      body: null,
      seconds: (Date.now() - started) / 1000,
      error,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Antes de la 1ª corrida: servidor arriba + secret coincide.
 * No cuenta como corrida fallida.
 */
async function preflightServer({ baseUrl, secret }) {
  const root = baseUrl.replace(/\/$/, '')
  let healthRes
  try {
    healthRes = await fetch(`${root}/health`, { signal: AbortSignal.timeout(10_000) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(
      `SMOKE_SERVER_UNREACHABLE: no responde ${root}/health (${msg}). ¿Corriste npm start en el puerto correcto?`,
    )
  }
  if (!healthRes.ok) {
    throw new Error(`SMOKE_SERVER_UNREACHABLE: GET /health → HTTP ${healthRes.status}`)
  }
  const health = await healthRes.json().catch(() => ({}))
  if (!health.ok) {
    throw new Error('SMOKE_SERVER_UNREACHABLE: /health no devolvió { ok: true }')
  }

  // Payload inválido a propósito: con secret correcto → 400; incorrecto → 401.
  let authRes
  try {
    authRes = await fetch(`${root}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-concasa-worker-secret': secret,
      },
      body: JSON.stringify({ rfc: 'BAD', curp: 'BAD' }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`SMOKE_SERVER_UNREACHABLE: POST /validate falló (${msg})`)
  }
  if (authRes.status === 401) {
    const body = await authRes.json().catch(() => ({}))
    throw new Error(
      `SMOKE_SECRET_MISMATCH: el server rechazó SAT_VALIDATOR_SECRET (401 code=${body.code ?? 'UNAUTHORIZED'}). Revisa que el .env del smoke coincida con el del proceso.`,
    )
  }
  const authBody = await authRes.json().catch(() => ({}))
  if (authRes.status !== 400) {
    throw new Error(
      `SMOKE_PREFLIGHT_UNEXPECTED: esperaba HTTP 400 (formato) con secret OK; recibí ${authRes.status} code=${authBody.code ?? '-'}`,
    )
  }
  // contracts.js con secret OK: RFC_FORMAT_INVALID / CURP_FORMAT_INVALID (no UNAUTHORIZED)
  if (authBody.code === 'UNAUTHORIZED') {
    throw new Error('SMOKE_SECRET_MISMATCH: code=UNAUTHORIZED con HTTP no-401 inesperado')
  }
  if (authBody.code !== 'RFC_FORMAT_INVALID' && authBody.code !== 'CURP_FORMAT_INVALID') {
    throw new Error(
      `SMOKE_PREFLIGHT_UNEXPECTED: esperaba code RFC_FORMAT_INVALID|CURP_FORMAT_INVALID; recibí code=${authBody.code ?? '-'}`,
    )
  }
  console.log(`[smoke-e2e] preflight ok health.mode=${health.mode ?? '?'} secret=match bodyGate=${authBody.code}`)
}

function printRunLine(label, runIndex, result) {
  const { body, seconds, httpStatus, error } = result
  if (error || !body) {
    console.log(
      `[smoke-e2e] ${label}#${runIndex} http=${httpStatus} semantic=- rfc=- curp=- rfcCaptcha=- curpCaptcha=- sec=${seconds.toFixed(1)} err=${error instanceof Error ? error.name : 'fail'}`,
    )
    return
  }
  console.log(
    `[smoke-e2e] ${label}#${runIndex} http=${httpStatus} semantic=${body.semantic ?? '-'} rfc=${body.rfc?.status ?? '-'} curp=${body.curp?.status ?? '-'} rfcCaptcha(${fmtCaptcha(body.rfc?.captcha)}) curpCaptcha(${fmtCaptcha(body.curp?.captcha)}) sec=${seconds.toFixed(1)}`,
  )
}

function printSummary({ validRuns, invalidResult, partial, avgSeconds }) {
  const pass = validRuns.filter((r) => r.body?.semantic === 'pass')
  const retry = validRuns.filter((r) => r.body?.semantic === 'retry' || (!r.body && r.error))
  const other = validRuns.filter((r) => r.body && r.body.semantic !== 'pass' && r.body.semantic !== 'retry')

  console.log(partial ? '\n=== SMOKE E2E RESUMEN (PARCIAL — posible bloqueo IP) ===' : '\n=== SMOKE E2E RESUMEN ===')
  console.log(`valid_runs=${validRuns.length} pass=${pass.length} retry=${retry.length} other=${other.length} avg_sec=${avgSeconds.toFixed(1)}`)
  for (const r of retry) {
    console.log(`  retry reason=${retryReason(r.body)} rfc=${r.body?.rfc?.status ?? '-'} curp=${r.body?.curp?.status ?? '-'}`)
  }
  if (invalidResult) {
    console.log(
      `invalid_case semantic=${invalidResult.body?.semantic ?? '-'} rfc=${invalidResult.body?.rfc?.status ?? '-'} curp=${invalidResult.body?.curp?.status ?? '-'} sec=${invalidResult.seconds.toFixed(1)}`,
    )
  } else {
    console.log('invalid_case=skipped (SMOKE_RFC_INVALID vacío)')
  }
}

async function main() {
  loadLocalEnvFile()
  const n = Math.max(1, Number(process.argv[2] || 5))
  const baseUrl = String(process.env.SMOKE_BASE_URL || DEFAULT_BASE).trim()
  const secret = String(process.env.SAT_VALIDATOR_SECRET || '').trim()
  const rfc = String(process.env.SMOKE_RFC || '').trim()
  const curp = String(process.env.SMOKE_CURP || '').trim()
  const rfcInvalid = String(process.env.SMOKE_RFC_INVALID || '').trim()

  if (!secret) {
    console.error('SAT_VALIDATOR_SECRET required in .env')
    process.exit(1)
  }
  if (!rfc || !curp) {
    console.error('SMOKE_RFC and SMOKE_CURP required in .env')
    process.exit(1)
  }

  console.log(`[smoke-e2e] base=${baseUrl} n=${n} rfc=${maskId(rfc)} curp=${maskId(curp)} invalidRfc=${rfcInvalid ? maskId(rfcInvalid) : 'none'}`)

  await preflightServer({ baseUrl, secret })

  const validRuns = []
  let consecutiveInfra = 0
  let partial = false
  let totalSec = 0

  for (let i = 1; i <= n; i += 1) {
    const result = await postValidate({ baseUrl, secret, rfc, curp })
    printRunLine('valid', i, result)
    validRuns.push(result)
    totalSec += result.seconds

    if (isInfraFailure(result.error, result.httpStatus, result.body)) {
      consecutiveInfra += 1
      console.warn(`[smoke-e2e] infra_fail consecutive=${consecutiveInfra}/3`)
      if (consecutiveInfra >= 3) {
        partial = true
        console.error('[smoke-e2e] STOP: 3 fallos seguidos de carga/timeout')
        break
      }
    } else {
      consecutiveInfra = 0
    }

    if (i < n && !partial) await sleep(5000)
  }

  let invalidResult = null
  if (!partial && rfcInvalid) {
    await sleep(5000)
    invalidResult = await postValidate({ baseUrl, secret, rfc: rfcInvalid, curp })
    printRunLine('invalid', 1, invalidResult)
    if (isInfraFailure(invalidResult.error, invalidResult.httpStatus, invalidResult.body)) {
      consecutiveInfra += 1
      if (consecutiveInfra >= 3) partial = true
    }
  }

  const avgSeconds = validRuns.length ? totalSec / validRuns.length : 0
  printSummary({ validRuns, invalidResult, partial, avgSeconds })
  if (partial) process.exitCode = 2
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
