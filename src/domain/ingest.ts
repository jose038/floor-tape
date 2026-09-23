import { parsePeriodicReport, type DisclosureDocument } from './disclosure'
import {
  SAMPLE_CSV,
  SAMPLE_LEGISLATORS_JSON,
  buildFilings,
  compareNewest,
  parseLegislators,
  sampleFilings,
  shouldRefresh,
  type Filing,
} from './pure'

export type Db = {
  exec(sql: string): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}

export type DisclosureBatch = {
  documents: DisclosureDocument[]
  omissions: string[]
}

export type IngestDeps = {
  schemaSql: string
  now?: Date
  force?: boolean
  fetchCsv: () => Promise<string>
  fetchLegislators?: () => Promise<string>
  fetchDisclosures?: () => Promise<DisclosureBatch>
}

export type IngestResult = {
  refreshed: boolean
  source: 'sample' | 'hillscore'
  labeledSample: boolean
  count: number
}

const COLUMNS = [
  'id',
  'politician',
  'member_id',
  'bioguide_id',
  'party',
  'state',
  'chamber',
  'symbol',
  'yahoo_symbol',
  'asset_name',
  'transaction_type',
  'owner',
  'owner_raw',
  'transaction_date',
  'filed_date',
  'lag_days',
  'late',
  'amount_min',
  'amount_max',
  'amount_mid',
  'price_on_trade_date',
  'official_url',
  'source',
] as const

export function splitSql(sql: string): string[] {
  return sql
    .split(';')
    .map((part) => part.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean)
}

export async function ensureSchema(db: Db, sql: string): Promise<void> {
  for (const statement of splitSql(sql)) {
    await db.exec(statement)
  }
}

type StateRow = {
  last_ingest_at: string | null
  source: string | null
  labeled_sample: boolean | number | string | null
  row_count: number | string | null
}

function asBool(value: boolean | number | string | null | undefined): boolean {
  return value === true || value === 1 || value === '1' || value === 't' || value === 'true'
}

async function readState(db: Db): Promise<StateRow | null> {
  const rows = await db.query<StateRow>(
    'SELECT last_ingest_at, source, labeled_sample, row_count FROM ingest_state WHERE id = 1',
  )
  return rows[0] ?? null
}

async function countFilings(db: Db): Promise<number> {
  const rows = await db.query<{ n: number | string }>('SELECT COUNT(*) AS n FROM filings')
  return Number(rows[0]?.n ?? 0)
}

function paramsFor(row: Filing): unknown[] {
  return [
    row.id,
    row.politician,
    row.memberId,
    row.bioguideId,
    row.party,
    row.state,
    row.chamber,
    row.symbol,
    row.yahooSymbol,
    row.assetName,
    row.transactionType,
    row.owner,
    row.ownerRaw,
    row.transactionDate,
    row.filedDate,
    row.lagDays,
    row.late,
    row.amountMin,
    row.amountMax,
    row.amountMid,
    row.priceOnTradeDate,
    row.officialUrl,
    row.source,
  ]
}

function uniqueFilings(rows: Filing[]): Filing[] {
  const seen = new Set<string>()
  const unique: Filing[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    unique.push(row)
  }
  return unique
}

async function replaceFilings(db: Db, rows: Filing[], labeledSample: boolean, now: Date, omissions = ''): Promise<void> {
  await db.exec('BEGIN')
  try {
    await db.exec('DELETE FROM filings')
    const size = 40
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size)
      const values: string[] = []
      const params: unknown[] = []
      chunk.forEach((row, rowIndex) => {
        const placeholders = COLUMNS.map((_, colIndex) => `$${rowIndex * COLUMNS.length + colIndex + 1}`)
        values.push(`(${placeholders.join(',')})`)
        params.push(...paramsFor(row))
      })
      await db.query(
        `INSERT INTO filings (${COLUMNS.join(',')}) VALUES ${values.join(',')}`,
        params,
      )
    }
    await db.query(
      `INSERT INTO ingest_state (id, last_ingest_at, source, labeled_sample, row_count, omissions)
       VALUES (1, $1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         last_ingest_at = EXCLUDED.last_ingest_at,
         source = EXCLUDED.source,
         labeled_sample = EXCLUDED.labeled_sample,
         row_count = EXCLUDED.row_count,
         omissions = EXCLUDED.omissions`,
      [now.toISOString(), labeledSample ? 'sample' : 'hillscore', labeledSample, rows.length, omissions],
    )
    await db.exec('COMMIT')
  } catch (error) {
    try {
      await db.exec('ROLLBACK')
    } catch {
      /* the failed statement already aborted the transaction */
    }
    throw error
  }
}

