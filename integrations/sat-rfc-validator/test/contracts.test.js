import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRequestPayload, fixtureValidationResult } from '../src/contracts.js'
import { classifyRfcSatText, classifyCurpSatText } from '../src/sat-results.js'

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

test('clasificadores live reconocen PASS certificado', () => {
  assert.equal(classifyRfcSatText('RFC válido, y susceptible de recibir facturas'), 'valid')
  assert.equal(classifyCurpSatText('Estatus: Registrado en el padrón de contribuyentes.'), 'valid')
})

test('RFC negativo certificado queda invalid', () => {
  assert.equal(
    classifyRfcSatText('Estatus: RFC no registrado en el padrón de contribuyentes'),
    'invalid',
  )
  assert.equal(
    classifyRfcSatText('Estatus: RFC válido no susceptible de recibir facturas'),
    'invalid',
  )
  assert.equal(classifyRfcSatText('Estructura del RFC incorrecta'), 'invalid')
})

test('CURP NO REGISTRADA nunca se confunde con REGISTRADA', () => {
  assert.equal(
    classifyCurpSatText('Estatus: No registrado en el padrón de contribuyentes.'),
    'invalid',
  )
})

test('errores técnicos/captcha siguen fail-closed como unknown', () => {
  assert.equal(classifyRfcSatText('Captcha incorrecto'), 'unknown')
  assert.equal(classifyRfcSatText('Servicio no disponible'), 'unknown')
  assert.equal(classifyCurpSatText('Captcha incorrecto'), 'unknown')
  assert.equal(classifyCurpSatText('Servicio no disponible'), 'unknown')
})
