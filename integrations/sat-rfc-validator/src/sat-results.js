const RFC_VALID = 'RFC VALIDO, Y SUSCEPTIBLE DE RECIBIR FACTURAS'
const CURP_VALID = 'REGISTRADO EN EL PADRON DE CONTRIBUYENTES'
/** Mensaje ValidaRFC (formMain) */
const CAPTCHA_REJECT_RFC = 'EL CODIGO QUE ESCRIBIO NO ES CORRECTO'
/** Mensaje ConsultaIdCSIAT (CURP) — fold sin acentos */
const CAPTCHA_REJECT_CURP = 'LOS CARACTERES QUE INGRESA DEBEN DE COINCIDIR CON LOS CARACTERES DE LA IMAGEN'

/**
 * Texto real ValidaRFC para RFC no registrado (fold).
 * Panel: #formMain:messageConsultaRFC (.ui-messages-info-summary)
 */
export const RFC_INVALID_MARKERS = [
  'RFC NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES',
]

export function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function isCaptchaRejectedText(text) {
  const n = fold(text)
  return n.includes(CAPTCHA_REJECT_RFC) || n.includes(CAPTCHA_REJECT_CURP)
}

export function classifyRfcSatText(text, invalidPatterns = []) {
  const normalized = fold(text)
  if (normalized.includes(RFC_VALID)) return 'valid'
  if (RFC_INVALID_MARKERS.some((m) => normalized.includes(m))) return 'invalid'
  if (invalidPatterns.some((pattern) => pattern.test(normalized))) return 'invalid'
  return 'unknown'
}

export function classifyCurpSatText(text, invalidPatterns = []) {
  const normalized = fold(text)
  if (normalized.includes(CURP_VALID)) return 'valid'
  if (invalidPatterns.some((pattern) => pattern.test(normalized))) return 'invalid'
  return 'unknown'
}
