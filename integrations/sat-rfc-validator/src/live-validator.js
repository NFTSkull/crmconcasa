import { chromium } from 'playwright'
import { solveImageCaptcha } from './capsolver.js'
import { classifyRfcSatText, classifyCurpSatText } from './sat-results.js'

const RFC_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf'
const CURP_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ConsultaIdCSIAT/'
const STEP_TIMEOUT = 20_000
const NAV_TIMEOUT = 60_000

function buildProxyConfig() {
  const server = String(process.env.PROXY_URL || '').trim()
  const password = String(process.env.PROXY_PASS || '').trim()
  if (!server || !password) return undefined

  const country = String(process.env.PROXY_COUNTRY || 'mx').trim().toLowerCase() || 'mx'
  const sessionId = `sat${Date.now()}${Math.random().toString(36).slice(2, 8)}`
  console.log(`[sat-validator] PROXY_ENABLED country=${country}`)
  return {
    server,
    username: `grecojcwy1-country-${country}-session-${sessionId}`,
    password,
  }
}

async function navigateSatPage(page, url, readySelector, label) {
  let lastError = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: NAV_TIMEOUT })
      await page.locator(readySelector).waitFor({ state: 'visible', timeout: 30_000 })
      console.log(`[sat-validator] ${label}_PAGE_READY attempt=${attempt}`)
      return
    } catch (error) {
      lastError = error
      console.warn(`[sat-validator] ${label}_PAGE_RETRY attempt=${attempt} reason=${error instanceof Error ? error.name : 'unknown'}`)
      if (attempt < 2) await page.waitForTimeout(2_000)
    }
  }
  throw lastError ?? new Error(`${label}_PAGE_NOT_READY`)
}

async function solveCaptchaOnPage(page, imageSelector, inputSelector, apiKey, label) {
  const image = page.locator(imageSelector)
  await image.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  const png = await image.screenshot()
  const text = await solveImageCaptcha(png, apiKey)
  if (!String(text ?? '').trim()) throw new Error(`${label}_CAPTCHA_EMPTY`)
  console.log(`[sat-validator] ${label}_CAPTCHA_SOLVED`)
  await page.locator(inputSelector).fill(text)
}

async function validateRfc(page, rfc, apiKey) {
  await navigateSatPage(page, RFC_URL, '#captchaSession', 'RFC')

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await solveCaptchaOnPage(page, '#captchaSession', '[name="formMain:captchaInput"]', apiKey, 'RFC')
    await page.getByRole('button', { name: /^Aceptar$/i }).click()
    try {
      await page.locator('[name="formMain:valRFC"]').waitFor({ state: 'visible', timeout: 10_000 })
      console.log(`[sat-validator] RFC_CAPTCHA_ACCEPTED attempt=${attempt}`)
      break
    } catch {
      console.warn(`[sat-validator] RFC_CAPTCHA_REJECTED attempt=${attempt}`)
      if (attempt === 3) throw new Error('SAT_RFC_CAPTCHA_NOT_ACCEPTED')
    }
  }

  await page.locator('[name="formMain:valRFC"]').fill(rfc)
  console.log('[sat-validator] RFC_FIELD_FILLED')
  await page.locator('[id="formMain:consulta"]').click()
  await page.locator('[id="formMain:pnlResulRFC"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  const formText = await page.locator('#formMain').innerText()
  const status = classifyRfcSatText(formText)
  console.log(`[sat-validator] RFC_RESULT status=${status}`)
  const successText = status === 'valid'
    ? await page.locator('#formMain\\:messageConsultaRFCExito .ui-messages-info-summary').innerText().catch(() => '')
    : ''
  return { status, evidence: successText || null }
}

async function validateCurp(page, curp, apiKey) {
  await navigateSatPage(page, CURP_URL, 'input[name="formapp:tipo"][value="F"]', 'CURP')
  await page.locator('input[name="formapp:tipo"][value="F"]').check()
  await page.locator('input[name="formapp:doc"][value="CURP"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('input[name="formapp:doc"][value="CURP"]').check()
  await page.locator('#formapp\\:val').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('#formapp\\:val').fill(curp)
  console.log('[sat-validator] CURP_FIELD_FILLED')
  await solveCaptchaOnPage(page, '#captchaSession', 'input[name="formapp:j_idt34:captcha"]', apiKey, 'CURP')
  await page.getByRole('button', { name: /^Consultar$/i }).click()
  console.log('[sat-validator] CURP_CAPTCHA_SUBMITTED')
  await page.waitForLoadState('domcontentloaded', { timeout: STEP_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(500)
  const bodyText = await page.locator('body').innerText()
  const status = classifyCurpSatText(bodyText)
  console.log(`[sat-validator] CURP_RESULT status=${status}`)
  return {
    status,
    evidence: status === 'valid' ? 'Registrado en el padrón de contribuyentes' : null,
  }
}

export async function validateFiscalLive({ rfc, curp, capsolverApiKey }) {
  const proxy = buildProxyConfig()
  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-http2', '--ignore-certificate-errors'],
  })
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      proxy,
      locale: 'es-MX',
      timezoneId: 'America/Monterrey',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'es-MX,es;q=0.9' },
    })
    const page = await context.newPage()
    const rfcResult = await validateRfc(page, rfc, capsolverApiKey)
    if (rfcResult.status !== 'valid') {
      return {
        ok: false,
        semantic: rfcResult.status === 'invalid' ? 'invalid' : 'retry',
        rfc: rfcResult,
        curp: { status: 'not_run', evidence: null },
      }
    }
    const curpResult = await validateCurp(page, curp, capsolverApiKey)
    return {
      ok: curpResult.status === 'valid',
      semantic: curpResult.status === 'valid' ? 'pass' : curpResult.status === 'invalid' ? 'invalid' : 'retry',
      rfc: rfcResult,
      curp: curpResult,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}
