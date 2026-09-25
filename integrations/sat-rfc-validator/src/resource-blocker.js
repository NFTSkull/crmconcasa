/**
 * Bloqueo de recursos no esenciales vía page.route (ahorro de ancho de banda proxy).
 * Nunca bloquea captcha (#captchaSession / reloadCaptcha) ni assets del propio SAT
 * (script/stylesheet/xhr/fetch/document/image en sat.gob.mx).
 */

/** Hosts SAT / gobierno necesarios para el formulario. */
const SAT_HOST_RE = /(^|\.)sat\.gob\.mx$/i

/** Trackers / analítica de terceros. */
const TRACKER_HOST_RE = new RegExp(
  [
    'google-analytics\\.com',
    'googletagmanager\\.com',
    'google\\.com\\/analytics',
    'doubleclick\\.net',
    'googlesyndication\\.com',
    'adservice\\.google',
    'facebook\\.net',
    'facebook\\.com\\/tr',
    'connect\\.facebook\\.net',
    'hotjar\\.com',
    'mixpanel\\.com',
    'segment\\.(com|io)',
    'amplitude\\.com',
    'newrelic\\.com',
    'nr-data\\.net',
    'clarity\\.ms',
    'scorecardresearch\\.com',
    'quantserve\\.com',
    'cdn\\.cookielaw\\.org',
    'onetrust\\.com',
  ].join('|'),
  'i',
)

/**
 * @param {string} url
 */
export function isSatHost(url) {
  try {
    const host = new URL(url).hostname
    return SAT_HOST_RE.test(host)
  } catch {
    return false
  }
}

/**
 * @param {string} url
 */
export function isCaptchaUrl(url) {
  return /captcha|reloadCaptcha|Captcha/i.test(url)
}

/**
 * Decisión pura (testeable).
 * @param {{ url: string, resourceType: string }} req
 * @returns {{ block: boolean, reason: string }}
 */
export function shouldBlockRequest(req) {
  const url = String(req.url || '')
  const type = String(req.resourceType || '').toLowerCase()

  // Captcha siempre permitido (imagen + endpoints de refresh).
  if (isCaptchaUrl(url)) {
    return { block: false, reason: 'captcha' }
  }

  // Fuentes
  if (type === 'font' || /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(url)) {
    return { block: true, reason: 'font' }
  }

  // Media (audio/video)
  if (type === 'media' || /\.(mp4|webm|mp3|wav|ogg|m4a|avi|mov)(\?|#|$)/i.test(url)) {
    return { block: true, reason: 'media' }
  }

  // Analítica / trackers de terceros (cualquier tipo)
  try {
    const host = new URL(url).hostname
    if (TRACKER_HOST_RE.test(host) || TRACKER_HOST_RE.test(url)) {
      return { block: true, reason: 'tracker' }
    }
  } catch {
    /* ignore */
  }

  // En hosts SAT: permitir script/css/xhr/fetch/document/image/other
  if (isSatHost(url)) {
    return { block: false, reason: 'sat' }
  }

  // Fuera de SAT: bloquear imágenes de tracking/beacon típicas; permitir el resto
  // necesario (p.ej. redirects). Solo bloqueamos resourceType image de terceros.
  if (type === 'image') {
    return { block: true, reason: 'third_party_image' }
  }

  return { block: false, reason: 'other' }
}

/**
 * Instala page.route y contador. Loguea blocked al cierre o vía flush().
 * @param {import('playwright').Page} page
 * @param {string} label
 */
export async function attachResourceBlocker(page, label) {
  const counter = { blocked: 0, allowed: 0, byReason: /** @type {Record<string, number>} */ ({}) }

  await page.route('**/*', async (route) => {
    const request = route.request()
    const decision = shouldBlockRequest({
      url: request.url(),
      resourceType: request.resourceType(),
    })
    if (decision.block) {
      counter.blocked += 1
      counter.byReason[decision.reason] = (counter.byReason[decision.reason] || 0) + 1
      await route.abort()
      return
    }
    counter.allowed += 1
    await route.continue()
  })

  const flush = (phase = 'page') => {
    console.log(
      `[sat-validator] RESOURCE_BLOCK page=${label} phase=${phase} blocked=${counter.blocked} allowed=${counter.allowed}`,
    )
  }

  page.on('close', () => flush('close'))

  return { counter, flush }
}
