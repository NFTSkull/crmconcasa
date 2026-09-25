import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { solveCaptcha } from './captcha-solver.js'
import { preprocessCaptchaImage } from './captcha-preprocess.js'
import { classifyRfcSatText, classifyCurpSatText, isCaptchaRejectedText } from './sat-results.js'
import {
  buildSatProxyConfig,
  isProxyOrNetworkError,
  maxProxySessions,
  newProxySessionId,
  planProxySessionRetry,
  proxyNetworkErrorType,
  proxySafeSummary,
  requestBudgetMs,
  satProxyPresence,
} from './proxy-config.js'

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
/** Mínimo ms restantes para abrir otra sesión de proxy. */
const MIN_MS_FOR_NEW_SESSION = 8_000

/**
 * @param {{ sessionId?: string, sessionNum?: number }} [opts]
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchSatBrowser(opts = {}) {
  const proxy = buildSatProxyConfig(opts)
  const summary = proxySafeSummary(proxy)
  const sessionNum = opts.sessionNum ?? 1
  if (summary.used) {
    console.log(
      `[sat-validator] PROXY present session=${sessionNum}/${maxProxySessions()} host=${summary.serverHost} sessionHint=${summary.sessionHint}`,
    )
  } else {
    console.log(`[sat-validator] PROXY absent (direct) session=${sessionNum}`)
  }
  /** @type {import('playwright').LaunchOptions} */
  const launchOpts = {
    headless: true,
    args: LAUNCH_ARGS,
  }
  if (proxy) {
    launchOpts.proxy = {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    }
  }
  return chromium.launch(launchOpts)
}

const RFC_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf'
const CURP_URL = 'https://agsc.siat.sat.gob.mx/PTSC/ConsultaIdCSIAT/'
const STEP_TIMEOUT = 20_000
const NAV_TIMEOUT = 45_000
const REFRESH_SELECTOR = 'a:has(img[src*="reloadCaptcha"]), img[src*="reloadCaptcha"]'

function debugSatEnabled() {
  const v = String(process.env.DEBUG_SAT || '').toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function captchaPattern() {
  return new RegExp(process.env.CAPTCHA_PATTERN || '^[A-Za-z0-9]{5}$')
}

function maxSolveAttempts() {
  return Math.max(1, Number(process.env.CAPTCHA_MAX_SOLVE_ATTEMPTS || 5))
}

function maxSubmitAttempts() {
  return Math.max(1, Number(process.env.CAPTCHA_MAX_SUBMIT_ATTEMPTS || 3))
}

function emptyCaptchaMetrics() {
  return { solveAttempts: 0, submitAttempts: 0, refreshes: 0 }
}

async function ensureDebugDir(...parts) {
  const dir = path.resolve('debug-sat', ...parts)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function collectVisibleSatErrors(page) {
  return page.evaluate(() => {
    const texts = []
    for (const el of document.querySelectorAll('.ui-messages-error, .ui-message-error, .ui-messages-error-summary, .ui-message-error-detail, .ui-messages-warn, .alert')) {
      const t = (el.innerText || '').trim()
      if (t) texts.push(t)
    }
    const input = document.querySelector('input[name="formMain:captchaInput"], input[name*="captcha"]')
    if (input) {
      let p = input.parentElement
      for (let i = 0; i < 4 && p; i += 1, p = p.parentElement) {
        for (const span of p.querySelectorAll('span, label, .ui-message')) {
          const t = (span.innerText || '').trim()
          if (t && /obligatorio|correcto|captcha|código|codigo|imagen|coincidir|caracteres/i.test(t) && t.length < 200) {
            texts.push(t)
          }
        }
      }
    }
    return [...new Set(texts)]
  })
}

async function saveDebugAfterSubmit(page, label, attempt) {
  if (!debugSatEnabled()) return
  const dir = await ensureDebugDir()
  const stamp = `${label.toLowerCase()}-after-submit-${attempt}-${Date.now()}`
  await page.screenshot({ path: path.join(dir, `${stamp}.png`), fullPage: true }).catch(() => {})
  const errors = await collectVisibleSatErrors(page)
  if (errors.length) {
    await fs.writeFile(path.join(dir, `${stamp}-errors.txt`), errors.join('\n'), 'utf8').catch(() => {})
    console.log(`[sat-validator] DEBUG_SAT ${label}_SAT_ERRORS count=${errors.length}`)
    for (const err of errors) {
      console.log(`[sat-validator] DEBUG_SAT sat_error=${err.slice(0, 200)}`)
    }
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {string} readySelector
 * @param {string} label
 * @param {{ navTimeoutMs?: number, readyTimeoutMs?: number }} [opts]
 */
async function navigateSatPage(page, url, readySelector, label, opts = {}) {
  const navTimeout = Math.max(5_000, opts.navTimeoutMs ?? NAV_TIMEOUT)
  const readyTimeout = Math.max(3_000, opts.readyTimeoutMs ?? 30_000)
  let lastError = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: navTimeout })
      await page.locator(readySelector).waitFor({ state: 'visible', timeout: readyTimeout })
      console.log(`[sat-validator] ${label}_PAGE_READY attempt=${attempt}`)
      return
    } catch (error) {
      lastError = error
      const errType = proxyNetworkErrorType(error)
      console.warn(
        `[sat-validator] ${label}_PAGE_RETRY attempt=${attempt} errorType=${errType}`,
      )
      // Proxy/red: no reintentar misma IP; el caller rota sesión.
      if (isProxyOrNetworkError(error)) throw error
      if (attempt < 2) await page.waitForTimeout(2_000)
    }
  }
  throw lastError ?? new Error(`${label}_PAGE_NOT_READY`)
}

