export const RFC_FULL_RE = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/u
export const CURP_RE = /^[A-Z0-9]{18}$/u

export function normalizeRfc(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9Ñ&]/gu, '')
}

export function normalizeCurp(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function validateRequestPayload(body) {
  const rfc = normalizeRfc(body?.rfc)
  const curp = normalizeCurp(body?.curp)
  if (!RFC_FULL_RE.test(rfc)) return { ok: false, code: 'RFC_FORMAT_INVALID' }
  if (!CURP_RE.test(curp)) return { ok: false, code: 'CURP_FORMAT_INVALID' }
  const fixtureScenario = body?.fixtureScenario == null ? null : String(body.fixtureScenario)
  return { ok: true, rfc, curp, fixtureScenario }
}

export function fixtureValidationResult(scenario = 'all_valid') {
  switch (scenario) {
    case 'all_valid':
      return {
        ok: true,
        semantic: 'pass',
        rfc: { status: 'valid', evidence: 'fixture_rfc_valid' },
        curp: { status: 'valid', evidence: 'fixture_curp_registered' },
      }
    case 'rfc_unknown':
      return {
        ok: false,
        semantic: 'retry',
        rfc: { status: 'unknown', evidence: 'fixture_rfc_unknown' },
        curp: { status: 'not_run', evidence: null },
      }
    case 'curp_unknown':
      return {
        ok: false,
        semantic: 'retry',
        rfc: { status: 'valid', evidence: 'fixture_rfc_valid' },
        curp: { status: 'unknown', evidence: 'fixture_curp_unknown' },
      }
    case 'rfc_invalid_certified':
      return {
        ok: false,
        semantic: 'invalid',
        rfc: { status: 'invalid', evidence: 'fixture_rfc_invalid_certified' },
        curp: { status: 'not_run', evidence: null },
      }
    case 'curp_invalid_certified':
      return {
        ok: false,
        semantic: 'invalid',
        rfc: { status: 'valid', evidence: 'fixture_rfc_valid' },
        curp: { status: 'invalid', evidence: 'fixture_curp_invalid_certified' },
      }
    default:
      return {
        ok: false,
        semantic: 'retry',
        rfc: { status: 'unknown', evidence: 'fixture_unknown_scenario' },
        curp: { status: 'not_run', evidence: null },
      }
  }
}
