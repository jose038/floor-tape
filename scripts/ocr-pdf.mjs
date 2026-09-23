import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createCanvas } from '@napi-rs/canvas'
import { extractImages } from 'unpdf'

const exec = promisify(execFile)
const here = fileURLToPath(import.meta.url)

function pngFrom(img) {
  const canvas = createCanvas(img.width, img.height)
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(img.width, img.height)
  const src = img.data
  const step = img.channels
  for (let p = 0, q = 0; p < src.length; p += step, q += 4) {
    const red = src[p] ?? 0
    image.data[q] = red
    image.data[q + 1] = src[p + 1] ?? red
    image.data[q + 2] = src[p + 2] ?? red
    image.data[q + 3] = step === 4 ? (src[p + 3] ?? 255) : 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas.toBuffer('image/png')
}

async function onePage(pdfPath, page, vision) {
  const bytes = new Uint8Array(await readFile(pdfPath))
  let images
  try {
    images = await extractImages(bytes, page)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/invalid page/i.test(message)) process.exit(2)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
  const img = images
    .filter((image) => image.width >= 400 && image.height >= 400)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]
  if (!img) return
  const dir = await mkdtemp(path.join(tmpdir(), 'floor-tape-ocr-'))
  const file = path.join(dir, 'page.png')
  await writeFile(file, pngFrom(img))
  try {
    if (vision) {
      const { stdout } = await exec(vision, [file], { timeout: 30_000, maxBuffer: 8_000_000 })
      process.stdout.write(stdout)
    } else {
      const { stdout } = await exec('tesseract', [file, 'stdout', '-l', 'eng', '--psm', '6'], {
        timeout: 30_000,
        maxBuffer: 8_000_000,
      })
      process.stdout.write(stdout)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function allPages(pdfPath, vision, maxPages) {
  const parts = []
  let truncated = false
  for (let page = 1; page <= maxPages; page++) {
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [here, '--page', pdfPath, String(page), vision], { maxBuffer: 8_000_000 }, (error, stdout, stderr) => {
        const code = error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({ code, stdout, stderr })
      })
    })
    if (result.code === 2) break
    if (result.stdout.trim()) parts.push(result.stdout)
    if (page === maxPages) {
      const extra = await new Promise((resolve) => {
        execFile(
          process.execPath,
          [here, '--page', pdfPath, String(page + 1), vision],
          { maxBuffer: 1024 },
          (error) => resolve(error && 'code' in error && error.code === 2),
        )
      })
      truncated = extra !== true
    }
  }
  if (truncated) process.stderr.write('TRUNCATED\n')
  process.stdout.write(parts.join('\n'))
}

const args = process.argv.slice(2)
if (args[0] === '--page') {
  await onePage(args[1], Number(args[2]), args[3] || '')
} else {
  await allPages(args[0], args[1] || '', Number(args[2] || 8))
}
