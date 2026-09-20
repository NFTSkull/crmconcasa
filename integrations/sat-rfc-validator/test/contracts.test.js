import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRequestPayload, fixtureValidationResult } from '../src/contracts.js'
import { classifyRfcSatText, classifyCurpSatText } from '../src/sat-results.js'
import { buildPlaywrightProxy, satRuntimeReadiness } from '../src/runtime-config.js'

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


test('proxy explícito conserva endpoint y credenciales del proveedor', () => {
  const proxy = buildPlaywrightProxy({
    SAT_REQUIRE_PROXY: '1',
    PROXY_URL: 'gate.provider.example:7000',
    PROXY_USERNAME: 'user-mx-sticky-session-123',
    PROXY_PASSWORD: 'secret',
  })
  assert.deepEqual(proxy, {
    server: 'http://gate.provider.example:7000',
    username: 'user-mx-sticky-session-123',
    password: 'secret',
  })
})

test('live queda fail-closed si falta proxy o CapSolver', () => {
  assert.deepEqual(
    satRuntimeReadiness({
      SAT_VALIDATOR_MODE: 'live',
      SAT_REQUIRE_PROXY: '1',
      CAPSOLVER_API_KEY: '',
      PROXY_URL: '',
      PROXY_USERNAME: '',
      PROXY_PASSWORD: '',
    }),
    {
      ok: false,
      mode: 'live',
      capsolverConfigured: false,
      proxyConfigured: false,
      proxyRequired: true,
    },
  )
})

test('live queda ready con CapSolver + proxy explícito', () => {
  const readiness = satRuntimeReadiness({
    SAT_VALIDATOR_MODE: 'live',
    SAT_REQUIRE_PROXY: '1',
    CAPSOLVER_API_KEY: 'capsolver-test',
    PROXY_URL: 'http://gate.provider.example:7000',
    PROXY_USERNAME: 'mx-user',
    PROXY_PASSWORD: 'proxy-secret',
  })
  assert.equal(readiness.ok, true)
  assert.equal(readiness.proxyConfigured, true)
  assert.equal(readiness.capsolverConfigured, true)
})

test('modo fixture no exige proxy', () => {
  const readiness = satRuntimeReadiness({ SAT_VALIDATOR_MODE: 'fixture' })
  assert.equal(readiness.ok, true)
  assert.equal(readiness.mode, 'fixture')
})
