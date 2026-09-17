const CREATE_TASK_URL = 'https://api.capsolver.com/createTask'
const GET_RESULT_URL = 'https://api.capsolver.com/getTaskResult'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function solveImageCaptcha(imageBytes, apiKey) {
  if (!apiKey) throw new Error('CAPSOLVER_API_KEY_MISSING')
  const body = Buffer.from(imageBytes).toString('base64')
  const create = await fetch(CREATE_TASK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: { type: 'ImageToTextTask', body },
    }),
  })
  const created = await create.json()
  if (!create.ok || created.errorId) throw new Error('CAPSOLVER_CREATE_FAILED')
  if (created.solution?.text) return String(created.solution.text).trim()
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
      return String(result.solution.text).trim()
    }
  }
  throw new Error('CAPSOLVER_TIMEOUT')
}
