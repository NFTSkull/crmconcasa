#!/usr/bin/env node
/**
 * Benchmark de precisión OCR CapSolver vs captcha SAT (ValidaRFC).
 * No consulta RFC real: solo mide aceptación del captcha (aparición de formMain:valRFC).
 *
 * Uso:
 *   node scripts/benchmark-captcha.js [N] [modo]
 *   N default 20; modo = raw|basic|threshold|all (default all)
 *
 * CAPSOLVER_API_KEY: process.env o integrations/sat-rfc-validator/.env (gitignored).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { preprocessCaptchaImage } from '../src/captcha-preprocess.js'
import { solveCaptcha, normalizeCaptchaOcr } from '../src/captcha-solver.js'

const RFC_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf'
const REFRESH_SELECTOR = 'a:has(img[src*="reloadCaptcha"]), img[src*="reloadCaptcha"]'
const PATTERN = new RegExp(process.env.CAPTCHA_PATTERN || '^[A-Za-z0-9]{5}$')
const INTEGRATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

class SatInfraAbort extends Error {
  constructor(message) {
    super(message)
    this.name = 'SatInfraAbort'
  }
}

/** Lectura manual de .env (sin dependencia dotenv). No sobrescribe vars ya definidas. */
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

function parseArgs(argv) {
  const n = Math.max(1, Number(argv[2] || 20))
  const modeArg = String(argv[3] || 'all').toLowerCase()
  const modes = modeArg === 'all' ? ['raw', 'basic', 'threshold'] : [modeArg]
  return { n, modes }
}

function noteInfraOk(infra) {
  infra.consecutiveFails = 0
}

function noteInfraFail(infra, err) {
  infra.consecutiveFails += 1
  const msg = err instanceof Error ? err.message : String(err)
  console.warn(`[benchmark] infra_fail consecutive=${infra.consecutiveFails}/3 ${msg.slice(0, 200)}`)
  if (infra.consecutiveFails >= 3) {
    throw new SatInfraAbort(`SAT_INFRA_BLOCK_SUSPECTED after 3 consecutive page/timeout failures: ${msg}`)
  }
}

async function gotoCaptchaReady(page, infra) {
  try {
    await page.goto(RFC_URL, { waitUntil: 'commit', timeout: 60_000 })
    await page.locator('#captchaSession').waitFor({ state: 'visible', timeout: 30_000 })
    noteInfraOk(infra)
  } catch (err) {
    noteInfraFail(infra, err)
    throw err
  }
}

async function refreshOrReload(page, infra) {
  const captcha = page.locator('#captchaSession')
  const before = await captcha.getAttribute('src').catch(() => null)
  const refresh = page.locator(REFRESH_SELECTOR).first()
  if ((await refresh.count()) > 0) {
    try {
      await refresh.click()
      await page.waitForFunction(
        (prev) => {
          const el = document.querySelector('#captchaSession')
          const src = el?.getAttribute('src') || ''
          return Boolean(src) && src !== prev
        },
        before,
        { timeout: 10_000 },
      )
      noteInfraOk(infra)
      return
    } catch {
      /* fallthrough a reload */
    }
  }
  await gotoCaptchaReady(page, infra)
}

