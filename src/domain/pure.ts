/** Pure STOCK Act helpers. No network, database, or clock I/O. */

export const FILED_SINCE = '2023-01-01'
export const LATE_AFTER_DAYS = 45
export const LARGE_AMOUNT_MIN = 100_001
export const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000
export const HOUSE_PORTAL = 'https://disclosures-clerk.house.gov/'
export const SENATE_PORTAL = 'https://efdsearch.senate.gov/'
export const WHITE_HOUSE_DISCLOSURES = 'https://www.whitehouse.gov/disclosures/'

export type Side = 'BUY' | 'SELL' | 'OTHER'
export type Chamber = 'house' | 'senate' | 'whitehouse' | 'state' | 'unknown'
export type InstitutionGroup = 'house' | 'senate' | 'whitehouse' | 'other'
export type FilingSource = 'sample' | 'hillscore' | 'disclosure'
export type Chip = 'all' | 'buys' | 'sells' | 'late' | 'large' | 'watches'

export type WatchRules = {
  members: string[]
  tickers: string[]
  parties: string[]
  chambers: string[]
  largeBuysOnly: boolean
}

export type Filing = {
  id: string
  politician: string
  memberId: string
  bioguideId: string | null
  party: string | null
  state: string | null
  chamber: Chamber
  symbol: string | null
  yahooSymbol: string | null
  assetName: string
  transactionType: Side
  owner: string
  ownerRaw: string
  transactionDate: string
  filedDate: string
  lagDays: number
  late: boolean
  amountMin: number
  amountMax: number
  amountMid: number
  priceOnTradeDate: number | null
  officialUrl: string
  source: FilingSource
}

export type MarkInput = {
  id: string
  transactionType: Side
  symbol: string | null
  amountMid: number
  tradeDateClose: number | null
  lastClose: number | null
}

export type Mark = {
  sharesEst: number | null
  unrealizedEst: number | null
  returnPct: number | null
  includedInTotals: boolean
}

export const emptyWatches = (): WatchRules => ({
  members: [],
  tickers: [],
  parties: [],
  chambers: [],
  largeBuysOnly: false,
})

export function isChip(value: string): value is Chip {
  return value === 'all' || value === 'buys' || value === 'sells' || value === 'late' || value === 'large' || value === 'watches'
}

export function parseIsoDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return Date.UTC(year, month - 1, day)
}

/** Calendar days from trade date to filed date. Positive when the filing is after the trade. */
export function lagDays(transactionDate: string, filedDate: string): number | null {
  const trade = parseIsoDay(transactionDate)
  const filed = parseIsoDay(filedDate)
  if (trade == null || filed == null) return null
  return Math.round((filed - trade) / 86_400_000)
}

/** Late only when the filing lands more than 45 days after the trade. A 45-day lag is on time. */
export function isLate(transactionDate: string, filedDate: string): boolean {
  const lag = lagDays(transactionDate, filedDate)
  return lag != null && lag > LATE_AFTER_DAYS
}

export function shouldRefresh(lastIngestAt: string | null, now: Date, force: boolean): boolean {
  if (force) return true
  if (!lastIngestAt) return true
  const then = Date.parse(lastIngestAt)
  if (Number.isNaN(then)) return true
  return now.getTime() - then >= REFRESH_INTERVAL_MS
}

export function toYahooSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, '-')
}

export function resolveTicker(raw: string | null | undefined): { symbol: string | null; yahooSymbol: string | null } {
  if (raw == null) return { symbol: null, yahooSymbol: null }
  const symbol = raw.trim().toUpperCase()
  if (!symbol || symbol === '-' || symbol === '—' || symbol === 'N/A' || symbol === 'NA' || symbol === 'NONE') {
    return { symbol: null, yahooSymbol: null }
  }
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) return { symbol: null, yahooSymbol: null }
  return { symbol, yahooSymbol: toYahooSymbol(symbol) }
}

const OWNER_TOKEN: Record<string, string> = {
  self: 'self',
  spouse: 'spouse',
  joint: 'joint',
  child: 'child',
  dependent: 'child',
  dependentchild: 'child',
}

