import express from 'express'
import PQueue from 'p-queue'
import { validateRequestPayload, fixtureValidationResult } from './contracts.js'
import { validateFiscalLive } from './live-validator.js'
import { buildPlaywrightProxy, satRuntimeReadiness } from './runtime-config.js'

const app = express()
app.use(express.json({ limit: '32kb' }))

const PORT = Number(process.env.PORT || 3002)
const MODE = String(process.env.SAT_VALIDATOR_MODE || 'fixture').toLowerCase()
const SECRET = String(process.env.SAT_VALIDATOR_SECRET || '')
const queue = new PQueue({ concurrency: Math.max(1, Number(process.env.SAT_MAX_CONCURRENCY || 1)) })


function classifyTechnicalError(error) {
  const message = error instanceof Error ? String(error.message || '') : ''
  if (message === 'SAT_RFC_CAPTCHA_NOT_ACCEPTED') {
    return { code: 'RFC_CAPTCHA_REJECTED', stage: 'rfc_captcha' }
  }
  if (message === 'SAT_RFC_PAGE_TIMEOUT' || /page\.goto: Timeout|Timeout 60000ms exceeded|TimeoutError/i.test(message)) {
    return { code: 'SAT_RFC_PAGE_TIMEOUT', stage: 'rfc_page' }
  }
  if (/^CAPSOLVER_[A-Z0-9_]+$/.test(message)) {
    return { code: message, stage: 'capsolver' }
  }
  return { code: 'TECHNICAL_FAILURE', stage: 'unknown' }
}

app.get('/health', (_req, res) => {
  const readiness = satRuntimeReadiness(process.env)
  return res.status(readiness.ok ? 200 : 503).json(readiness)
})

app.post('/validate', async (req, res) => {
  if (!SECRET || req.header('x-concasa-worker-secret') !== SECRET) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
  }
  const parsed = validateRequestPayload(req.body)
  if (!parsed.ok) return res.status(400).json(parsed)

  return queue.add(async () => {
    try {
      if (MODE !== 'live') {
        return res.json(fixtureValidationResult(parsed.fixtureScenario || 'all_valid'))
      }
      if (parsed.fixtureScenario) {
        return res.status(400).json({ ok: false, code: 'FIXTURE_DISABLED_IN_LIVE' })
      }
      const readiness = satRuntimeReadiness(process.env)
      if (!readiness.ok) {
        return res.status(503).json({
          ok: false,
          semantic: 'retry',
          code: 'SAT_RUNTIME_NOT_READY',
          rfc: { status: 'unknown', evidence: null },
          curp: { status: 'not_run', evidence: null },
        })
      }

      const result = await validateFiscalLive({
        rfc: parsed.rfc,
        curp: parsed.curp,
        capsolverApiKey: process.env.CAPSOLVER_API_KEY,
        proxy: buildPlaywrightProxy(process.env),
      })
      return res.json(result)
    } catch (error) {
      const failure = classifyTechnicalError(error)
      console.error(`[sat-validator] job failed code=${failure.code} stage=${failure.stage}`)
      return res.status(503).json({
        ok: false,
        semantic: 'retry',
        code: failure.code,
        stage: failure.stage,
        rfc: { status: 'unknown', evidence: null },
        curp: { status: 'not_run', evidence: null },
      })
    }
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sat-validator] listening port=${PORT} mode=${MODE === 'live' ? 'live' : 'fixture'}`)
})
