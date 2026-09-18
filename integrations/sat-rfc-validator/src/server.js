import express from 'express'
import PQueue from 'p-queue'
import { validateRequestPayload, fixtureValidationResult } from './contracts.js'
import { validateFiscalLive } from './live-validator.js'

const app = express()
app.use(express.json({ limit: '32kb' }))

const PORT = Number(process.env.PORT || 3002)
const MODE = String(process.env.SAT_VALIDATOR_MODE || 'fixture').toLowerCase()
const SECRET = String(process.env.SAT_VALIDATOR_SECRET || '')
const queue = new PQueue({ concurrency: Math.max(1, Number(process.env.SAT_MAX_CONCURRENCY || 1)) })
let publicSampleE2eConsumed = false
let realExpedienteE2eConsumed = false

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: MODE === 'live' ? 'live' : 'fixture' })
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
      const result = await validateFiscalLive({
        rfc: parsed.rfc,
        curp: parsed.curp,
        capsolverApiKey: process.env.CAPSOLVER_API_KEY,
      })
      return res.json(result)
    } catch (error) {
      console.error('[sat-validator] job failed', error instanceof Error ? error.message : 'unknown')
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

// TEMP ONE-SHOT E2E ONLY: official SAT guide example; remove before merge.
app.get('/e2e-public-sat-example-20260917-once', async (_req, res) => {
  if (MODE !== 'live') {
    return res.status(409).json({ ok: false, code: 'LIVE_MODE_REQUIRED' })
  }
  if (publicSampleE2eConsumed) {
    return res.status(410).json({ ok: false, code: 'E2E_ALREADY_CONSUMED' })
  }
  publicSampleE2eConsumed = true

  return queue.add(async () => {
    try {
      console.log('[sat-validator] PUBLIC_SAMPLE_E2E_START')
      const result = await validateFiscalLive({
        rfc: 'GAGD841118JT8',
        curp: 'GAGD841118MGTRML03',
        capsolverApiKey: process.env.CAPSOLVER_API_KEY,
      })
      console.log(`[sat-validator] PUBLIC_SAMPLE_E2E_DONE semantic=${result.semantic}`)
      return res.json({
        ok: result.ok,
        semantic: result.semantic,
        rfc: {
          status: result.rfc?.status ?? null,
          evidencePresent: Boolean(result.rfc?.evidence),
        },
        curp: {
          status: result.curp?.status ?? null,
          evidencePresent: Boolean(result.curp?.evidence),
        },
        writesProduction: false,
        piiReturned: false,
      })
    } catch (error) {
      console.error('[sat-validator] PUBLIC_SAMPLE_E2E_ERROR', error instanceof Error ? error.message : 'unknown')
      return res.status(503).json({
        ok: false,
        semantic: 'retry',
        code: 'TECHNICAL_FAILURE',
        rfc: { status: 'unknown', evidencePresent: false },
        curp: { status: 'not_run', evidencePresent: false },
        writesProduction: false,
        piiReturned: false,
      })
    }
  })
})

// TEMP ONE-SHOT E2E ONLY: real paid expediente values supplied only via temporary Railway env vars.
app.get('/e2e-real-expediente-20260917-once', async (_req, res) => {
  if (MODE !== 'live') {
    return res.status(409).json({ ok: false, code: 'LIVE_MODE_REQUIRED' })
  }
  if (realExpedienteE2eConsumed) {
    return res.status(410).json({ ok: false, code: 'E2E_ALREADY_CONSUMED' })
  }

  const nss = String(process.env.E2E_REAL_NSS || '').trim()
  const rfc = String(process.env.E2E_REAL_RFC || '').trim().toUpperCase()
  const curp = String(process.env.E2E_REAL_CURP || '').trim().toUpperCase()
  if (!/^\\d{11}$/.test(nss) || !/^[A-ZÑ&]{4}\\d{6}[A-Z0-9]{3}$/u.test(rfc) || !/^[A-Z0-9]{18}$/.test(curp)) {
    return res.status(409).json({ ok: false, code: 'E2E_REAL_DATA_NOT_CONFIGURED' })
  }

  realExpedienteE2eConsumed = true
  return queue.add(async () => {
    try {
      console.log('[sat-validator] REAL_EXPEDIENTE_E2E_START nssPresent=true')
      const result = await validateFiscalLive({
        rfc,
        curp,
        capsolverApiKey: process.env.CAPSOLVER_API_KEY,
      })
      console.log(`[sat-validator] REAL_EXPEDIENTE_E2E_DONE semantic=${result.semantic}`)
      return res.json({
        ok: result.ok,
        semantic: result.semantic,
        rfc: {
          status: result.rfc?.status ?? null,
          evidencePresent: Boolean(result.rfc?.evidence),
        },
        curp: {
          status: result.curp?.status ?? null,
          evidencePresent: Boolean(result.curp?.evidence),
        },
        nssPresent: true,
        writesProduction: false,
        enviarAMesaCalled: false,
        piiReturned: false,
      })
    } catch (error) {
      console.error('[sat-validator] REAL_EXPEDIENTE_E2E_ERROR', error instanceof Error ? error.message : 'unknown')
      return res.status(503).json({
        ok: false,
        semantic: 'retry',
        code: 'TECHNICAL_FAILURE',
        rfc: { status: 'unknown', evidencePresent: false },
        curp: { status: 'not_run', evidencePresent: false },
        nssPresent: true,
        writesProduction: false,
        enviarAMesaCalled: false,
        piiReturned: false,
      })
    }
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sat-validator] listening port=${PORT} mode=${MODE === 'live' ? 'live' : 'fixture'}`)
})
