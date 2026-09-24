const CREATE_TASK_URL = 'https://api.capsolver.com/createTask'
const GET_RESULT_URL = 'https://api.capsolver.com/getTaskResult'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function formatCapsolverError(prefix, payload) {
  const errorId = payload?.errorId ?? 'unknown'
  const errorCode = payload?.errorCode ?? ''
  const errorDescription = payload?.errorDescription ?? ''
  const msg = `${prefix} errorId=${errorId} errorCode=${errorCode} errorDescription=${errorDescription}`
  console.error(`[sat-validator] ${msg}`)
  return msg
}

/**
 * CAPSOLVER_MODULE=common|none (default: common).
 * Con none no se envía el campo module en ImageToTextTask.
 */
export function capsolverModuleMode(raw = process.env.CAPSOLVER_MODULE) {
  const m = String(raw ?? 'common').trim().toLowerCase()
  if (m === 'none') return 'none'
  return 'common'
}

/**
 * ImageToTextTask — parámetros de la doc oficial:
 * type, body, module ("common" opcional), websiteURL.
 */
export async function solveImageCaptcha(imageBytes, apiKey, { websiteURL } = {}) {
  if (!apiKey) throw new Error('CAPSOLVER_API_KEY_MISSING')
  const body = Buffer.from(imageBytes).toString('base64')
  const task = {
    type: 'ImageToTextTask',
    body,
  }
  if (capsolverModuleMode() === 'common') task.module = 'common'
  if (websiteURL) task.websiteURL = websiteURL

  const create = await fetch(CREATE_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  })
  const created = await create.json().catch(() => ({}))
  if (!create.ok || created.errorId) {
    throw new Error(formatCapsolverError('CAPSOLVER_CREATE_FAILED', created))
  }
  if (created.solution?.text) return String(created.solution.text).trim()
  if (!created.taskId) throw new Error('CAPSOLVER_TASK_ID_MISSING')

  for (let i = 0; i < 15; i += 1) {
    await sleep(2000)
    const response = await fetch(GET_RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: created.taskId }),
    })
    const result = await response.json().catch(() => ({}))
    if (result.errorId) {
      throw new Error(formatCapsolverError('CAPSOLVER_RESULT_FAILED', result))
    }
    if (result.status === 'ready' && result.solution?.text) {
      return String(result.solution.text).trim()
    }
  }
  throw new Error('CAPSOLVER_TIMEOUT')
}
