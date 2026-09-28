/**
 * Medidor de transferencia real del navegador Chromium.
 *
 * Network.loadingFinished.encodedDataLength reporta bytes codificados recibidos
 * por Chromium (aprox. tráfico HTTP de respuesta). No lee cuerpos ni genera
 * solicitudes adicionales, así que sirve para medir sin consumir más proxy.
 */

/**
 * @param {import('playwright').BrowserContext} context
 * @param {import('playwright').Page} page
 * @param {string} label
 */
export async function attachNetworkMeter(context, page, label) {
  const counter = {
    encodedBytes: 0,
    requestsFinished: 0,
    cachedResponses: 0,
  }

  const session = await context.newCDPSession(page)
  await session.send('Network.enable')

  session.on('Network.loadingFinished', (event) => {
    const n = Number(event?.encodedDataLength || 0)
    if (Number.isFinite(n) && n > 0) counter.encodedBytes += n
    counter.requestsFinished += 1
  })

  session.on('Network.requestServedFromCache', () => {
    counter.cachedResponses += 1
  })

  const snapshot = () => ({
    encodedBytes: Math.round(counter.encodedBytes),
    encodedMb: Number((counter.encodedBytes / 1024 / 1024).toFixed(3)),
    requestsFinished: counter.requestsFinished,
    cachedResponses: counter.cachedResponses,
  })

  const flush = (phase = 'page') => {
    const s = snapshot()
    console.log(
      `[sat-validator] NETWORK_USAGE page=${label} phase=${phase} bytes=${s.encodedBytes} mb=${s.encodedMb} requests=${s.requestsFinished} cached=${s.cachedResponses}`,
    )
    return s
  }

  return { counter, snapshot, flush }
}
