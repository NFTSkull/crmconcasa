import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRequestPayload, fixtureValidationResult } from '../src/contracts.js'
import { classifyRfcSatText, classifyCurpSatText, isCaptchaRejectedText } from '../src/sat-results.js'
import { normalizeCaptchaOcr, captchaCaseMode } from '../src/captcha-solver.js'
import { capsolverModuleMode } from '../src/capsolver.js'

test('acepta RFC físico de 13 y CURP de 18', () => {
  const r = validateRequestPayload({ rfc: 'ABCD0101019A1', curp: 'AECD010101HNLXYZ01' })
  assert.equal(r.ok, true)
})

test('rechaza RFC sin homoclave: el worker solo recibe RFC fiscal final', () => {
  assert.deepEqual(validateRequestPayload({ rfc: 'ABCD010101', curp: 'AECD010101HNLXYZ01' }), {
    ok: false,
    code: 'RFC_FORMAT_INVALID',
  })
})

test('fixture PASS exige RFC y CURP válidos', () => {
  const r = fixtureValidationResult('all_valid')
  assert.equal(r.semantic, 'pass')
  assert.equal(r.rfc.status, 'valid')
  assert.equal(r.curp.status, 'valid')
})

test('fixture unknown nunca se convierte en invalid', () => {
  assert.equal(fixtureValidationResult('rfc_unknown').semantic, 'retry')
  assert.equal(fixtureValidationResult('curp_unknown').semantic, 'retry')
})

test('clasificadores live son fail-closed', () => {
  assert.equal(classifyRfcSatText('RFC válido, y susceptible de recibir facturas'), 'valid')
  assert.equal(classifyRfcSatText('Captcha incorrecto'), 'unknown')
  assert.equal(classifyCurpSatText('Estatus: Registrado en el padrón de contribuyentes.'), 'valid')
  assert.equal(classifyCurpSatText('Servicio no disponible'), 'unknown')
})

test('rechazo de captcha SAT se detecta con fold (nunca invalid)', () => {
  assert.equal(
    isCaptchaRejectedText('El código que escribió no es correcto, inténtelo nuevamente'),
    true,
  )
  assert.equal(
    isCaptchaRejectedText(
      'Los caracteres que ingresa deben de coincidir con los caracteres de la imagen. Inténtelo nuevamente por favor.',
    ),
    true,
  )
  assert.equal(isCaptchaRejectedText('RFC válido, y susceptible de recibir facturas'), false)
})

test('classifyRfcSatText: RFC no registrado (texto real ValidaRFC) → invalid', () => {
  assert.equal(
    classifyRfcSatText('RFC no registrado en el padrón de contribuyentes'),
    'invalid',
  )
  assert.equal(
    classifyRfcSatText(
      'Inicio Validador de RFC Resultado RFC Validador de RFC RFC no registrado en el padrón de contribuyentes RFC del Contribuyente',
    ),
    'invalid',
  )
  assert.equal(classifyRfcSatText('Servicio no disponible'), 'unknown')
})

test('CAPTCHA_CASE: upper (default) / asis / lower tras limpiar no-alfanuméricos', () => {
  assert.equal(captchaCaseMode(undefined), 'upper')
  assert.equal(captchaCaseMode('ASIS'), 'asis')
  assert.equal(normalizeCaptchaOcr('th2-tk!', 'upper'), 'TH2TK')
  assert.equal(normalizeCaptchaOcr('Th2Tk', 'asis'), 'Th2Tk')
  assert.equal(normalizeCaptchaOcr('TH2TK', 'lower'), 'th2tk')
})

test('CAPSOLVER_MODULE: common (default) / none', () => {
  assert.equal(capsolverModuleMode(undefined), 'common')
  assert.equal(capsolverModuleMode('NONE'), 'none')
  assert.equal(capsolverModuleMode('weird'), 'common')
})
