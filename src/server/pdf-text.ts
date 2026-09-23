import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { parsePeriodicReport } from '../domain/disclosure'

const exec = promisify(execFile)
const MAX_OCR_PAGES = 4

let visionBinary: Promise<string | null> | null = null

async function commandExists(command: string): Promise<boolean> {
  try {
    await exec('which', [command])
    return true
  } catch {
    return false
  }
}

async function compileVision(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  if (!(await commandExists('swiftc'))) return null
  const source = path.join(process.cwd(), 'scripts/ocr-vision.swift')
  try {
    await access(source)
  } catch {
    return null
  }
  const dir = path.join(process.cwd(), '.data')
  await mkdir(dir, { recursive: true })
  const binary = path.join(dir, 'ocr-vision')
  try {
    await access(binary)
    return binary
  } catch {
    /* compile on first use */
  }
  await exec('swiftc', ['-O', '-o', binary, source], { timeout: 120_000 })
  return binary
}

function reportParses(text: string): boolean {
  if (!text.trim()) return false
  return (
    parsePeriodicReport(text, {
      url: 'https://www.whitehouse.gov/disclosures/',
      source: 'disclosure',
      hint: 'whitehouse',
    }).length > 0
  )
}

function visionBin(): Promise<string | null> {
  if (!visionBinary) {
    visionBinary = compileVision().catch((error: unknown) => {
      console.error('[floor-tape] vision ocr unavailable', error instanceof Error ? error.message : error)
      return null
    })
  }
  return visionBinary
}

async function ocrPdf(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const vision = (await visionBin()) ?? ''
  if (!vision && !(await commandExists('tesseract'))) return { text: '', truncated: false }
  const dir = await mkdtemp(path.join(tmpdir(), 'floor-tape-pdf-'))
  const pdfPath = path.join(dir, 'report.pdf')
  await writeFile(pdfPath, bytes)
  try {
    const { stdout, stderr } = await exec(
      process.execPath,
      [path.join(process.cwd(), 'scripts/ocr-pdf.mjs'), pdfPath, vision, String(MAX_OCR_PAGES)],
      { timeout: 180_000, maxBuffer: 20_000_000 },
    )
    return { text: stdout, truncated: stderr.includes('TRUNCATED') }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function pdfBytesToText(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  const { extractText } = await import('unpdf')
  const saved = Buffer.from(bytes)
  let extracted = ''
  try {
    const result = await extractText(bytes, { mergePages: true })
    extracted = Array.isArray(result.text) ? result.text.join('\n') : result.text
  } catch {
    extracted = ''
  }
  if (reportParses(extracted)) return { text: extracted, truncated: false }
  try {
    const recognized = await ocrPdf(saved)
    if (recognized.text.trim()) return recognized
  } catch (error) {
    console.error('[floor-tape] ocr failed', error instanceof Error ? error.message : error)
  }
  return { text: extracted, truncated: false }
}
