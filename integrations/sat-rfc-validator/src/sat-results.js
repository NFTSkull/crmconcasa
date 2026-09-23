const RFC_VALID = 'RFC VALIDO, Y SUSCEPTIBLE DE RECIBIR FACTURAS'
const CURP_VALID = 'REGISTRADO EN EL PADRON DE CONTRIBUYENTES'

const RFC_INVALID_PATTERNS = [
  /RFC NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES/,
  /NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES/,
  /RFC VALIDO NO SUSCEPTIBLE DE RECIBIR FACTURAS/,
  /ESTRUCTURA DEL RFC INCORRECTA/,
]

const CURP_INVALID_PATTERNS = [
  /NO REGISTRADO EN EL PADRON DE CONTRIBUYENTES/,
  /CURP NO REGISTRADA EN EL PADRON DE CONTRIBUYENTES/,
]

function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesAny(normalized, patterns) {
  return patterns.some((pattern) => {
    if (pattern instanceof RegExp) {
      pattern.lastIndex = 0
      return pattern.test(normalized)
    }
    return normalized.includes(fold(pattern))
  })
}

export function classifyRfcSatText(text, invalidPatterns = RFC_INVALID_PATTERNS) {
  const normalized = fold(text)
  if (matchesAny(normalized, invalidPatterns)) return 'invalid'
  if (normalized.includes(RFC_VALID)) return 'valid'
  return 'unknown'
}

export function classifyCurpSatText(text, invalidPatterns = CURP_INVALID_PATTERNS) {
  const normalized = fold(text)
  // Negative MUST be checked before the positive substring:
  // "NO REGISTRADO..." contains "REGISTRADO...".
  if (matchesAny(normalized, invalidPatterns)) return 'invalid'
  if (normalized.includes(CURP_VALID)) return 'valid'
  return 'unknown'
}
