import { presentTicker, priceFilings } from '../domain/pricing'
import { clearQuoteCache, readSeries, type Bar, type FetchLike } from '../domain/quotes'
import { ingestFilings, type IngestResult } from '../domain/ingest'
import {
  closeOnOrBefore,
  compareNewest,
  isChip,
  matchesChip,
  matchesQuery,
  memberStats,
  sanitizeWatches,
  vsSpyBars,
  type Chamber,
  type Filing,
  type Side,
  type WatchRules,
} from '../domain/pure'
import { toView, type ViewFiling } from '../domain/view'
import { getDb, readMigrationSql } from './db'

const HILLSCORE_CSV = 'https://hillscore.com/data/files/trades.csv'
const LEGISLATORS_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json'

const yahooFetch: FetchLike = async (url, init) => {
  const response = await fetch(url, {
    headers: init?.headers,
    signal: AbortSignal.timeout(8000),
  })
  return { ok: response.ok, status: response.status, text: () => response.text() }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'FloorTape/1.0 (disclosure tracker)', accept: 'text/csv,application/json,text/plain,*/*' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}

let inflight: Promise<IngestResult> | null = null

export function ensureIngest(force = false): Promise<IngestResult> {
  if (!force && inflight) return inflight
  const run = (async () => {
    const db = await getDb()
    const schemaSql = await readMigrationSql()
    const result = await ingestFilings(db, {
      schemaSql,
      force,
      fetchCsv: () => fetchText(HILLSCORE_CSV),
      fetchLegislators: () => fetchText(LEGISLATORS_URL),
    })
    console.log(`[floor-tape] source=${result.source} rows=${result.count} refreshed=${result.refreshed} sample=${result.labeledSample}`)
    return result
  })()
  inflight = run
  void run.finally(() => {
    if (inflight === run) inflight = null
  })
  return run
}

type Meta = {
  lastIngestAt: string | null
  source: 'sample' | 'hillscore'
  labeledSample: boolean
  rowCount: number
}

function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true'
}

async function readMeta(): Promise<Meta> {
  const db = await getDb()
  const rows = await db.query<{
    last_ingest_at: string | null
    source: string | null
    labeled_sample: unknown
    row_count: number | string | null
  }>('SELECT last_ingest_at, source, labeled_sample, row_count FROM ingest_state WHERE id = 1')
  const row = rows[0]
  const labeledSample = asBool(row?.labeled_sample) || row?.source === 'sample'
  return {
    lastIngestAt: row?.last_ingest_at ?? null,
    source: labeledSample ? 'sample' : 'hillscore',
    labeledSample,
    rowCount: Number(row?.row_count ?? 0),
  }
}

let rowCache: { key: string; rows: Filing[] } | null = null

function mapRow(row: Record<string, unknown>): Filing {
  const text = (value: unknown) => {
    if (value == null) return null
    const string = String(value).trim()
    return string ? string : null
  }
  const numberOrNull = (value: unknown) => {
    if (value == null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const side = row.transaction_type
  const chamber = row.chamber
  return {
    id: String(row.id),
    politician: String(row.politician),
    memberId: String(row.member_id),
    bioguideId: text(row.bioguide_id),
    party: text(row.party),
    state: text(row.state),
    chamber: chamber === 'house' || chamber === 'senate' ? chamber : 'unknown',
    symbol: text(row.symbol),
    yahooSymbol: text(row.yahoo_symbol),
    assetName: String(row.asset_name),
    transactionType: side === 'BUY' || side === 'SELL' ? side : 'OTHER',
    owner: String(row.owner),
    ownerRaw: String(row.owner_raw ?? row.owner),
    transactionDate: String(row.transaction_date),
    filedDate: String(row.filed_date),
    lagDays: Number(row.lag_days),
    late: asBool(row.late),
    amountMin: Number(row.amount_min),
    amountMax: Number(row.amount_max),
    amountMid: Number(row.amount_mid),
    priceOnTradeDate: numberOrNull(row.price_on_trade_date),
    officialUrl: String(row.official_url),
    source: row.source === 'sample' ? 'sample' : 'hillscore',
  }
}

async function allFilings(): Promise<Filing[]> {
  const meta = await readMeta()
  const key = `${meta.lastIngestAt}|${meta.rowCount}|${meta.source}`
  if (rowCache?.key === key) return rowCache.rows
  const db = await getDb()
  const raw = await db.query<Record<string, unknown>>('SELECT * FROM filings')
  const rows = raw.map(mapRow).sort(compareNewest)
  rowCache = { key, rows }
  return rows
}

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run()
  } catch (error) {
    console.error('[floor-tape] price lookup failed', error instanceof Error ? error.message : error)
    return fallback
  }
}

async function withPrices(rows: Filing[], seriesSymbol?: string | null) {
  try {
    return await priceFilings(rows, yahooFetch, seriesSymbol)
  } catch (error) {
    console.error('[floor-tape] price lookup failed', error instanceof Error ? error.message : error)
    return { filings: rows.map((row) => toView(row, row.priceOnTradeDate, null)), series: [] }
  }
}

export type TapePayload = {
  filings: ViewFiling[]
  totalMatched: number
  labeledSample: boolean
  source: 'sample' | 'hillscore'
  chip: string
  q: string
}

