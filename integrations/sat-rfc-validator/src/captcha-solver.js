import { solveImageCaptcha } from './capsolver.js'

/**
 * CAPTCHA_CASE=upper|asis|lower (default: upper).
 * Se aplica después de quitar no-alfanuméricos y antes de CAPTCHA_PATTERN.
 * El SAT distingue case; CapSolver module=common suele devolver minúsculas.
 */
export function captchaCaseMode(raw = process.env.CAPTCHA_CASE) {
  const m = String(raw ?? 'upper').trim().toLowerCase()
  if (m === 'asis' || m === 'lower' || m === 'upper') return m
  return 'upper'
}

/**
 * Quita espacios y caracteres no alfanuméricos; luego aplica CAPTCHA_CASE.
 */
export function normalizeCaptchaOcr(text, caseMode = captchaCaseMode()) {
  const cleaned = String(text ?? '').replace(/[^A-Za-z0-9]/g, '')
  if (caseMode === 'lower') return cleaned.toLowerCase()
  if (caseMode === 'asis') return cleaned
  return cleaned.toUpperCase()
}

/**
 * Interfaz intercambiable de resolución OCR.
 * Hoy: CAPTCHA_PROVIDER=capsolver. Estructura lista para 2captcha sin tocar live-validator.
 */
export async function solveCaptcha(pngBuffer, { apiKey, websiteURL } = {}) {
  const provider = String(process.env.CAPTCHA_PROVIDER || 'capsolver').toLowerCase()
  if (provider === 'capsolver') {
    const raw = await solveImageCaptcha(pngBuffer, apiKey, { websiteURL })
    return normalizeCaptchaOcr(raw)
  }
  // Futuro: if (provider === '2captcha') { ... }
  throw new Error(`CAPTCHA_PROVIDER_UNSUPPORTED:${provider}`)
}