async function refreshCaptchaImage(page) {
  const captcha = page.locator('#captchaSession')
  await captcha.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  const before = await captcha.getAttribute('src')
  const refresh = page.locator(REFRESH_SELECTOR).first()
  if ((await refresh.count()) === 0) return false
  await refresh.click()
  try {
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('#captchaSession')
        const src = el?.getAttribute('src') || ''
        return Boolean(src) && src !== prev
      },
      before,
      { timeout: 10_000 },
    )
    return true
  } catch {
    return false
  }
}

async function bumpRefresh(metrics, page, onNeedReload) {
  const refreshed = await refreshCaptchaImage(page)
  metrics.refreshes += 1
  if (!refreshed) await onNeedReload()
}

async function solveCaptchaOnPage(page, {
  inputSelector,
  websiteURL,
  apiKey,
  label,
  onNeedReload,
  solveBudget,
  metrics,
}) {
  const pattern = captchaPattern()

  while (solveBudget.used < solveBudget.max) {
    solveBudget.used += 1
    metrics.solveAttempts = solveBudget.used
    const image = page.locator('#captchaSession')
    await image.waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
    const rawPng = await image.screenshot()
    const png = await preprocessCaptchaImage(rawPng)

    if (debugSatEnabled()) {
      const dir = await ensureDebugDir()
      const stamp = `${label.toLowerCase()}-captcha-solve${solveBudget.used}-${Date.now()}`
      await fs.writeFile(path.join(dir, `${stamp}-raw.png`), rawPng).catch(() => {})
      await fs.writeFile(path.join(dir, `${stamp}-sent.png`), png).catch(() => {})
    }

    const text = await solveCaptcha(png, { apiKey, websiteURL })
    const passes = pattern.test(text)
    console.log(
      `[sat-validator] ${label}_CAPTCHA_ATTEMPT solve=${solveBudget.used}/${solveBudget.max} ocrLen=${text.length} filter=${passes ? 'pass' : 'fail'}`,
    )
    if (debugSatEnabled()) {
      console.log(`[sat-validator] DEBUG_SAT ${label}_OCR text=${text}`)
    }

    if (!passes) {
      await bumpRefresh(metrics, page, onNeedReload)
      continue
    }

    await page.locator(inputSelector).fill(text)
    return { text }
  }

  throw new Error(`${label}_CAPTCHA_SOLVE_BUDGET_EXCEEDED`)
}

async function prepareRfcPage(page) {
  await navigateSatPage(page, RFC_URL, '#captchaSession', 'RFC')
}

async function prepareCurpPage(page, curp) {
  await navigateSatPage(page, CURP_URL, 'input[name="formapp:tipo"][value="F"]', 'CURP')
  await page.locator('input[name="formapp:tipo"][value="F"]').check()
  await page.locator('input[name="formapp:doc"][value="CURP"]').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('input[name="formapp:doc"][value="CURP"]').check()
  await page.locator('#formapp\\:val').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  await page.locator('#formapp\\:val').fill(curp)
  console.log('[sat-validator] CURP_FIELD_FILLED')
  await page.locator('#captchaSession').waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
}

