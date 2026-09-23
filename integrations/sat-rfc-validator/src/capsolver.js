const CREATE_TASK_URL = 'https://api.capsolver.com/createTask'
const GET_RESULT_URL = 'https://api.capsolver.com/getTaskResult'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeCaptchaText(value) {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

function isExpectedCaptcha(text, expectedLength) {
  return new RegExp(`^[A-Z0-9]{${expectedLength}}$`).test(text)
}

async function solveSingleImageCaptcha(body, apiKey, websiteURL) {
  const task = {
    type: 'ImageToTextTask',
    body,
    module: 'common',
  }
  if (websiteURL) task.websiteURL = websiteURL

  const create = await fetch(CREATE_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  })
  const created = await create.json()
  if (!create.ok || created.errorId) throw new Error('CAPSOLVER_CREATE_FAILED')
  if (created.solution?.text) return normalizeCaptchaText(created.solution.text)
  if (!created.taskId) throw new Error('CAPSOLVER_TASK_ID_MISSING')

  for (let i = 0; i < 15; i += 1) {
    await sleep(2000)
    const response = await fetch(GET_RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId: created.taskId }),
    })
    const result = await response.json()
    if (result.errorId) throw new Error('CAPSOLVER_RESULT_FAILED')
    if (result.status === 'ready' && result.solution?.text) {
      return normalizeCaptchaText(result.solution.text)
    }
  }
  throw new Error('CAPSOLVER_TIMEOUT')
}

export async function solveImageCaptcha(
  imageBytes,
  apiKey,
  { expectedLength = 5, maxFormatAttempts = 5, websiteURL = '' } = {},
) {
  if (!apiKey) throw new Error('CAPSOLVER_API_KEY_MISSING')
  const body = Buffer.from(imageBytes).toString('base64')

  for (let attempt = 1; attempt <= maxFormatAttempts; attempt += 1) {
    const text = await solveSingleImageCaptcha(body, apiKey, websiteURL)
    const valid = isExpectedCaptcha(text, expectedLength)
    console.log(
      `[capsolver] FORMAT attempt=${attempt}/${maxFormatAttempts} chars=${text.length} valid=${valid}`,
    )
    if (valid) return text
  }

  throw new Error('CAPSOLVER_SAT_CAPTCHA_FORMAT_REJECTED')
}
