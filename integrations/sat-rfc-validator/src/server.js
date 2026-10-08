import express from 'express'
import PQueue from 'p-queue'
import { validateRequestPayload, fixtureValidationResult } from './contracts.js'
import { probeSatRfcPageLoad, validateFiscalLive } from './live-validator.js'
import { satProxyPresence } from './proxy-config.js'
import { solveImageCaptcha } from './capsolver.js'

const PORT = Number(process.env.PORT || 3002)

function currentMode() {
  return String(process.env.SAT_VALIDATOR_MODE || 'fixture').toLowerCase() === 'live'
    ? 'live'
    : 'fixture'
}

function currentSecret() {
  return String(process.env.SAT_VALIDATOR_SECRET || '').trim()
}

function captchaRelaySecret() {
  return String(process.env.CAPTCHA_RELAY_SECRET || '').trim()
}

/** present/absent — nunca valores de secretos. */
export function buildHealthPayload() {
  return {
    ok: true,
    mode: currentMode(),
    CAPSOLVER_API_KEY: String(process.env.CAPSOLVER_API_KEY || '').trim()
      ? 'present'
      : 'absent',
    SAT_VALIDATOR_SECRET: currentSecret() ? 'present' : 'absent',
    CAPTCHA_RELAY_SECRET: captchaRelaySecret() ? 'present' : 'absent',
    proxy: satProxyPresence(),
  }
}

export function createApp(options = {}) {
  const probeSat = options.probeSat ?? probeSatRfcPageLoad
  const validateLive = options.validateLive ?? validateFiscalLive
  const solveCaptcha = options.solveCaptcha ?? solveImageCaptcha
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  const queue = new PQueue({
    concurrency: Math.max(1, Number(process.env.SAT_MAX_CONCURRENCY || 1)),
  })

  function requireWorkerSecret(req, res) {
    const secret = currentSecret()
    if (!secret || req.header('x-concasa-worker-secret') !== secret) {
      res.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
      return false
    }
    return true
  }

  app.get('/health', (_req, res) => {
    res.json(buildHealthPayload())
  })

  /**
   * Relay interno para resolver el CAPTCHA visual del portal de precalificación.
   * No recibe NSS, RFC, CURP ni credenciales: únicamente una imagen base64.
   * Permite reutilizar la llave de CapSolver del validador SAT sin copiarla
   * entre servicios.
   */
  app.post('/internal/solve-image-captcha', async (req, res) => {
    const secret = captchaRelaySecret()
    if (!secret || req.header('x-captcha-relay-secret') !== secret) {
      return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
    }

    const imageBase64 =
      typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64.trim() : ''
    const websiteURL =
      typeof req.body?.websiteURL === 'string' ? req.body.websiteURL.trim() : ''

    if (
      !imageBase64 ||
      imageBase64.length > 220_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)
    ) {
      return res.status(400).json({ ok: false, code: 'INVALID_IMAGE' })
    }

    try {
      const imageBytes = Buffer.from(imageBase64, 'base64')
      if (imageBytes.length < 64 || imageBytes.length > 160_000) {
        return res.status(400).json({ ok: false, code: 'INVALID_IMAGE_SIZE' })
      }
      const text = await solveCaptcha(imageBytes, process.env.CAPSOLVER_API_KEY, {
        websiteURL: websiteURL || undefined,
      })
      const normalized = String(text || '').trim().toUpperCase()
      if (!/^[A-Z0-9]{5}$/.test(normalized)) {
        return res.status(422).json({ ok: false, code: 'INVALID_CAPTCHA_RESULT' })
      }
      return res.json({ ok: true, text: normalized })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[sat-validator] captcha relay failed', message)
      return res.status(503).json({
        ok: false,
        code: message.includes('ERROR_KEY_DENIED_ACCESS')
          ? 'CAPSOLVER_KEY_DENIED'
          : 'CAPTCHA_SOLVER_FAILED',
      })
    }
  })

  /**
   * Abre la página RFC del SAT hasta #captchaSession.
   * No resuelve captcha ni consulta RFC. Sin datos de clientes.
   */
  app.get('/diagnostics/sat', async (req, res) => {
    if (!requireWorkerSecret(req, res)) return
    try {
      const result = await probeSat()
      return res.status(result.ok ? 200 : 503).json({
        ok: result.ok,
        loadMs: result.loadMs,
        error: result.error,
        proxy: result.proxy ?? (satProxyPresence() === 'present' ? 'used' : 'direct'),
        sessionsUsed: result.sessionsUsed ?? null,
        resourcesBlocked: result.resourcesBlocked ?? null,
        networkBytes: result.networkBytes ?? null,
        networkMb: result.networkMb ?? null,
      })
    } catch (error) {
      return res.status(503).json({
        ok: false,
        loadMs: null,
        error: error instanceof Error ? error.message : String(error),
        proxy: satProxyPresence() === 'present' ? 'used' : 'direct',
        sessionsUsed: null,
        resourcesBlocked: null,
      })
    }
  })

  app.post('/validate', async (req, res) => {
    if (!requireWorkerSecret(req, res)) return
    const parsed = validateRequestPayload(req.body)
    if (!parsed.ok) return res.status(400).json(parsed)

    return queue.add(async () => {
      try {
        if (currentMode() !== 'live') {
          return res.json(fixtureValidationResult(parsed.fixtureScenario || 'all_valid'))
        }
        if (parsed.fixtureScenario) {
          return res.status(400).json({ ok: false, code: 'FIXTURE_DISABLED_IN_LIVE' })
        }
        const result = await validateLive({
          rfc: parsed.rfc,
          curp: parsed.curp,
          capsolverApiKey: process.env.CAPSOLVER_API_KEY,
        })
        return res.json(result)
      } catch (error) {
        console.error(
          '[sat-validator] job failed',
          error instanceof Error ? error.message : 'unknown',
        )
        return res.status(503).json({
          ok: false,
          semantic: 'retry',
          code: 'TECHNICAL_FAILURE',
          rfc: { status: 'unknown', evidence: null },
          curp: { status: 'not_run', evidence: null },
        })
      }
    })
  })

  return app
}

const app = createApp()

if (process.env.SAT_VALIDATOR_NO_LISTEN !== '1') {
  app.listen(PORT, '0.0.0.0', () => {
    const health = buildHealthPayload()
    console.log(
      `[sat-validator] listening port=${PORT} mode=${health.mode} CAPSOLVER_API_KEY=${health.CAPSOLVER_API_KEY} SAT_VALIDATOR_SECRET=${health.SAT_VALIDATOR_SECRET} CAPTCHA_RELAY_SECRET=${health.CAPTCHA_RELAY_SECRET}`,
    )
  })
}

export { app }