async function validateRfc(page, rfc, apiKey) {
  await prepareRfcPage(page)
  const solveBudget = { used: 0, max: maxSolveAttempts() }
  const maxSubmit = maxSubmitAttempts()
  const metrics = emptyCaptchaMetrics()
  let lastCaptchaRejected = false

  for (let submit = 1; submit <= maxSubmit; submit += 1) {
    const { text } = await solveCaptchaOnPage(page, {
      inputSelector: '[name="formMain:captchaInput"]',
      websiteURL: RFC_URL,
      apiKey,
      label: 'RFC',
      solveBudget,
      metrics,
      onNeedReload: async () => {
        console.warn('[sat-validator] RFC_CAPTCHA_REFRESH_FALLBACK_RELOAD')
        await prepareRfcPage(page)
      },
    })

    metrics.submitAttempts = submit
    await page.getByRole('button', { name: /^Aceptar$/i }).click()
    await page.waitForTimeout(500)
    await saveDebugAfterSubmit(page, 'RFC', submit)

    const bodyText = await page.locator('body').innerText().catch(() => '')
    const accepted = await page.locator('[name="formMain:valRFC"]').isVisible().catch(() => false)
    lastCaptchaRejected = isCaptchaRejectedText(bodyText)

    console.log(
      `[sat-validator] RFC_CAPTCHA_SUBMIT submit=${submit}/${maxSubmit} ocrLen=${text.length} filter=pass satAccepted=${accepted} captchaRejected=${lastCaptchaRejected}`,
    )

    if (accepted) {
      console.log(`[sat-validator] RFC_CAPTCHA_ACCEPTED attempt=${submit}`)
      break
    }

    if (submit === maxSubmit) {
      if (lastCaptchaRejected) return { status: 'captcha_failed', evidence: null, captcha: metrics }
      throw new Error('SAT_RFC_CAPTCHA_NOT_ACCEPTED')
    }

    await bumpRefresh(metrics, page, async () => {
      console.warn('[sat-validator] RFC_CAPTCHA_REFRESH_FALLBACK_RELOAD')
      await prepareRfcPage(page)
    })
  }

  await page.locator('[name="formMain:valRFC"]').fill(rfc)
  console.log('[sat-validator] RFC_FIELD_FILLED')
  await page.locator('[id="formMain:consulta"]').click()
  // Válido → #formMain:pnlResulRFC; inválido/no registrado → #formMain:messageConsultaRFC
  const rfcValidPanel = page.locator('[id="formMain:pnlResulRFC"]')
  const rfcInvalidMsg = page.locator('[id="formMain:messageConsultaRFC"]')
  try {
    await rfcValidPanel.or(rfcInvalidMsg).waitFor({ state: 'visible', timeout: STEP_TIMEOUT })
  } catch (error) {
    console.warn(
      `[sat-validator] RFC_OUTCOME_TIMEOUT reason=${error instanceof Error ? error.message : 'unknown'}`,
    )
    return { status: 'unknown', evidence: null, captcha: metrics }
  }
  const formText = await page.locator('#formMain').innerText()
  const status = classifyRfcSatText(formText)
  console.log(`[sat-validator] RFC_RESULT status=${status}`)
  const successText = status === 'valid'
    ? await page.locator('#formMain\\:messageConsultaRFCExito .ui-messages-info-summary').innerText().catch(() => '')
    : ''
  const invalidText = status === 'invalid'
    ? await page.locator('[id="formMain:messageConsultaRFC"] .ui-messages-info-summary').innerText().catch(() => '')
    : ''
  return {
    status,
    evidence: successText || invalidText || null,
    captcha: metrics,
  }
}

