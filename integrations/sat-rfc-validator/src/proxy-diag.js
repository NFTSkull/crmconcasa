import net from 'node:net'

const raw = String(process.env.PROXY_URL || '').trim()
const password = String(process.env.PROXY_PASS || '').trim()
const country = String(process.env.PROXY_COUNTRY || 'mx').trim().toLowerCase() || 'mx'

if (!raw || !password) {
  console.log('PROXY_TCP_DIAG status=MISSING_CONFIG')
  process.exit(0)
}

const url = new URL(raw.includes('://') ? raw : `http://${raw}`)
const host = url.hostname
const port = Number(url.port || 80)
const sessionId = `diag${Date.now()}`
const username = country === 'mx'
  ? `grecojcwy1-country-mx-state-nuevoleon-session-${sessionId}`
  : `grecojcwy1-country-${country}-session-${sessionId}`
const auth = Buffer.from(`${username}:${password}`).toString('base64')

const socket = net.createConnection({host, port})
socket.setTimeout(15000)

let buffer = ''
let finished = false

function finish(message) {
  if (finished) return
  finished = true
  console.log(message)
  socket.destroy()
}

socket.on('connect', () => {
  socket.write(
    'CONNECT api.ipify.org:443 HTTP/1.1\r\n' +
    'Host: api.ipify.org:443\r\n' +
    `Proxy-Authorization: Basic ${auth}\r\n` +
    'Proxy-Connection: close\r\n\r\n'
  )
})

socket.on('data', (chunk) => {
  buffer += chunk.toString('latin1')
  const eol = buffer.indexOf('\r\n')
  if (eol >= 0) {
    const statusLine = buffer.slice(0, eol).replace(/[^\x20-\x7E]/g, '')
    finish(`PROXY_TCP_DIAG ${statusLine}`)
  }
})

socket.on('timeout', () => finish('PROXY_TCP_DIAG status=TIMEOUT'))
socket.on('error', (error) => finish(`PROXY_TCP_DIAG status=SOCKET_ERROR code=${error.code || 'unknown'}`))
socket.on('close', () => {
  if (!finished) finish('PROXY_TCP_DIAG status=CLOSED_NO_RESPONSE')
})
