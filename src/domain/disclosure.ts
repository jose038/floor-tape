/** OGE Form 278-T text → filings. No network. */

import {
  FILED_SINCE,
  LATE_AFTER_DAYS,
  WHITE_HOUSE_DISCLOSURES,
  amountMid,
  compareNewest,
  lagDays,
  memberIdFor,
  normalizeSide,
  parseIsoDay,
  resolveTicker,
  stableFilingId,
  type Chamber,
  type Filing,
  type FilingSource,
} from './pure'

export const CHARLES_KUSHNER_278T =
  'https://www.documentcloud.org/documents/27968452-charles-kushner-09262025-278t.pdf'

export const SOURCES_COPY = [
  'Filings since 2023 come from the Hillscore trades.csv compilation for the House and Senate, and from White House Office periodic transaction reports linked on the White House disclosures page. Hillscore covers most-active traders, not all 535 members. If that file is unreachable, the tape shows a labeled non-official sample so the screens still work. Official congressional documents remain the House Clerk and Senate eFD. Floor Tape does not scrape those portals. Chamber for members of Congress is joined from the public congress-legislators file when a bioguide id is present. A White House filing links to the White House or OGE disclosure, not the House Clerk and not Senate eFD.',
  'A periodic transaction report is included only when it parses into at least one securities transaction. A person or report that is not parsed is omitted, not invented.',
  'No public transaction report was included for Jared Kushner. The Office of Government Ethics response FY26-109, released 2026-09-14, found no records, and he is not on the White House disclosures index.',
  'No public transaction report was included for Ivanka Trump. She is not on the White House disclosures index.',
  'Charles Kushner is not a White House Office filer. His public OGE Form 278-T as Ambassador to France and Monaco, Department of State, is included when that report parses, and those rows are labeled State.',
].join('\n\n')

export type DisclosureDocument = {
  label: string
  url: string
  text: string
  hint?: Chamber
  truncated?: boolean
}

const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
}

const BANDS: [number, number][] = [
  [1001, 15000],
  [15001, 50000],
  [50001, 100000],
  [100001, 250000],
  [250001, 500000],
  [500001, 1_000_000],
  [1_000_001, 5_000_000],
  [5_000_001, 25_000_000],
  [25_000_001, 50_000_000],
  [50_000_001, 50_000_001],
]

export function hasReadableReportText(text: string): boolean {
  return /periodic transaction report/i.test(text) || /filer's information/i.test(text)
}

export function periodicReportLinks(html: string): { label: string; url: string }[] {
  const start = html.search(/<summary>\s*Transaction Reports\s*<\/summary>/i)
  if (start < 0) return []
  const rest = html.slice(start)
  const next = rest.slice(30).search(/<summary>/i)
  const section = next === -1 ? rest : rest.slice(0, 30 + next)
  const links: { label: string; url: string }[] = []
  const re = /<a\b[^>]*href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(section))) {
    const label = decodeHtml(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    if (!/periodic transaction/i.test(label)) continue
    links.push({ label, url: decodeHtml(match[1]) })
  }
  return links
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

export function filerFromLabel(label: string): string {
  const withoutReport = label.replace(/\s*[-–—]?\s*periodic transaction report.*$/i, '').trim()
  const withoutTitle = withoutReport.replace(/^president\s+/i, '').trim()
  return formatPerson(withoutTitle || withoutReport)
}

function formatPerson(raw: string): string {
  const cleaned = raw
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,\s]+$/g, '')
    .trim()
  const comma = /^([^,]+),\s*(.+)$/.exec(cleaned)
  if (!comma) return cleaned
  return `${comma[2].trim()} ${comma[1].trim()}`.replace(/\s+/g, ' ')
}

function parseUsDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw.trim())
  if (!match) return null
  let year = Number(match[3])
  if (year < 100) year += year >= 70 ? 1900 : 2000
  const month = Number(match[1])
  const day = Number(match[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function longDate(raw: string): string | null {
  const match = /([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/.exec(raw.trim())
  if (!match) return null
  const month = MONTHS[match[1].toLowerCase()]
  if (!month) return null
  return `${match[3]}-${month}-${String(Number(match[2])).padStart(2, '0')}`
}

/** Vision reads the amendment header as labels, then the four values. */
function letterFields(text: string): { filer: string; filed: string } | null {
  const match =
    /filer:\s*\n\s*position:\s*\n\s*reporting period:\s*\n\s*date of report:\s*\n\s*([^\n]+)\n\s*([^\n]+)\n\s*([^\n]+)\n\s*([^\n]+)/i.exec(text)
  if (!match) return null
  const filed = longDate(match[4] ?? '')
  const filer = formatPerson(match[1] ?? '')
  if (!filer || !filed) return null
  return { filer, filed }
}

function filedDateFrom(text: string): string | null {
  const letter = letterFields(text)
  if (letter) return letter.filed
  const long = /date of report:\s*([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/i.exec(text)
  if (long) return longDate(`${long[1]} ${long[2]}, ${long[3]}`)
  const signed = /electronically signed on\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)
  if (signed) return parseUsDate(signed[1])
  return null
}

function filerFromText(text: string, label?: string): string | null {
  const letter = letterFields(text)
  if (letter) return letter.filer
  const info = /filer'?s information\s+([^\n]+)/i.exec(text)
  if (info) return formatPerson(info[1])
  const filer = /\bfiler:\s*([^\n]+)/i.exec(text)
  if (filer && filer[1].trim()) return formatPerson(filer[1])
  if (label) {
    const fromLabel = filerFromLabel(label)
    if (fromLabel) return fromLabel
  }
  return null
}

export function detectInstitution(text: string): Chamber | null {
  const head = text.slice(0, 2500)
  if (/department of state/i.test(head)) return 'state'
  if (/white house/i.test(head)) return 'whitehouse'
  if (/president of the united states/i.test(head)) return 'whitehouse'
  return null
}

function resolveChamber(text: string, hint?: Chamber): Chamber {
  return detectInstitution(text) ?? (hint && hint !== 'unknown' ? hint : 'unknown')
}

function normalizeReport(text: string): string {
  return text.replace(/\u00a0/g, ' ').replace(/[–—]/g, '-').replace(/(\$?\s*\d[\d,]*)\s*-\s*(\$?\s*\d[\d,]*)/g, '$1 - $2')
}

function money(token: string): number | null {
  const digits = token.replace(/[$,\s]/g, '')
  if (!/^\d+$/.test(digits)) return null
  const value = Number(digits)
  return Number.isFinite(value) ? value : null
}

function asBand(min: number, max: number): { min: number; max: number } | null {
  const hit = BANDS.find(([low, high]) => low === min && high === max)
  return hit ? { min: hit[0], max: hit[1] } : null
}

function parseBand(raw: string): { min: number; max: number } | null {
  if (/over\s+\$?\s*50,000,000/i.test(raw)) return { min: 50_000_001, max: 50_000_001 }
  const match = /(\$?\s*\d[\d,]*)\s*-\s*(\$?\s*\d[\d,]*)/.exec(raw)
  if (!match) return null
  const min = money(match[1])
  const max = money(match[2])
  if (min == null || max == null || max < min) return null
  return asBand(min, max)
}

function amountRanges(text: string): { min: number; max: number }[] {
  const re = /over\s+\$?\s*50,000,000|\$?\s*\d{1,3}(?:,\d{3})+\s*-\s*\$?\s*\d{1,3}(?:,\d{3})+/gi
  const bands: { min: number; max: number }[] = []
  for (const match of text.matchAll(re)) {
    const band = parseBand(match[0])
    if (band) bands.push(band)
  }
  return bands
}

function tickerOf(description: string): { symbol: string | null; yahooSymbol: string | null } {
  const matches = [...description.matchAll(/\(([A-Z][A-Z0-9.]{0,9})\)/g)]
  const last = matches.at(-1)?.[1]
  if (!last || last === 'ADR' || last === 'ETF' || last === 'LP' || last === 'INC') {
    return { symbol: null, yahooSymbol: null }
  }
  return resolveTicker(last)
}

const SKIP_LINE =
  /^(#|description\b|type\b|date\b|\|?\s*date\b|notification\b|over 30 days\b|received over\b|days ago\b|\d+\s+days ago\b|amount\b|yes\b|no\b|exhibit|in place of\b|amendment\b|periodic transaction\b|disclosure report\b|executive branch\b|filer\b|position\b|date of report\b|re:|public financial\b|u\.s\. office\b)/i

function cleanDescription(raw: string): string {
  const exhibit = raw.toLowerCase().lastIndexOf('exhibit')
  const inplace = raw.toLowerCase().lastIndexOf('in place of')
  const cut = Math.max(exhibit, inplace)
  const focused = cut >= 0 ? raw.slice(cut) : raw
  const lines = focused
    .split(/\n/)
    .map((line) => line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line && !/^\d+$/.test(line) && !SKIP_LINE.test(line) && !/-\s*page\s+\d+/i.test(line))
  return lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/^days ago\s+/i, '')
    .replace(/^\d+\s+/, '')
    .trim()
}

type Draft = {
  description: string
  side: string
  transactionDate: string
  band: { min: number; max: number }
}

function linearDrafts(text: string): Draft[] {
  // "30 DAYS AGO" is the notification column header, not transaction number 30.
  const re =
    /(?:^|\n)\s*(?!\d+\s+DAYS\b)\d+\s+([\s\S]+?)\s+(Purchase|Sale|Exchange)(?:\s*\([^)\n]{0,40}\))?\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(?:Yes|No)\s+(\$?\s*\d[\d,]*(?:\s*-\s*\$?\s*\d[\d,]*)?|Over\s+\$?\s*\d[\d,]*)/gi
  const drafts: Draft[] = []
  for (const match of text.matchAll(re)) {
    const description = cleanDescription(match[1] ?? '')
    const band = parseBand(match[4] ?? '')
    const transactionDate = parseUsDate(match[3] ?? '')
    if (!description || !band || !transactionDate) continue
    drafts.push({ description, side: match[2] ?? '', transactionDate, band })
  }
  return drafts
}

function columnDrafts(text: string): Draft[] {
  const typeRe = /\b(Purchase|Sale|Exchange)(?:\s*\([^)\n]{0,40}\))?[\s|]*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi
  const types = [...text.matchAll(typeRe)]
  const bands = amountRanges(text)
  if (types.length === 0 || types.length !== bands.length) return []
  const drafts: Draft[] = []
  types.forEach((match, index) => {
    const start = index === 0 ? 0 : (types[index - 1]?.index ?? 0) + (types[index - 1]?.[0].length ?? 0)
    const description = cleanDescription(text.slice(start, match.index ?? start))
    const transactionDate = parseUsDate(match[2] ?? '')
    const band = bands[index]
    if (!description || !transactionDate || !band) return
    drafts.push({ description, side: match[1] ?? '', transactionDate, band })
  })
  return drafts
}

export function parsePeriodicReport(
  text: string,
  input: { url: string; source: FilingSource; hint?: Chamber; label?: string },
): Filing[] {
  const normalized = normalizeReport(text)
  const politician = filerFromText(normalized, input.label)
  const filedDate = filedDateFrom(normalized)
  const url = input.url.trim()
  if (!politician || !filedDate || !parseIsoDay(filedDate) || filedDate < FILED_SINCE || !url) return []
  const chamber = resolveChamber(normalized, input.hint)
  const drafts = linearDrafts(normalized)
  const rows = drafts.length > 0 ? drafts : columnDrafts(normalized)
  const seen = new Map<string, number>()
  const filings: Filing[] = []
  for (const draft of rows) {
    if (!parseIsoDay(draft.transactionDate)) continue
    const lag = lagDays(draft.transactionDate, filedDate)
    if (lag == null) continue
    const ticker = tickerOf(draft.description)
    const ownerRaw = 'Self'
    const baseId = stableFilingId([
      politician,
      '',
      ticker.symbol ?? '',
      draft.description,
      draft.side,
      ownerRaw,
      draft.transactionDate,
      filedDate,
      String(draft.band.min),
      String(draft.band.max),
    ])
    const dup = seen.get(baseId) ?? 0
    seen.set(baseId, dup + 1)
    const id = dup === 0 ? baseId : `${baseId}-${dup + 1}`
    filings.push({
      id,
      politician,
      memberId: memberIdFor(null, politician),
      bioguideId: null,
      party: null,
      state: null,
      chamber,
      symbol: ticker.symbol,
      yahooSymbol: ticker.yahooSymbol,
      assetName: draft.description.slice(0, 240),
      transactionType: normalizeSide(draft.side),
      owner: 'self',
      ownerRaw,
      transactionDate: draft.transactionDate,
      filedDate,
      lagDays: lag,
      late: lag > LATE_AFTER_DAYS,
      amountMin: draft.band.min,
      amountMax: draft.band.max,
      amountMid: amountMid(draft.band.min, draft.band.max),
      priceOnTradeDate: null,
      officialUrl: url || WHITE_HOUSE_DISCLOSURES,
      source: input.source,
    })
  }
  filings.sort(compareNewest)
  return filings
}