async function validateCurp(page, curp, apiKey) {
  await prepareCurpPage(page, curp)
  const solveBudget = { used: 0, max: maxSolveAttempts() }
  const maxSubmit = maxSubmitAttempts()
  const metrics = emptyCaptchaMetrics()
  let lastCaptchaRejected = false

  for (let submit = 1; submit <= maxSubmit; submit += 1) {
    const { text } = await solveCaptchaOnPage(page, {
      inputSelector: 'input[name="formapp:j_idt34:captcha"]',
      websiteURL: CURP_URL,
      apiKey,
      label: 'CURP',
      solveBudget,
      metrics,
      onNeedReload: async () => {
        console.warn('[sat-validator] CURP_CAPTCHA_REFRESH_FALLBACK_RELOAD')
        await prepareCurpPage(page, curp)
      },
    })

    metrics.submitAttempts = submit
    await page.getByRole('button', { name: /^Consultar$/i }).click()
    console.log('[sat-validator] CURP_CAPTCHA_SUBMITTED')
    await page.waitForLoadState('domcontentloaded', { timeout: STEP_TIMEOUT }).catch(() => {})
    await page.waitForTimeout(500)
    await saveDebugAfterSubmit(page, 'CURP', submit)

    const bodyText = await page.locator('body').innerText()
    lastCaptchaRejected = isCaptchaRejectedText(bodyText)
    const status = lastCaptchaRejected ? 'captcha_failed' : classifyCurpSatText(bodyText)

    console.log(
      `[sat-validator] CURP_CAPTCHA_SUBMIT submit=${submit}/${maxSubmit} ocrLen=${text.length} filter=pass captchaRejected=${lastCaptchaRejected} status=${status}`,
    )

    if (status === 'valid' || status === 'invalid') {
      console.log(`[sat-validator] CURP_RESULT status=${status}`)
      return {
        status,
        evidence: status === 'valid' ? 'Registrado en el padrón de contribuyentes' : null,
        captcha: metrics,
      }
    }

    if (status === 'captcha_failed') {
      if (submit === maxSubmit) {
        console.log('[sat-validator] CURP_RESULT status=captcha_failed')
        return { status: 'captcha_failed', evidence: null, captcha: metrics }
      }
      await bumpRefresh(metrics, page, async () => {
        console.warn('[sat-validator] CURP_CAPTCHA_REFRESH_FALLBACK_RELOAD')
        await prepareCurpPage(page, curp)
      })
      continue
    }

    console.log(`[sat-validator] CURP_RESULT status=${status}`)
    return { status, evidence: null, captcha: metrics }
  }

  return lastCaptchaRejected
    ? { status: 'captcha_failed', evidence: null, captcha: metrics }
    : { status: 'unknown', evidence: null, captcha: metrics }
}

/**
 * Diagnóstico de red/SAT: abre la página RFC hasta #captchaSession.
 * Hasta 3 sesiones de proxy ante error de red (misma lógica que /validate).
 */
export async function probeSatRfcPageLoad() {
  const started = Date.now()
  const deadline = started + requestBudgetMs()
  const usedProxy = satProxyPresence() === 'present'
  const maxSessions = maxProxySessions()
  let sessionsUsed = 0
  let lastError = null

  for (let sessionNum = 1; sessionNum <= maxSessions; sessionNum += 1) {
    const remaining = deadline - Date.now()
    if (sessionNum > 1 && remaining < MIN_MS_FOR_NEW_SESSION) {
      console.warn(
        `[sat-validator] PROXY_SESSION_SKIP session=${sessionNum} reason=BUDGET remainingMs=${Math.max(0, remaining)}`,
      )
      break
    }
    const sessionId = usedProxy ? newProxySessionId() : undefined
    sessionsUsed = sessionNum
    let browser
    try {
      browser = await launchSatBrowser({
        sessionId,
        sessionNum,
      })
      const navTimeoutMs = Math.min(NAV_TIMEOUT, Math.max(5_000, remaining - 2_000))
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        locale: 'es-MX',
        timezoneId: 'America/Monterrey',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      })
      const page = await context.newPage()
      await navigateSatPage(page, RFC_URL, '#captchaSession', 'RFC_DIAG', {
        navTimeoutMs,
        readyTimeoutMs: Math.min(30_000, Math.max(3_000, remaining - navTimeoutMs)),
      })
      return {
        ok: true,
        loadMs: Date.now() - started,
        error: null,
        proxy: usedProxy ? 'used' : 'direct',
        sessionsUsed,
      }
    } catch (error) {
      lastError = error
      const plan = planProxySessionRetry({
        error,
        sessionNum,
        maxSessions,
        remainingMs: deadline - Date.now(),
        minMsForNewSession: MIN_MS_FOR_NEW_SESSION,
      })
      console.warn(
        `[sat-validator] PROXY_SESSION_FAIL session=${sessionNum}/${maxSessions} errorType=${plan.errorType} rotate=${plan.rotate} reason=${plan.reason}`,
      )
      if (!plan.rotate) {
        return {
          ok: false,
          loadMs: Date.now() - started,
          error: error instanceof Error ? error.message : String(error),
          proxy: usedProxy ? 'used' : 'direct',
          sessionsUsed,
        }
      }
    } finally {
      if (browser) await browser.close().catch(() => {})
    }
  }

  return {
    ok: false,
    loadMs: Date.now() - started,
    error: lastError instanceof Error ? lastError.message : String(lastError || 'PROXY_SESSIONS_EXHAUSTED'),
    proxy: usedProxy ? 'used' : 'direct',
    sessionsUsed,
  }
}

/**
 * Un intento de validación con una sola sesión de proxy (RFC+CURP).
 * @param {{ rfc: string, curp: string, capsolverApiKey?: string, sessionId?: string, sessionNum: number, deadline: number }} args
 */
