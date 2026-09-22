import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { HOUSE_PORTAL, SENATE_PORTAL } from './pure'
import { ingestFilings, type Db } from './ingest'

const schemaPath = path.join(process.cwd(), 'migrations/0002_filings.sql')
const schemaSql = readFileSync(schemaPath, 'utf8')

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
})
