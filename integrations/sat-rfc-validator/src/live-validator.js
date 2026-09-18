import { chromium } from 'playwright'
import { solveImageCaptcha } from './capsolver.js'
import { classifyRfcSatText, classifyCurpSatText } from './sat-results.js'

const RFC_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf'
const CURP_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ConsultaIdCSIAT/'
const STEP_TIMEOUT = 20_000

async function solveCaptchaOnPage(page, imageSelector, inputSelector, apiKey) {
  const image = page.locator(imageSelector)
  await image.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  const png = await image.screenshot()
  const text = await solveImageCaptcha(png, apiKey)
  await page.locator(inputSelector).fill(text)
}

async function validateRfc(page, rfc, apiKey) {
  await page.goto(RFC_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await solveCaptchaOnPage(page, '#captchaSession', '[name="formMain:captchaInput"]', apiKey)
    await page.getByRole('button', { name: /^Aceptar$/i }).click()
    try {
      await page.locator('[name="formMain:valRFC"]').waitFor({ state: 'visible', timeout: 10_000 })
      break
    } catch {
      if (attempt === 3) throw new Error('SAT_RFC_CAPTCHA_NOT_ACCEPTED')
    }
  }

  await page.locator('[name="formMain:valRFC"]').fill(rfc)
  await page.locator('[id="formMain:consulta"]').click()
  await page.locator('[id="formMain:pnlResulRFC"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  const formText = await page.locator('#formMain').innerText()
  const status = classifyRfcSatText(formText)
  const successText = status === 'valid'
    ? await page.locator('#formMain\\:messageConsultaRFCExito .ui-messages-info-summary').innerText().catch(() => '')
    : ''
  return { status, evidence: successText || null }
}

async function validateCurp(page, curp, apiKey) {
  await page.goto(CURP_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('input[name="formapp:tipo"][value="F"]').check()
  await page.locator('input[name="formapp:doc"][value="CURP"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('input[name="formapp:doc"][value="CURP"]').check()
  await page.locator('#formapp\\:val').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('#formapp\\:val').fill(curp)
  await solveCaptchaOnPage(page, '#captchaSession', 'input[name="formapp:j_idt34:captcha"]', apiKey)
  await page.getByRole('button', { name: /^Consultar$/i }).click()
  await page.waitForLoadState('domcontentloaded', { timeout: STEP_TIMEOUT }).catch(() => {})
  await page.waitForTimeout(500)
  const bodyText = await page.locator('body').innerText()
  const status = classifyCurpSatText(bodyText)
  return {
    status,
    evidence: status === 'valid' ? 'Registrado en el padrón de contribuyentes' : null,
  }
}

export async function validateFiscalLive({ rfc, curp, capsolverApiKey }) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
  })
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: 'es-MX',
      timezoneId: 'America/Monterrey',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
