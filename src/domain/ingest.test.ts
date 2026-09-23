import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { parsePeriodicReport } from './disclosure'
import { HOUSE_PORTAL, SENATE_PORTAL } from './pure'
import { buildRoster, filingFromRow } from './roster'
import { ingestFilings, type Db } from './ingest'
import { listMigrationFiles } from './migrations'

const schemaPath = path.join(process.cwd(), 'migrations/0002_filings.sql')
const schemaSql = listMigrationFiles(readdirSync(path.join(process.cwd(), 'migrations')))
  .map((name) => readFileSync(path.join(process.cwd(), 'migrations', name), 'utf8'))
  .join('\n')

const HEADER =
  'politician,bioguide_id,party,state,symbol,asset_name,transaction_type,owner,transaction_date,filed_date,amount_min,amount_max,price_on_trade_date'

function adapter(db: PGlite): Db {
  return {
    exec: async (sql) => {
      await db.exec(sql)
    },
    query: async <T>(sql: string, params: unknown[] = []) => {
      const result = await db.query<T>(sql, params)
      return result.rows
    },
  }
}

describe('hillscore ingest', () => {
  let db: PGlite

  beforeEach(async () => {
    db = new PGlite()
  })

  it('schema sql has no user_id column', () => {
    expect(schemaSql.toLowerCase().includes('user_id')).toBe(false)
    expect(schemaPath.endsWith('0002_filings.sql') || schemaPath.includes('0002_')).toBe(true)
  })

  it('failure yields a labeled sample tape containing Pelosi, Tuberville, and Gottheimer', async () => {
    const result = await ingestFilings(adapter(db), {
      schemaSql,
      force: true,
      now: new Date('2026-09-22T12:00:00.000Z'),
      fetchCsv: async () => {
        throw new Error('hillscore down')
      },
    })
    const rows = await db.query<{
      politician: string
      source: string
      official_url: string
    }>('SELECT politician, source, official_url FROM filings')
    const names = rows.rows.map((row) => row.politician).join(' | ')
    console.log('SAMPLE', names)
    console.log('labeled', result.labeledSample, 'source', result.source)
    expect(result.labeledSample).toBe(true)
    expect(result.source).toBe('sample')
    expect(names).toContain('Pelosi')
    expect(names).toContain('Tuberville')
    expect(names).toContain('Gottheimer')
    expect(rows.rows.every((row) => row.source === 'sample')).toBe(true)
    expect(rows.rows.some((row) => row.official_url === HOUSE_PORTAL)).toBe(true)
    expect(rows.rows.some((row) => row.official_url === SENATE_PORTAL)).toBe(true)
    const columns = await db.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'filings'",
    )
    expect(columns.rows.map((row) => row.column_name)).not.toContain('user_id')
  })

  it('fixture replaces the sample, drops pre-2023 rows, and keeps only fixture rows', async () => {
    await ingestFilings(adapter(db), {
      schemaSql,
      force: true,
      now: new Date('2026-09-22T12:00:00.000Z'),
      fetchCsv: async () => {
        throw new Error('hillscore down')
      },
    })
    const fixture = [
      HEADER,
      '"Gilbert Ray Cisneros, Jr.",C001123,D,CA,DASH,"DoorDash, Inc. Class A",SELL,Self + Spouse,2024-04-01,2024-06-01,1001,15000,210.5',
      'Old Trader,Z000001,R,TX,IBM,International Business Machines,BUY,Self,2022-01-04,2022-02-01,1001,15000,130',
      'Jane Live,L000111,D,NY,SPY,SPDR S&P 500 ETF Trust,BUY,Joint,2024-03-01,2024-03-20,100001,250000,500',
    ].join('\n')
    const legislators = JSON.stringify([
      { id: { bioguide: 'C001123' }, terms: [{ type: 'rep' }] },
      { id: { bioguide: 'L000111' }, terms: [{ type: 'sen' }] },
    ])
    const result = await ingestFilings(adapter(db), {
      schemaSql,
      force: true,
      now: new Date('2026-09-22T12:05:00.000Z'),
      fetchCsv: async () => fixture,
      fetchLegislators: async () => legislators,
    })
    const rows = await db.query<{
      politician: string
      amount_min: number
      amount_max: number
      amount_mid: number
      owner: string
      transaction_date: string
      filed_date: string
      official_url: string
      source: string
      symbol: string | null
    }>('SELECT politician, amount_min, amount_max, amount_mid, owner, transaction_date, filed_date, official_url, source, symbol FROM filings ORDER BY politician')
    const names = rows.rows.map((row) => row.politician)
    console.log('FIXTURE', names.join(' | '))
    console.log('count', rows.rows.length, 'labeled', result.labeledSample)
    expect(result.labeledSample).toBe(false)
    expect(result.source).toBe('hillscore')
    expect(names).toContain('Gilbert Ray Cisneros, Jr.')
    expect(names).not.toContain('Old Trader')
    expect(names.some((name) => name.includes('Pelosi'))).toBe(false)
    expect(names.some((name) => name.includes('Tuberville'))).toBe(false)
    expect(names.some((name) => name.includes('Gottheimer'))).toBe(false)
    expect(rows.rows).toHaveLength(2)
    const cisneros = rows.rows.find((row) => row.politician.includes('Cisneros'))
    expect(cisneros).toBeTruthy()
    expect(Number(cisneros!.amount_min)).toBe(1001)
    expect(Number(cisneros!.amount_max)).toBe(15000)
    expect(Number(cisneros!.amount_mid)).toBe(8000.5)
    expect(cisneros!.owner).toBe('self+spouse')
    expect(cisneros!.transaction_date).toBe('2024-04-01')
    expect(cisneros!.filed_date).toBe('2024-06-01')
    expect(cisneros!.official_url).toBe(HOUSE_PORTAL)
    expect(cisneros!.source).toBe('hillscore')
    const jane = rows.rows.find((row) => row.politician === 'Jane Live')
    expect(jane?.official_url).toBe(SENATE_PORTAL)
    console.log('persisted', cisneros)
  })

  it('stores a Trump periodic report under White House beside House and Senate rows', async () => {
    const trumpText = `PERIODIC TRANSACTION REPORT
Filer: Donald J. Trump
Position: President of the United States
Date of Report: August 12, 2025
27
WISCONSIN ST HLTH & EFA REV ADVOCATE HLTH HOSP
Purchase 7/17/25
52
BLACK BELT ENERGY GAS DIST
Purchase 7/11/25
Amount
100,001-250,000
Amount
1,000,001-5,000,000
`
    const wilesText = `Periodic Transaction Report (OGE Form 278-T)
Filer's Information
Wiles, Susie
Assistant to the President and Chief of Staff, Trump-Vance (2025) - White House
/s/ Wiles, Susie [electronically signed on 06/13/2025 by Wiles, Susie in Integrity.gov]
1 Procter & Gamble Co. (PG) Sale 06/09/2025 No $15,001 - $50,000
`
    const fixture = [
      HEADER,
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1000001,5000000,140',
      'Tommy Tuberville,T000278,R,AL,HUM,Humana Inc.,SELL,Self,2024-01-02,2024-03-15,15001,50000,450',
    ].join('\n')
    const trumpUrl =
      'https://www.whitehouse.gov/wp-content/uploads/2026/01/President-Donald-J.-Trump-Periodic-Transaction-Report-Amendment-1.14.26.pdf'
    const wilesUrl = 'https://www.whitehouse.gov/wp-content/uploads/2025/11/Wiles-Susie-Periodic-Transaction-Report.pdf'
    const parsed = parsePeriodicReport(trumpText, { url: trumpUrl, source: 'disclosure', hint: 'whitehouse' })
    expect(parsed.some((row) => row.politician.includes('Trump'))).toBe(true)
    const result = await ingestFilings(adapter(db), {
      schemaSql,
      force: true,
      now: new Date('2026-09-23T12:00:00.000Z'),
      fetchCsv: async () => fixture,
      fetchLegislators: async () =>
        JSON.stringify([
          { id: { bioguide: 'P000197' }, terms: [{ type: 'rep' }] },
          { id: { bioguide: 'T000278' }, terms: [{ type: 'sen' }] },
        ]),
      fetchDisclosures: async () => ({
        omissions: [],
        documents: [
          { label: 'President Donald J. Trump Periodic Transaction Report Amendment', url: trumpUrl, text: trumpText, hint: 'whitehouse' },
          { label: 'Wiles, Susie Periodic Transaction Report', url: wilesUrl, text: wilesText, hint: 'whitehouse' },
        ],
      }),
    })
    const stored = await db.query<Record<string, unknown>>('SELECT * FROM filings')
    const filings = stored.rows.map((row) => filingFromRow(row))
    const roster = buildRoster(filings)
    const trump = roster.find((member) => member.politician.includes('Trump'))
    const pelosi = roster.find((member) => member.politician.includes('Pelosi'))
    const tuberville = roster.find((member) => member.politician.includes('Tuberville'))
    console.log(
      'roster',
      roster.map((member) => `${member.politician}:${member.chamber}`).join(' | '),
      'count',
      result.count,
    )
    expect(result.labeledSample).toBe(false)
    expect(trump?.chamber).toBe('whitehouse')
    expect(trump?.seat).toBe('White House')
    expect(pelosi?.chamber).toBe('house')
    expect(tuberville?.chamber).toBe('senate')
    expect(filings.some((row) => row.politician.includes('Wiles') && row.chamber === 'whitehouse')).toBe(true)
    expect(filings.find((row) => row.politician.includes('Trump'))?.officialUrl).toContain('whitehouse.gov')
  })

  it('records one truthful omission line per disclosure label', async () => {
    const amendmentUrl =
      'https://www.whitehouse.gov/wp-content/uploads/2026/01/President-Donald-J.-Trump-Periodic-Transaction-Report-Amendment-1.14.26.pdf'
    const hugeUrl =
      'https://www.whitehouse.gov/wp-content/uploads/2026/08/President-Donald-J.-Trump-Periodic-Transaction-Report-08.12.26.pdf'
    const amendmentLabel = 'President Donald J. Trump Periodic Transaction Report Amendment 01.14.26'
    const hugeLabel = 'President Donald J. Trump Periodic Transaction Report 08.12.26'
    const trumpText = `PERIODIC TRANSACTION REPORT
Filer: Donald J. Trump
Position: President of the United States
Date of Report: August 12, 2025
27
WISCONSIN ST HLTH & EFA REV ADVOCATE HLTH HOSP
Purchase 7/17/25
Amount
100,001-250,000
`
    await ingestFilings(adapter(db), {
      schemaSql,
      force: true,
      now: new Date('2026-09-23T16:00:00.000Z'),
      fetchCsv: async () => [HEADER, 'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140'].join('\n'),
      fetchLegislators: async () => JSON.stringify([{ id: { bioguide: 'P000197' }, terms: [{ type: 'rep' }] }]),
      fetchDisclosures: async () => ({
        omissions: [`${hugeLabel}: pages after the first parsed section were not parsed`],
        documents: [
          { label: hugeLabel, url: hugeUrl, text: 'not a transaction report', hint: 'whitehouse', truncated: true },
          { label: hugeLabel, url: hugeUrl, text: 'still not a transaction report', hint: 'whitehouse', truncated: true },
          { label: amendmentLabel, url: amendmentUrl, text: trumpText, hint: 'whitehouse', truncated: true },
        ],
      }),
    })
    const state = await db.query<{ omissions: string }>('SELECT omissions FROM ingest_state WHERE id = 1')
    const lines = (state.rows[0]?.omissions ?? '').split('\n').filter(Boolean)
    const labels = lines.map((line) => line.split(':')[0])
    expect(new Set(labels).size).toBe(labels.length)
    expect(lines.filter((line) => line.startsWith(hugeLabel))).toEqual([`${hugeLabel}: no securities transaction parsed`])
    expect(lines.filter((line) => line.startsWith(amendmentLabel))).toEqual([
      `${amendmentLabel}: pages after the first parsed section were not parsed`,
    ])
    const stored = await db.query<{ official_url: string; n: number }>(
      'SELECT official_url, COUNT(*)::int AS n FROM filings WHERE politician ILIKE $1 GROUP BY official_url',
      ['%Trump%'],
    )
    expect(stored.rows.find((row) => row.official_url === hugeUrl)?.n ?? 0).toBe(0)
    expect(Number(stored.rows.find((row) => row.official_url === amendmentUrl)?.n ?? 0)).toBeGreaterThan(0)
  })
})
