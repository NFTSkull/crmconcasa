import sharp from 'sharp'

/**
 * Preprocesa la imagen del captcha SAT antes de mandarla a CapSolver.
 * CAPTCHA_PREPROCESS=raw|basic|threshold (default: basic)
 */
export async function preprocessCaptchaImage(pngBuffer, mode = process.env.CAPTCHA_PREPROCESS || 'basic') {
  const m = String(mode || 'basic').toLowerCase()
  if (m === 'raw') return Buffer.from(pngBuffer)

  let pipeline = sharp(pngBuffer).grayscale().normalize().median(3)

  if (m === 'threshold') {
    pipeline = pipeline.threshold(128)
  } else {
    // basic: contraste ligero tras grayscale + normalize + mediana
    pipeline = pipeline.linear(1.5, -20)
  }

  return pipeline.png().toBuffer()
}