export function normalizeOwner(raw: string): string {
  const pieces = raw
    .split(/[+/,]/)
    .map((part) => part.trim().toLowerCase().replace(/[_\s]+/g, ''))
    .filter(Boolean)
  if (pieces.length === 0) return 'self'
  const mapped = pieces.map((part) => OWNER_TOKEN[part] ?? part)
  const unique: string[] = []
  for (const part of mapped) {
    if (!unique.includes(part)) unique.push(part)
  }
  if (unique.length === 1) return unique[0]
  const order = ['self', 'spouse', 'joint', 'child']
  unique.sort((a, b) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b)
  })
  return unique.join('+')
}

export function ownerLabel(owner: string): string {
  const labels: Record<string, string> = { self: 'Self', spouse: 'Spouse', joint: 'Joint', child: 'Child' }
  return owner
    .split('+')
    .map((part) => labels[part] ?? part)
    .join(' + ')
}

export function normalizeSide(raw: string): Side {
  const value = raw.trim().toUpperCase()
  if (value === 'BUY' || value === 'PURCHASE' || value.startsWith('BUY')) return 'BUY'
  if (value === 'SELL' || value === 'SALE' || value.startsWith('SELL')) return 'SELL'
  return 'OTHER'
}

export function officialPortal(chamber: Chamber): string {
  if (chamber === 'senate') return SENATE_PORTAL
  if (chamber === 'whitehouse') return WHITE_HOUSE_DISCLOSURES
  if (chamber === 'house') return HOUSE_PORTAL
  return HOUSE_PORTAL
}

export const INSTITUTION_GROUPS: { id: InstitutionGroup; label: string }[] = [
  { id: 'house', label: 'House' },
  { id: 'senate', label: 'Senate' },
  { id: 'whitehouse', label: 'White House' },
  { id: 'other', label: 'Other' },
]

export function institutionGroup(chamber: string): InstitutionGroup {
  if (chamber === 'house' || chamber === 'senate' || chamber === 'whitehouse') return chamber
  return 'other'
}

export function institutionName(chamber: Chamber): string {
  switch (chamber) {
    case 'house':
      return 'House'
    case 'senate':
      return 'Senate'
    case 'whitehouse':
      return 'White House'
    case 'state':
      return 'State'
    default:
      return 'Other'
  }
}

export function documentLabel(row: { chamber: Chamber; officialUrl: string }): string {
  const url = row.officialUrl.toLowerCase()
  if (row.chamber === 'senate' || url.includes('efdsearch.senate.gov')) return 'Senate eFD'
  if (row.chamber === 'house' || url.includes('disclosures-clerk.house.gov')) return 'House Clerk'
  if (row.chamber === 'whitehouse' || url.includes('whitehouse.gov')) return 'White House disclosure'
  if (url.includes('oge.gov')) return 'OGE disclosure'
  if (row.chamber === 'state') return 'State Department disclosure'
  return 'Official disclosure'
}

export function filterByGroup<T extends { chamber: string }>(rows: T[], group: InstitutionGroup | 'all'): T[] {
  if (group === 'all') return rows
  return rows.filter((row) => institutionGroup(row.chamber) === group)
}

export function memberIdFor(bioguide: string | null, politician: string): string {
  if (bioguide && /^[A-Za-z]\d{6}$/.test(bioguide)) return bioguide
  const slug = politician
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'unknown'
}

export function initials(name: string): string {
  const cleaned = name
    .replace(/,/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const words = cleaned.split(' ').filter((word) => word.replace(/\./g, '').length > 1)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

export function seatLabel(party: string | null, state: string | null, chamber: Chamber): string {
  const who = [party, state].filter(Boolean).join('-')
  const name = institutionName(chamber)
  return who ? `${who} · ${name}` : name
}

export function amountMid(min: number, max: number): number {
  return (min + max) / 2
}

function trimNumber(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value))
  return value.toFixed(1)
}

