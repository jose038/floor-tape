import { CHARLES_KUSHNER_278T, periodicReportLinks, type DisclosureDocument } from '../domain/disclosure'
import { WHITE_HOUSE_DISCLOSURES, type Chamber } from '../domain/pure'
import { pdfBytesToText } from './pdf-text'

export type DisclosureBatch = {
  documents: DisclosureDocument[]
  omissions: string[]
}

const CHARLES_LABEL = 'Charles Kushner OGE Form 278-T'

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'FloorTape/1.0 (disclosure tracker)', accept: 'application/pdf,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(90_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

async function readOne(
  job: { label: string; url: string; hint: Chamber },
  omissions: string[],
): Promise<DisclosureDocument | null> {
  try {
    const bytes = await fetchBytes(job.url)
    const read = await pdfBytesToText(bytes)
    if (!read.text.trim()) {
      omissions.push(`${job.label}: report could not be parsed`)
      return null
    }
    return { label: job.label, url: job.url, text: read.text, hint: job.hint, truncated: read.truncated }
  } catch (error) {
    console.error('[floor-tape] disclosure failed', job.label, error instanceof Error ? error.message : error)
    omissions.push(`${job.label}: report could not be parsed`)
    return null
  }
}

export async function loadDisclosureBatch(): Promise<DisclosureBatch> {
  const omissions: string[] = []
  let links: { label: string; url: string }[] = []
  try {
    const response = await fetch(WHITE_HOUSE_DISCLOSURES, {
      headers: { 'user-agent': 'FloorTape/1.0 (disclosure tracker)', accept: 'text/html' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`${response.status}`)
    links = periodicReportLinks(await response.text())
    if (links.length === 0) omissions.push('White House disclosures page had no periodic transaction report links')
  } catch {
    omissions.push('White House disclosures page could not be fetched')
  }
  const jobs = [
    ...links.map((link) => ({ ...link, hint: 'whitehouse' as const })),
    { label: CHARLES_LABEL, url: CHARLES_KUSHNER_278T, hint: 'state' as const },
  ]
  const documents: DisclosureDocument[] = []
  const queue = [...jobs]
  async function worker() {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      const doc = await readOne(job, omissions)
      if (doc) documents.push(doc)
    }
  }
  await Promise.all([worker(), worker()])
  console.log(`[floor-tape] disclosures parsed=${documents.length} notes=${omissions.length}`)
  return { documents, omissions }
}
