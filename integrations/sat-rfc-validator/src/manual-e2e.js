import express from 'express'
import { chromium } from 'playwright'
import { classifyRfcSatText, classifyCurpSatText } from './sat-results.js'
import { buildPlaywrightProxy } from './runtime-config.js'

const app = express()
app.use(express.urlencoded({ extended: false }))

const PORT = Number(process.env.PORT || 3002)
const TOKEN = String(process.env.MANUAL_E2E_TOKEN || '')
const RFC = String(process.env.E2E_REAL_RFC || '').trim().toUpperCase()
const CURP = String(process.env.E2E_REAL_CURP || '').trim().toUpperCase()

const RFC_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf'
const CURP_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ConsultaIdCSIAT/'
const STEP_TIMEOUT = 20_000

let flow = {
  browser: null,
  page: null,
  stage: 'idle',
  captcha: null,
  message: null,
  rfc: null,
  curp: null,
}

function authorized(req) {
  return Boolean(TOKEN) && String(req.query.key || req.body?.key || '') === TOKEN
}

function pageHtml(content) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ConCasa SAT E2E</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#111;color:#eee;margin:0;padding:32px}
.card{max-width:620px;margin:0 auto;background:#1d1d1d;border:1px solid #333;border-radius:16px;padding:24px}
h1{margin-top:0} img{background:#fff;padding:8px;border-radius:8px;max-width:100%}
input{font-size:22px;text-transform:uppercase;letter-spacing:4px;padding:10px;width:180px}
button{font-size:16px;padding:10px 16px;margin-left:8px}
.ok{color:#7ee787}.warn{color:#ffcf70}.muted{color:#aaa;font-size:14px}
code{background:#2b2b2b;padding:2px 6px;border-radius:4px}
</style>
</head>
<body><div class="card">${content}</div></body></html>`
}

async function closeFlowBrowser() {
  if (flow.browser) await flow.browser.close().catch(() => {})
  flow.browser = null
  flow.page = null
}

async function captureCaptcha(selector) {
  const image = flow.page.locator(selector)
  await image.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  flow.captcha = await image.screenshot()
}

async function startRfc() {
  await closeFlowBrowser()
  flow = { browser: null, page: null, stage: 'starting', captcha: null, message: null, rfc: null, curp: null }

  if (!/^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(RFC) || !/^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(CURP)) {
    throw new Error('E2E_INPUT_INVALID')
  }

  const browser = await chromium.launch({
    headless: true,
    proxy: buildPlaywrightProxy(process.env),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  })
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    locale: 'es-MX',
    timezoneId: 'America/Monterrey',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  flow.browser = browser
  flow.page = page

  await page.goto(RFC_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await captureCaptcha('#captchaSession')
  flow.stage = 'rfc_captcha'
  flow.message = 'Captura los 5 caracteres mostrados por SAT.'
  console.log('[sat-manual-e2e] RFC_CAPTCHA_READY writesProduction=false piiLogged=false')
}

async function prepareCurp() {
  const page = flow.page
  await page.goto(CURP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('input[name="formapp:tipo"][value="F"]').check()
  await page.locator('input[name="formapp:doc"][value="CURP"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('input[name="formapp:doc"][value="CURP"]').check()
  await page.locator('#formapp\\:val').fill(CURP)
  await captureCaptcha('#captchaSession')
  flow.stage = 'curp_captcha'
  flow.message = 'RFC consultado. Captura ahora los 5 caracteres del CAPTCHA de CURP.'
  console.log('[sat-manual-e2e] CURP_CAPTCHA_READY')
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: 'manual_e2e', writesProduction: false, piiReturned: false })
})

app.get('/e2e', async (req, res) => {
  if (!authorized(req)) return res.status(404).end()
  const key = encodeURIComponent(TOKEN)

  if (flow.stage === 'idle') {
    return res.send(pageHtml(`
      <h1>Prueba SAT E2E</h1>
      <p>Usará un expediente real sólo como entrada. <strong>No escribe en CRM.</strong></p>
      <form method="post" action="/e2e/start?key=${key}">
        <button type="submit">Iniciar validación</button>
      </form>
      <p class="muted">RFC/CURP no se muestran ni se imprimen en logs.</p>
    `))
  }

  if (flow.stage === 'done') {
    return res.send(pageHtml(`
      <h1>Resultado E2E</h1>
      <p>RFC: <code>${flow.rfc?.status || 'unknown'}</code></p>
      <p>CURP: <code>${flow.curp?.status || 'not_run'}</code></p>
      <p class="ok">writesProduction=false · piiReturned=false</p>
    `))
  }

  if (flow.stage === 'error') {
    return res.send(pageHtml(`
      <h1>Error técnico</h1>
      <p class="warn">${flow.message || 'Error desconocido'}</p>
      <form method="post" action="/e2e/start?key=${key}">
        <button type="submit">Reintentar</button>
      </form>
    `))
  }

  return res.send(pageHtml(`
    <h1>Prueba SAT E2E</h1>
    <p>${flow.message || ''}</p>
    <img src="/e2e/captcha?key=${key}&t=${Date.now()}" alt="CAPTCHA SAT">
    <form method="post" action="/e2e/submit?key=${key}" style="margin-top:18px">
      <input name="captcha" maxlength="5" minlength="5" autocomplete="off" required pattern="[A-Za-z0-9]{5}">
      <button type="submit">Continuar</button>
    </form>
    <p class="muted">Sólo se acepta exactamente 5 caracteres alfanuméricos.</p>
  `))
})

app.get('/e2e/captcha', (req, res) => {
  if (!authorized(req) || !flow.captcha) return res.status(404).end()
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'no-store')
  return res.end(flow.captcha)
})

app.post('/e2e/start', async (req, res) => {
  if (!authorized(req)) return res.status(404).end()
  try {
    await startRfc()
  } catch (error) {
    console.error('[sat-manual-e2e] START_ERROR', error instanceof Error ? error.message : 'unknown')
    flow.stage = 'error'
    flow.message = error instanceof Error ? error.message : 'TECHNICAL_FAILURE'
  }
  return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
})

app.post('/e2e/submit', async (req, res) => {
  if (!authorized(req)) return res.status(404).end()
  const captcha = String(req.body?.captcha || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{5}$/.test(captcha)) {
    flow.message = 'El CAPTCHA debe tener exactamente 5 caracteres alfanuméricos.'
    return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
  }

  try {
    if (flow.stage === 'rfc_captcha') {
      await flow.page.locator('[name="formMain:captchaInput"]').fill(captcha)
      await flow.page.getByRole('button', { name: /^Aceptar$/i }).click()

      try {
        await flow.page.locator('[name="formMain:valRFC"]').waitFor({ state: 'visible', timeout: 10_000 })
      } catch {
        await captureCaptcha('#captchaSession')
        flow.message = 'SAT rechazó ese CAPTCHA. Intenta con la nueva imagen.'
        console.warn('[sat-manual-e2e] RFC_CAPTCHA_REJECTED')
        return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
      }

      await flow.page.locator('[name="formMain:valRFC"]').fill(RFC)
      await flow.page.locator('[id="formMain:consulta"]').click()
      await flow.page.locator('[id="formMain:pnlResulRFC"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
      const formText = await flow.page.locator('#formMain').innerText()
      const status = classifyRfcSatText(formText)
      flow.rfc = { status }
      console.log(`[sat-manual-e2e] RFC_RESULT status=${status}`)

      if (status !== 'valid') {
        flow.curp = { status: 'not_run' }
        flow.stage = 'done'
        await closeFlowBrowser()
        return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
      }

      await prepareCurp()
      return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
    }

    if (flow.stage === 'curp_captcha') {
      await flow.page.locator('input[name="formapp:j_idt34:captcha"]').fill(captcha)
      await flow.page.getByRole('button', { name: /^Consultar$/i }).click()
      await flow.page.waitForLoadState('domcontentloaded', { timeout: STEP_TIMEOUT }).catch(() => {})
      await flow.page.waitForTimeout(600)

      const bodyText = await flow.page.locator('body').innerText()
      const status = classifyCurpSatText(bodyText)
      flow.curp = { status }
      flow.stage = 'done'
      console.log(`[sat-manual-e2e] CURP_RESULT status=${status}`)
      await closeFlowBrowser()
      return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
    }

    return res.status(409).send('E2E_NOT_READY')
  } catch (error) {
    console.error('[sat-manual-e2e] SUBMIT_ERROR', error instanceof Error ? error.message : 'unknown')
    flow.stage = 'error'
    flow.message = error instanceof Error ? error.message : 'TECHNICAL_FAILURE'
    await closeFlowBrowser()
    return res.redirect('/e2e?key=' + encodeURIComponent(TOKEN))
  }
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sat-manual-e2e] listening port=${PORT} writesProduction=false piiLogged=false`)
})