async function stampFailure(db: Db, now: Date): Promise<void> {
  const state = await readState(db)
  if (!state) return
  await db.query('UPDATE ingest_state SET last_ingest_at = $1 WHERE id = 1', [now.toISOString()])
}

/**
 * Real ingest entry. A failed Hillscore fetch seeds the labeled sample book
 * only when no live rows are already stored. A successful file replaces every row.
 */
export async function ingestFilings(db: Db, deps: IngestDeps): Promise<IngestResult> {
  await ensureSchema(db, deps.schemaSql)
  const now = deps.now ?? new Date()
  const force = deps.force ?? false
  const state = await readState(db)
  const existing = await countFilings(db)
  if (!shouldRefresh(state?.last_ingest_at ?? null, now, force) && existing > 0) {
    const labeledSample = asBool(state?.labeled_sample) || state?.source === 'sample'
    return {
      refreshed: false,
      source: labeledSample ? 'sample' : 'hillscore',
      labeledSample,
      count: existing,
    }
  }

  let csv: string | null = null
  let legislatorsJson: string | null = null
  try {
    csv = await deps.fetchCsv()
    if (!csv.includes('politician') || !csv.includes('filed_date')) {
      throw new Error('Hillscore CSV header was not the expected trades file')
    }
    if (deps.fetchLegislators) {
      try {
        legislatorsJson = await deps.fetchLegislators()
      } catch {
        legislatorsJson = null
      }
    }
    const filings = buildFilings(csv, parseLegislators(legislatorsJson ?? '[]'), 'hillscore')
    if (filings.length === 0) throw new Error('Hillscore CSV had no filings on or after 2023-01-01')
    const extra: Filing[] = []
    const omissionNotes = new Map<string, { rank: number; line: string }>()
    const labelsWithRows = new Set<string>()
    const putOmission = (label: string, message: string, rank: number) => {
      const line = `${label}: ${message}`
      const prev = omissionNotes.get(label)
      if (!prev || rank > prev.rank) omissionNotes.set(label, { rank, line })
    }
    if (deps.fetchDisclosures) {
      try {
        const batch = await deps.fetchDisclosures()
        for (const line of batch.omissions) {
          const split = line.indexOf(': ')
          if (split === -1) putOmission(line, 'report could not be parsed', 1)
          else putOmission(line.slice(0, split), line.slice(split + 2), 1)
        }
        for (const doc of batch.documents) {
          const parsed = parsePeriodicReport(doc.text, {
            url: doc.url,
            source: 'disclosure',
            hint: doc.hint,
            label: doc.label,
          })
          if (parsed.length === 0) {
            if (!labelsWithRows.has(doc.label)) putOmission(doc.label, 'no securities transaction parsed', 2)
            continue
          }
          extra.push(...parsed)
          labelsWithRows.add(doc.label)
          if (doc.truncated) putOmission(doc.label, 'pages after the first parsed section were not parsed', 3)
          else omissionNotes.delete(doc.label)
        }
        for (const label of labelsWithRows) {
          const note = omissionNotes.get(label)
          if (note && note.rank < 3) omissionNotes.delete(label)
        }
      } catch {
        putOmission('Disclosure reports', 'could not be fetched', 1)
      }
    }
    const merged = uniqueFilings([...filings, ...extra]).sort(compareNewest)
    const omissions = [...omissionNotes.values()].map((note) => note.line).join('\n')
    await replaceFilings(db, merged, false, now, omissions)
    return { refreshed: true, source: 'hillscore', labeledSample: false, count: merged.length }
  } catch {
    if (existing > 0 && state?.source === 'hillscore') {
      await stampFailure(db, now)
      return { refreshed: false, source: 'hillscore', labeledSample: false, count: existing }
    }
    const filings = sampleFilings()
    if (SAMPLE_CSV.length === 0 || filings.length === 0) {
      throw new Error('Sample book failed to build')
    }
    // Touch the constant so a bad edit that drops the embedded legislator JSON fails loudly.
    parseLegislators(SAMPLE_LEGISLATORS_JSON)
    await replaceFilings(db, filings, true, now)
    return { refreshed: true, source: 'sample', labeledSample: true, count: filings.length }
  }
}