export async function getTape(input: { chip: string; q: string; watches: WatchRules | null }): Promise<TapePayload> {
  await ensureIngest(false)
  const meta = await readMeta()
  const chip = isChip(input.chip) ? input.chip : 'all'
  const q = (input.q ?? '').slice(0, 80)
  const watches = sanitizeWatches(input.watches)
  const matched = (await allFilings()).filter((row) => matchesQuery(row, q) && matchesChip(row, chip, watches))
  const slice = matched.slice(0, 100)
  const { filings } = await withPrices(slice)
  return { filings, totalMatched: matched.length, labeledSample: meta.labeledSample, source: meta.source, chip, q }
}

export async function searchTape(query: string): Promise<{ filings: ViewFiling[]; total: number }> {
  await ensureIngest(false)
  const q = query.slice(0, 80)
  const matched = (await allFilings()).filter((row) => matchesQuery(row, q))
  const { filings } = await withPrices(matched.slice(0, 12))
  return { filings, total: matched.length }
}

export async function getTrade(id: string): Promise<{ filing: ViewFiling | null; series: Bar[]; labeledSample: boolean }> {
  await ensureIngest(false)
  const meta = await readMeta()
  const row = (await allFilings()).find((filing) => filing.id === id) ?? null
  if (!row) return { filing: null, series: [], labeledSample: meta.labeledSample }
  const { filings, series } = await withPrices([row], row.yahooSymbol)
  return { filing: filings[0] ?? null, series, labeledSample: meta.labeledSample }
}

export type RosterMember = {
  memberId: string
  politician: string
  party: string | null
  state: string | null
  chamber: Chamber
  trades: number
  lastFiled: string
  initials: string
  seat: string
}

function rosterFrom(rows: Filing[]): RosterMember[] {
  const map = new Map<string, RosterMember>()
  for (const row of rows) {
    const current = map.get(row.memberId)
    if (!current) {
      const view = toView(row, row.priceOnTradeDate, null)
      map.set(row.memberId, {
        memberId: row.memberId,
        politician: row.politician,
        party: row.party,
        state: row.state,
        chamber: row.chamber,
        trades: 1,
        lastFiled: row.filedDate,
        initials: view.initials,
        seat: view.seat,
      })
      continue
    }
    current.trades += 1
    if (row.filedDate > current.lastFiled) {
      const view = toView(row, row.priceOnTradeDate, null)
      current.lastFiled = row.filedDate
      current.politician = row.politician
      current.party = row.party
      current.state = row.state
      current.chamber = row.chamber
      current.initials = view.initials
      current.seat = view.seat
    }
  }
  return [...map.values()].sort((a, b) => (a.lastFiled < b.lastFiled ? 1 : a.lastFiled > b.lastFiled ? -1 : a.politician.localeCompare(b.politician)))
}

export async function getMembers(): Promise<{ members: RosterMember[]; labeledSample: boolean; count: number }> {
  await ensureIngest(false)
  const meta = await readMeta()
  const rows = await allFilings()
  return { members: rosterFrom(rows), labeledSample: meta.labeledSample, count: rows.length }
}

export type MemberPayload = {
  member: RosterMember | null
  stats: ReturnType<typeof memberStats> | null
  bars: ReturnType<typeof vsSpyBars>
  filings: ViewFiling[]
  total: number
  labeledSample: boolean
  lots: {
    symbol: string | null
    transactionType: Side
    transactionDate: string
    amountMid: number
    tradeDateClose: number | null
    lastClose: number | null
  }[]
}

export async function getMember(id: string): Promise<MemberPayload> {
  await ensureIngest(false)
  const meta = await readMeta()
  const rows = (await allFilings()).filter((row) => row.memberId === id)
  if (rows.length === 0) {
    return { member: null, stats: null, bars: [], filings: [], total: 0, labeledSample: meta.labeledSample, lots: [] }
  }
  const { filings: priced } = await withPrices(rows)
  const spy = await safe(() => readSeries('SPY', yahooFetch, '5y'), [])
  const spyNow = spy.length > 0 ? spy[spy.length - 1].close : null
  const spyOn = (date: string) => closeOnOrBefore(spy, date)
  const stats = memberStats(priced, spyOn, spyNow)
  const bars = vsSpyBars(priced, spyOn, spyNow)
  const member = rosterFrom(rows)[0] ?? null
  return {
    member,
    stats,
    bars,
    filings: priced.slice(0, 120),
    total: priced.length,
    labeledSample: meta.labeledSample,
    lots: priced.map((row) => ({
      symbol: row.symbol,
      transactionType: row.transactionType,
      transactionDate: row.transactionDate,
      amountMid: row.amountMid,
      tradeDateClose: row.tradeDateClose,
      lastClose: row.lastClose,
    })),
  }
}

export async function getTicker(sym: string): Promise<{
  symbol: string
  filings: ViewFiling[]
  total: number
  series: Bar[]
  lastClose: number | null
  labeledSample: boolean
}> {
  await ensureIngest(false)
  const meta = await readMeta()
  const presented = await presentTicker(await allFilings(), sym, yahooFetch)
  return { ...presented, labeledSample: meta.labeledSample }
}

export async function getAlerts(): Promise<{
  members: RosterMember[]
  latest: ViewFiling[]
  labeledSample: boolean
}> {
  await ensureIngest(false)
  const meta = await readMeta()
  const rows = await allFilings()
  const { filings } = await withPrices(rows.slice(0, 80))
  return { members: rosterFrom(rows), latest: filings, labeledSample: meta.labeledSample }
}

export async function getAbout(): Promise<Meta> {
  await ensureIngest(false)
  return readMeta()
}

export async function refreshTape(): Promise<IngestResult> {
  clearQuoteCache()
  rowCache = null
  return ensureIngest(true)
}