async function validateFiscalLiveOnce({
  rfc,
  curp,
  capsolverApiKey,
  sessionId,
  sessionNum,
  deadline,
}) {
  const remaining = () => Math.max(0, deadline - Date.now())
  const browser = await launchSatBrowser({ sessionId, sessionNum })
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      locale: 'es-MX',
      timezoneId: 'America/Monterrey',
      deviceScaleFactor: 3,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    })
    const page = await context.newPage()
    const rfcResult = await validateRfc(page, rfc, capsolverApiKey)
    if (rfcResult.status === 'captcha_failed') {
      return {
        ok: false,
        semantic: 'retry',
        rfc: rfcResult,
        curp: { status: 'not_run', evidence: null, captcha: null },
      }
    }
    if (rfcResult.status !== 'valid') {
      return {
        ok: false,
        semantic: rfcResult.status === 'invalid' ? 'invalid' : 'retry',
        rfc: rfcResult,
        curp: { status: 'not_run', evidence: null, captcha: null },
      }
    }
    if (remaining() < MIN_MS_FOR_NEW_SESSION) {
      return {
        ok: false,
        semantic: 'retry',
        rfc: rfcResult,
        curp: { status: 'not_run', evidence: null, captcha: null },
        code: 'BUDGET_EXCEEDED_BEFORE_CURP',
      }
    }
    const curpResult = await validateCurp(page, curp, capsolverApiKey)
    if (curpResult.status === 'captcha_failed') {
      return {
        ok: false,
        semantic: 'retry',
        rfc: rfcResult,
        curp: curpResult,
      }
    }
    return {
      ok: curpResult.status === 'valid',
      semantic:
        curpResult.status === 'valid'
          ? 'pass'
          : curpResult.status === 'invalid'
            ? 'invalid'
            : 'retry',
      rfc: rfcResult,
      curp: curpResult,
    }
  } finally {
    await browser.close().catch(() => {})
  }
}

/**
 * Validación live RFC+CURP.
 * Misma sesión proxy para RFC+CURP dentro de un intento.
 * Ante error de red/proxy: cierra browser y reinicia flujo completo con sessionId nuevo (máx 3).
 * Captcha rechazado / RFC inválido NO rotan sesión.
 */
export async function validateFiscalLive({ rfc, curp, capsolverApiKey }) {
  const started = Date.now()
  const deadline = started + requestBudgetMs()
  const usedProxy = satProxyPresence() === 'present'
  const maxSessions = maxProxySessions()
  let sessionsUsed = 0
  let lastNetworkError = null

  for (let sessionNum = 1; sessionNum <= maxSessions; sessionNum += 1) {
    const remaining = deadline - Date.now()
    if (sessionNum > 1 && remaining < MIN_MS_FOR_NEW_SESSION) {
      console.warn(
        `[sat-validator] PROXY_SESSION_SKIP session=${sessionNum} reason=BUDGET remainingMs=${Math.max(0, remaining)}`,
      )
      break
    }
    const sessionId = usedProxy ? newProxySessionId() : undefined
    sessionsUsed = sessionNum
    try {
      const result = await validateFiscalLiveOnce({
        rfc,
        curp,
        capsolverApiKey,
        sessionId,
        sessionNum,
        deadline,
      })
      return { ...result, sessionsUsed }
    } catch (error) {
      lastNetworkError = error
      const plan = planProxySessionRetry({
        error,
        sessionNum,
        maxSessions,
        remainingMs: deadline - Date.now(),
        minMsForNewSession: MIN_MS_FOR_NEW_SESSION,
      })
      console.warn(
        `[sat-validator] PROXY_SESSION_FAIL session=${sessionNum}/${maxSessions} errorType=${plan.errorType} rotate=${plan.rotate} reason=${plan.reason}`,
      )
      if (!plan.rotate) {
        console.error(
          '[sat-validator] job failed',
          error instanceof Error ? error.message : 'unknown',
        )
        return {
          ok: false,
          semantic: 'retry',
          code: 'TECHNICAL_FAILURE',
          rfc: { status: 'unknown', evidence: null },
          curp: { status: 'not_run', evidence: null },
          sessionsUsed,
        }
      }
    }
  }

  console.error(
    '[sat-validator] PROXY_SESSIONS_EXHAUSTED',
    lastNetworkError instanceof Error ? lastNetworkError.message : 'unknown',
  )
  return {
    ok: false,
    semantic: 'retry',
    code: 'TECHNICAL_FAILURE',
    rfc: { status: 'unknown', evidence: null },
    curp: { status: 'not_run', evidence: null },
    sessionsUsed,
  }
}
