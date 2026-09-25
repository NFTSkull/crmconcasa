import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldBlockRequest, isCaptchaUrl, isSatHost } from '../src/resource-blocker.js'

test('permite captcha y hosts SAT (script/css/xhr/image)', () => {
  assert.equal(isCaptchaUrl('https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/captcha.jpg'), true)
  assert.equal(isSatHost('https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf'), true)

  assert.deepEqual(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/captchaSession?x=1',
      resourceType: 'image',
    }),
    { block: false, reason: 'captcha' },
  )
  assert.deepEqual(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/javax.faces.resource/jquery.js',
      resourceType: 'script',
    }),
    { block: false, reason: 'sat' },
  )
  assert.deepEqual(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/javax.faces.resource/theme.css',
      resourceType: 'stylesheet',
    }),
    { block: false, reason: 'sat' },
  )
  assert.deepEqual(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/index.jsf',
      resourceType: 'xhr',
    }),
    { block: false, reason: 'sat' },
  )
  assert.deepEqual(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/logo.png',
      resourceType: 'image',
    }),
    { block: false, reason: 'sat' },
  )
})

test('bloquea fuentes, media y trackers', () => {
  assert.equal(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/fonts/roboto.woff2',
      resourceType: 'font',
    }).block,
    true,
  )
  assert.equal(
    shouldBlockRequest({
      url: 'https://cdn.example.com/video.mp4',
      resourceType: 'media',
    }).reason,
    'media',
  )
  assert.equal(
    shouldBlockRequest({
      url: 'https://www.google-analytics.com/analytics.js',
      resourceType: 'script',
    }).reason,
    'tracker',
  )
  assert.equal(
    shouldBlockRequest({
      url: 'https://www.googletagmanager.com/gtm.js',
      resourceType: 'script',
    }).block,
    true,
  )
  assert.equal(
    shouldBlockRequest({
      url: 'https://cdn.thirdparty.com/pixel.png',
      resourceType: 'image',
    }).reason,
    'third_party_image',
  )
})

test('reloadCaptcha no se bloquea', () => {
  assert.deepEqual(
    shouldBlockRequest({
      url: 'https://agsc.siat.sat.gob.mx/PTSC/ValidaRFC/reloadCaptcha.jsf',
      resourceType: 'xhr',
    }),
    { block: false, reason: 'captcha' },
  )
})