/** Compact dollars. 1001 → $1k, 15000 → $15k, 8000.5 → $8k, 3_000_000 → $3m. */
export function compactUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000
    const rounded = millions >= 10 ? Math.round(millions) : Math.round(millions * 10) / 10
    return `${sign}$${trimNumber(rounded)}m`
  }
  if (abs >= 1_000) {
    const thousands = abs / 1_000
    const rounded = thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10
    return `${sign}$${trimNumber(rounded)}k`
  }
  if (abs >= 100) return `${sign}$${Math.round(abs)}`
  return `${sign}$${trimNumber(Math.round(abs * 100) / 100)}`
}

export function formatRange(min: number, max: number, mid: number): string {
  return `${compactUsd(min)}–${compactUsd(max)} · mid ${compactUsd(mid)}`
}

export function formatSignedUsd(value: number): string {
  if (value > 0) return `+${compactUsd(value)}`
  return compactUsd(value)
}

export function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${(Math.abs(value) * 100).toFixed(1)}%`
}

export function formatRate(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value * 1000) / 10}%`
}

export function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatPx(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const negative = value < 0
  const [whole, frac] = Math.abs(value).toFixed(2).split('.')
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '−' : ''}$${withCommas}.${frac}`
}

/**
 * Hypothetical mark from the range midpoint.
 * Sells do not get a default cost basis: unrealized P&L stays empty.
 * Unquoted names stay markable as rows but are excluded from totals.
 */
export function markTrade(row: MarkInput): Mark {
  const price = row.tradeDateClose
  if (price == null || !(price > 0) || !Number.isFinite(row.amountMid)) {
    return { sharesEst: null, unrealizedEst: null, returnPct: null, includedInTotals: false }
  }
  const sharesEst = row.amountMid / price
  const quoted = Boolean(row.symbol) && row.lastClose != null && row.lastClose > 0
  if (row.transactionType !== 'BUY' || !quoted) {
    return { sharesEst, unrealizedEst: null, returnPct: null, includedInTotals: false }
  }
  const last = row.lastClose as number
  return {
    sharesEst,
    unrealizedEst: sharesEst * (last - price),
    returnPct: last / price - 1,
    includedInTotals: true,
  }
}

export function hypLine(mark: Mark, min: number, max: number, mid: number): string | null {
  if (mark.unrealizedEst == null) return null
  return `${formatSignedUsd(mark.unrealizedEst)} hyp. · ${formatPct(mark.returnPct)} · ${formatRange(min, max, mid)}`
}

export function summarizeMarks(rows: MarkInput[]): { rows: MarkInput[]; total: number; includedIds: string[] } {
  let total = 0
  const includedIds: string[] = []
  for (const row of rows) {
    const mark = markTrade(row)
    if (mark.includedInTotals && mark.unrealizedEst != null) {
      total += mark.unrealizedEst
      includedIds.push(row.id)
    }
  }
  return { rows, total, includedIds }
}

export function hasWatchRules(rules: WatchRules): boolean {
  return (
    rules.largeBuysOnly ||
    rules.members.length + rules.tickers.length + rules.parties.length + rules.chambers.length > 0
  )
}

export function isWatched(
  row: {
    memberId: string
    symbol: string | null
    party: string | null
    chamber: string
    transactionType: string
    amountMin: number
  },
  rules: WatchRules,
): boolean {
  if (rules.largeBuysOnly) {
    if (!(row.transactionType === 'BUY' && row.amountMin >= LARGE_AMOUNT_MIN)) return false
  }
  const checks: boolean[] = []
  const symbol = row.symbol
  const party = row.party
  if (rules.members.length) checks.push(rules.members.includes(row.memberId))
  if (rules.tickers.length) checks.push(symbol != null && rules.tickers.includes(symbol.toUpperCase()))
  if (rules.parties.length) checks.push(party != null && rules.parties.includes(party))
  if (rules.chambers.length) {
    checks.push(rules.chambers.includes(row.chamber) || rules.chambers.includes(institutionGroup(row.chamber)))
  }
  if (checks.length === 0) return rules.largeBuysOnly
  return checks.some(Boolean)
}

export function matchesChip(
  row: {
    transactionType: string
    late: boolean
    amountMin: number
    memberId: string
    symbol: string | null
    party: string | null
    chamber: string
  },
  chip: Chip,
  watches: WatchRules | null,
): boolean {
  switch (chip) {
    case 'all':
      return true
    case 'buys':
      return row.transactionType === 'BUY'
    case 'sells':
      return row.transactionType === 'SELL'
    case 'late':
      return row.late
    case 'large':
      return row.amountMin >= LARGE_AMOUNT_MIN
    case 'watches':
      return watches ? isWatched(row, watches) : false
    default:
      return true
  }
}

/** Every filing in this symbol, including both the original ticker and the Yahoo form. */
export function filingsForSymbol(rows: Filing[], sym: string): Filing[] {
  const want = sym.trim().toUpperCase()
  const yahoo = toYahooSymbol(want)
  return rows.filter((row) => row.symbol === want || row.yahooSymbol === yahoo || row.symbol === yahoo)
}

export function matchesQuery(
  row: { politician: string; symbol: string | null; assetName: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    row.politician.toLowerCase().includes(needle) ||
    (row.symbol ?? '').toLowerCase().includes(needle) ||
    row.assetName.toLowerCase().includes(needle)
  )
}

export function compareNewest(
  a: { filedDate: string; transactionDate: string; id: string },
  b: { filedDate: string; transactionDate: string; id: string },
): number {
  if (a.filedDate !== b.filedDate) return a.filedDate < b.filedDate ? 1 : -1
  if (a.transactionDate !== b.transactionDate) return a.transactionDate < b.transactionDate ? 1 : -1
  return a.id < b.id ? 1 : -1
}

export type AlertInput = {
  politician: string
  symbol: string | null
  assetName: string
  transactionType: string
  amountMin: number
  amountMax: number
  amountMid: number
  transactionDate: string
  filedDate: string
  officialUrl: string
}

/** Plain-text letter. Mail is not sent. Both range ends are written out. */
export function alertPreview(input: AlertInput): string {
  const tickerOrAsset = input.symbol?.trim() || input.assetName
  return [
    'FLOOR TAPE disclosure alert (preview — not sent)',
    `Member: ${input.politician}`,
    `Ticker: ${tickerOrAsset}`,
    `Asset: ${input.assetName}`,
    `Side: ${input.transactionType}`,
    `Range: ${formatRange(input.amountMin, input.amountMax, input.amountMid)}`,
    `Amount min: ${input.amountMin}`,
    `Amount max: ${input.amountMax}`,
    `Trade date: ${input.transactionDate}`,
    `Filed date: ${input.filedDate}`,
    `Filing: ${input.officialUrl}`,
  ].join('\n')
}

export function parseCsv(text: string): Record<string, string>[] {
  const source = text.replace(/^\uFEFF/, '').replace(/\r/g, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const header = rows.shift()
  if (!header) return []
  const keys = header.map((key) => key.trim())
  return rows
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => {
      const record: Record<string, string> = {}
      keys.forEach((key, index) => {
        record[key] = (cells[index] ?? '').trim()
      })
      return record
    })
}

export type ChamberInfo = { chamber: 'house' | 'senate' }

export function parseLegislators(text: string): Map<string, ChamberInfo> {
  const map = new Map<string, ChamberInfo>()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return map
  }
  if (!Array.isArray(data)) return map
  for (const row of data) {
    if (!row || typeof row !== 'object') continue
    const id = (row as { id?: { bioguide?: string } }).id
    const terms = (row as { terms?: { type?: string }[] }).terms
    const bioguide = id?.bioguide
    if (!bioguide || !Array.isArray(terms) || terms.length === 0) continue
    const term = terms[terms.length - 1]
    if (term?.type === 'sen') map.set(bioguide, { chamber: 'senate' })
    else if (term?.type === 'rep') map.set(bioguide, { chamber: 'house' })
  }
  return map
}

export function stableFilingId(parts: string[]): string {
  let a = 0x811c9dc5
  let b = 0x811c9dc5 ^ 0x9e3779b9
  let c = 0x811c9dc5 ^ 0x85ebca6b
  const source = parts.join('\u001f')
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i)
    a ^= code
    a = Math.imul(a, 0x01000193)
    b ^= code + i
    b = Math.imul(b, 0x85ebca6b)
    c ^= code * (i + 3)
    c = Math.imul(c, 0xc2b2ae35)
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `${hex(a)}${hex(b)}${hex(c)}`
}

function num(value: string | undefined): number | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildFilings(
  csv: string,
  legislators: Map<string, ChamberInfo>,
  source: FilingSource,
): Filing[] {
  const records = parseCsv(csv)
  const seen = new Map<string, number>()
  const filings: Filing[] = []
  for (const record of records) {
    const politician = record.politician?.trim()
    const transactionDate = record.transaction_date?.trim()
    const filedDate = record.filed_date?.trim()
    const min = num(record.amount_min)
    const max = num(record.amount_max)
    if (!politician || !transactionDate || !filedDate || min == null || max == null) continue
    if (!parseIsoDay(transactionDate) || !parseIsoDay(filedDate)) continue
    if (filedDate < FILED_SINCE) continue
    const lag = lagDays(transactionDate, filedDate)
    if (lag == null) continue
    const bioguide = record.bioguide_id?.trim() || null
    const chamber: Chamber = (bioguide && legislators.get(bioguide)?.chamber) || 'unknown'
    const ticker = resolveTicker(record.symbol)
    const ownerRaw = record.owner?.trim() || 'Self'
    const baseId = stableFilingId([
      politician,
      bioguide ?? '',
      ticker.symbol ?? '',
      record.asset_name ?? '',
      record.transaction_type ?? '',
      ownerRaw,
      transactionDate,
      filedDate,
      String(min),
      String(max),
    ])
    const dup = seen.get(baseId) ?? 0
    seen.set(baseId, dup + 1)
    const id = dup === 0 ? baseId : `${baseId}-${dup + 1}`
    filings.push({
      id,
      politician,
      memberId: memberIdFor(bioguide, politician),
      bioguideId: bioguide,
      party: record.party?.trim() || null,
      state: record.state?.trim() || null,
      chamber,
      symbol: ticker.symbol,
      yahooSymbol: ticker.yahooSymbol,
      assetName: record.asset_name?.trim() || ticker.symbol || 'Unknown asset',
      transactionType: normalizeSide(record.transaction_type ?? ''),
      owner: normalizeOwner(ownerRaw),
      ownerRaw,
      transactionDate,
      filedDate,
      lagDays: lag,
      late: lag > LATE_AFTER_DAYS,
      amountMin: min,
      amountMax: max,
      amountMid: amountMid(min, max),
      priceOnTradeDate: num(record.price_on_trade_date),
      officialUrl: officialPortal(chamber),
      source,
    })
  }
  filings.sort(compareNewest)
  return filings
}

export const SAMPLE_NOTICE = 'Sample book — not official filings.'

export const SAMPLE_LEGISLATORS_JSON = JSON.stringify([
  { id: { bioguide: 'P000197' }, terms: [{ type: 'rep' }] },
  { id: { bioguide: 'T000278' }, terms: [{ type: 'sen' }] },
  { id: { bioguide: 'G000583' }, terms: [{ type: 'rep' }] },
])

export const SAMPLE_CSV = `politician,bioguide_id,party,state,symbol,asset_name,transaction_type,owner,transaction_date,filed_date,amount_min,amount_max,price_on_trade_date
Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1000001,5000000,140.25
Nancy Pelosi,P000197,D,CA,AAPL,Apple Inc.,BUY,Spouse,2024-06-03,2024-06-28,1001,15000,190.40
Nancy Pelosi,P000197,D,CA,GOOGL,Alphabet Inc. Class A,BUY,Self + Spouse,2025-01-10,2025-01-28,50001,100000,180.10
Tommy Tuberville,T000278,R,AL,HUM,Humana Inc.,SELL,Self,2024-01-02,2024-03-15,15001,50000,450.00
Josh Gottheimer,G000583,D,NJ,MSFT,Microsoft Corporation,BUY,Joint,2024-08-01,2024-08-20,15001,50000,420.55
Josh Gottheimer,G000583,D,NJ,,Gottheimer Family LP,BUY,Self,2024-05-01,2024-05-20,1001,15000,
Riley Sample,,I,DC,IBM,International Business Machines,BUY,Self,2024-04-01,2024-04-20,1001,15000,180
`

function sampleWhiteHouseFiling(): Filing {
  const politician = 'Alex Sample'
  const transactionDate = '2024-03-01'
  const filedDate = '2024-03-18'
  const min = 1001
  const max = 15000
  const lag = lagDays(transactionDate, filedDate) ?? 0
  return {
    id: stableFilingId([politician, '', 'SMPL', 'Sample Industries', 'BUY', 'Self', transactionDate, filedDate, String(min), String(max)]),
    politician,
    memberId: memberIdFor(null, politician),
    bioguideId: null,
    party: null,
    state: null,
    chamber: 'whitehouse',
    symbol: 'SMPL',
    yahooSymbol: 'SMPL',
    assetName: 'Sample Industries',
    transactionType: 'BUY',
    owner: 'self',
    ownerRaw: 'Self',
    transactionDate,
    filedDate,
    lagDays: lag,
    late: lag > LATE_AFTER_DAYS,
    amountMin: min,
    amountMax: max,
    amountMid: amountMid(min, max),
    priceOnTradeDate: null,
    officialUrl: WHITE_HOUSE_DISCLOSURES,
    source: 'sample',
  }
}

export function sampleFilings(): Filing[] {
  return [...buildFilings(SAMPLE_CSV, parseLegislators(SAMPLE_LEGISLATORS_JSON), 'sample'), sampleWhiteHouseFiling()].sort(compareNewest)
}

export type MemberStats = {
  openHyp: number | null
  winRate: number | null
  avgVsSpy: number | null
  lateRate: number | null
  mappedBuys: number
  trades: number
}

export function memberStats(
  rows: Array<MarkInput & { late: boolean; transactionDate: string; transactionType: Side }>,
  spyOn: (date: string) => number | null,
  spyNow: number | null,
): MemberStats {
  const mapped = rows.filter((row) => row.transactionType === 'BUY' && markTrade(row).includedInTotals)
  const marks = mapped.map((row) => markTrade(row))
  const openHyp = marks.length ? marks.reduce((sum, mark) => sum + (mark.unrealizedEst ?? 0), 0) : null
  const wins = marks.filter((mark) => (mark.returnPct ?? 0) > 0).length
  const winRate = marks.length ? wins / marks.length : null
  let excess = 0
  let excessN = 0
  if (spyNow != null && spyNow > 0) {
    mapped.forEach((row, index) => {
      const ret = marks[index]?.returnPct
      const then = spyOn(row.transactionDate)
      if (ret == null || then == null || !(then > 0)) return
      excess += ret - (spyNow / then - 1)
      excessN++
    })
  }
  const lateRate = rows.length ? rows.filter((row) => row.late).length / rows.length : null
  return {
    openHyp,
    winRate,
    avgVsSpy: excessN ? excess / excessN : null,
    lateRate,
    mappedBuys: mapped.length,
    trades: rows.length,
  }
}

export type SpyBar = { symbol: string; hypReturn: number; spyReturn: number | null }

export function vsSpyBars(
  rows: Array<{
    symbol: string | null
    transactionType: Side
    amountMid: number
    transactionDate: string
    tradeDateClose: number | null
    lastClose: number | null
    id: string
  }>,
  spyOn: (date: string) => number | null,
  spyNow: number | null,
): SpyBar[] {
  const grouped = new Map<string, { weight: number; hyp: number; spy: number; spyWeight: number }>()
  for (const row of rows) {
    const mark = markTrade(row)
    if (!row.symbol || !mark.includedInTotals || mark.returnPct == null) continue
    const bucket = grouped.get(row.symbol) ?? { weight: 0, hyp: 0, spy: 0, spyWeight: 0 }
    bucket.weight += row.amountMid
    bucket.hyp += mark.returnPct * row.amountMid
    if (spyNow != null && spyNow > 0) {
      const then = spyOn(row.transactionDate)
      if (then != null && then > 0) {
        bucket.spy += (spyNow / then - 1) * row.amountMid
        bucket.spyWeight += row.amountMid
      }
    }
    grouped.set(row.symbol, bucket)
  }
  return [...grouped.entries()]
    .map(([symbol, bucket]) => ({
      symbol,
      hypReturn: bucket.weight ? bucket.hyp / bucket.weight : 0,
      spyReturn: bucket.spyWeight ? bucket.spy / bucket.spyWeight : null,
    }))
    .sort((a, b) => Math.abs(b.hypReturn) - Math.abs(a.hypReturn))
    .slice(0, 12)
}

export type LotTrade = {
  symbol: string | null
  transactionType: Side
  transactionDate: string
  amountMid: number
  tradeDateClose: number | null
  lastClose: number | null
}

/**
 * Experimental FIFO for one member, matched within each ticker.
 * Shares with no prior lot are ignored — no invented cost basis.
 */
export function fifoExperimental(trades: LotTrade[]): {
  realized: number | null
  openUnrealized: number | null
  experimental: true
} {
  const groups = new Map<string, LotTrade[]>()
  for (const trade of trades) {
    if (!trade.symbol || trade.tradeDateClose == null || !(trade.tradeDateClose > 0)) continue
    const list = groups.get(trade.symbol) ?? []
    list.push(trade)
    groups.set(trade.symbol, list)
  }
  let realized = 0
  let open = 0
  let any = false
  for (const list of groups.values()) {
    const ordered = [...list].sort((a, b) => {
      if (a.transactionDate !== b.transactionDate) return a.transactionDate < b.transactionDate ? -1 : 1
      if (a.transactionType === b.transactionType) return 0
      return a.transactionType === 'BUY' ? -1 : 1
    })
    const lots: { shares: number; price: number }[] = []
    const lastClose = [...ordered].reverse().find((trade) => trade.lastClose != null && trade.lastClose > 0)?.lastClose ?? null
    for (const trade of ordered) {
      const price = trade.tradeDateClose as number
      const shares = trade.amountMid / price
      if (trade.transactionType === 'BUY') {
        lots.push({ shares, price })
        any = true
      } else if (trade.transactionType === 'SELL') {
        let left = shares
        while (left > 1e-8 && lots.length > 0) {
          const lot = lots[0]
          const take = Math.min(lot.shares, left)
          realized += take * (price - lot.price)
          lot.shares -= take
          left -= take
          if (lot.shares <= 1e-8) lots.shift()
          any = true
        }
      }
    }
    if (lastClose != null) {
      for (const lot of lots) open += lot.shares * (lastClose - lot.price)
    }
  }
  if (!any) return { realized: null, openUnrealized: null, experimental: true }
  return { realized, openUnrealized: open, experimental: true }
}

export function closeOnOrBefore(series: { date: string; close: number }[], date: string): number | null {
  let best: number | null = null
  for (const bar of series) {
    if (bar.date <= date) best = bar.close
    else break
  }
  return best
}

export function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows
  if (max < 2) return rows.slice(0, max)
  const out: T[] = []
  const step = (rows.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)] as T)
  return out
}

export function sanitizeWatches(input: unknown): WatchRules {
  if (!input || typeof input !== 'object') return emptyWatches()
  const source = input as Partial<WatchRules>
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 200) : []
  return {
    members: list(source.members),
    tickers: list(source.tickers).map((ticker) => ticker.toUpperCase()),
    parties: list(source.parties),
    chambers: list(source.chambers),
    largeBuysOnly: Boolean(source.largeBuysOnly),
  }
}