async function runMode(mode, n, apiKey) {
  process.env.CAPTCHA_PREPROCESS = mode
  const outDir = path.resolve(INTEGRATION_ROOT, 'debug-sat', 'benchmark')
  await fsp.mkdir(outDir, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  })

  const stats = {
    mode,
    attempts: 0,
    filterPass: 0,
    accepted: 0,
    rejectedValid5: 0,
    solveMsTotal: 0,
    solveCount: 0,
    abortedInfra: false,
  }
  const infra = { consecutiveFails: 0 }

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: 'es-MX',
      timezoneId: 'America/Monterrey',
      deviceScaleFactor: 3,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })
    const page = await context.newPage()
    await gotoCaptchaReady(page, infra)

    for (let i = 1; i <= n; i += 1) {
      try {
        stats.attempts += 1
        const image = page.locator('#captchaSession')
        const rawPng = await image.screenshot({ timeout: 30_000 })
        const png = await preprocessCaptchaImage(rawPng, mode)

        const t0 = Date.now()
        let ocr = ''
        try {
          ocr = await solveCaptcha(png, { apiKey, websiteURL: RFC_URL })
        } catch (err) {
          console.warn(`[benchmark] mode=${mode} i=${i} solve_error=${err instanceof Error ? err.message : 'unknown'}`)
          ocr = ''
        }
        const solveMs = Date.now() - t0
        stats.solveMsTotal += solveMs
        stats.solveCount += 1

        const text = normalizeCaptchaOcr(ocr)
        const passes = PATTERN.test(text)
        if (passes) stats.filterPass += 1

        let accepted = false
        if (passes) {
          await page.locator('[name="formMain:captchaInput"]').fill(text)
          await page.getByRole('button', { name: /^Aceptar$/i }).click()
          await page.waitForTimeout(800)
          accepted = await page.locator('[name="formMain:valRFC"]').isVisible().catch(() => false)
          if (accepted) {
            stats.accepted += 1
            await gotoCaptchaReady(page, infra)
          } else {
            stats.rejectedValid5 += 1
            await refreshOrReload(page, infra)
          }
        } else {
          await refreshOrReload(page, infra)
        }

        const safeOcr = text || 'empty'
        const fname = `${mode}-i${String(i).padStart(2, '0')}-ocr_${safeOcr}-acc_${accepted ? 'yes' : 'no'}.png`
        await fsp.writeFile(path.join(outDir, fname), png)

        console.log(
          `[benchmark] mode=${mode} i=${i}/${n} ocrLen=${text.length} filter=${passes} accepted=${accepted} ms=${solveMs}`,
        )

        await sleep(3000 + Math.floor(Math.random() * 2000))
      } catch (err) {
        if (err instanceof SatInfraAbort) {
          stats.abortedInfra = true
          console.error(`[benchmark] STOP mode=${mode} reason=${err.message}`)
          break
        }
        // Fallo de página/timeout ya contado en noteInfraFail (<3): reintentar carga y seguir
        console.warn(`[benchmark] mode=${mode} i=${i} page_error; reintentando carga`)
        try {
          await gotoCaptchaReady(page, infra)
        } catch (err2) {
          if (err2 instanceof SatInfraAbort) {
            stats.abortedInfra = true
            console.error(`[benchmark] STOP mode=${mode} reason=${err2.message}`)
            break
          }
        }
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return stats
}

function printTable(rows, { partial = false } = {}) {
  const headers = [
    'mode',
    'intentos',
    'filtro_ok',
    'aceptadas',
    'rechazados_5_validos',
    'aceptacion_%',
    'ms_promedio',
    'abort_infra',
  ]
  const lines = [headers.join('\t')]
  for (const s of rows) {
    const pct = s.attempts ? ((s.accepted / s.attempts) * 100).toFixed(1) : '0.0'
    const avg = s.solveCount ? Math.round(s.solveMsTotal / s.solveCount) : 0
    lines.push([
      s.mode,
      s.attempts,
      s.filterPass,
      s.accepted,
      s.rejectedValid5,
      pct,
      avg,
      s.abortedInfra ? 'yes' : 'no',
    ].join('\t'))
  }
  console.log(partial ? '\n=== BENCHMARK CAPTCHA SAT (PARCIAL — posible bloqueo IP) ===' : '\n=== BENCHMARK CAPTCHA SAT ===')
  console.log(lines.join('\n'))
}

async function main() {
  loadLocalEnvFile()
  const apiKey = process.env.CAPSOLVER_API_KEY
  if (!apiKey) {
    console.error('CAPSOLVER_API_KEY required (env o integrations/sat-rfc-validator/.env)')
    process.exit(1)
  }
  const { n, modes } = parseArgs(process.argv)
  const rows = []
  let partial = false
  for (const mode of modes) {
    console.log(`\n--- mode=${mode} n=${n} ---`)
    const stats = await runMode(mode, n, apiKey)
    rows.push(stats)
    if (stats.abortedInfra) {
      partial = true
      break
    }
  }
  printTable(rows, { partial })
  if (partial) process.exitCode = 2
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
