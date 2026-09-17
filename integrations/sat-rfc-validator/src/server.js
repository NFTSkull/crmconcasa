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

// TEMP E2E ONLY: official SAT guide example; remove before merge.
app.post('/e2e-public-sat-example', async (req, res) => {
  if (!SECRET || req.header('x-concasa-worker-secret') !== SECRET) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' })
  }
  if (MODE !== 'live') {
    return res.status(409).json({ ok: false, code: 'LIVE_MODE_REQUIRED' })
  }

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sat-validator] listening port=${PORT} mode=${MODE === 'live' ? 'live' : 'fixture'}`)
})
