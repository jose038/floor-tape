import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { listMigrationFiles } from '../domain/migrations'
import type { PushMessage } from '../domain/notify'
import { REFRESH_INTERVAL_MS } from '../domain/pure'
import { ensureSchema, ingestFilings, type Db } from '../domain/ingest'
import { PULL_SLOT } from './single-flight'
import { handlePoll, runPoll, saveSubscription, type PushSubscriptionRecord } from './notify'

const schemaSql = listMigrationFiles(['0002_filings.sql', '0003_push.sql', '0004_omissions.sql'])
  .map((name) => readFileSync(path.join(process.cwd(), 'migrations', name), 'utf8'))
  .join('\n')

const header =
  'politician,bioguide_id,party,state,symbol,asset_name,transaction_type,owner,transaction_date,filed_date,amount_min,amount_max,price_on_trade_date'

function csv(lines: string[]): string {
  return [header, ...lines].join('\n')
}

function adapter(db: PGlite): Db {
  return {
    exec: async (sql) => {
      await db.exec(sql)
    },
    query: async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows,
  }
}

describe('poll notifies only filings that arrived after the cursor', () => {
  it('seeds silently, then pushes the new filing', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    await ensureSchema(db, schemaSql)
    const sent: PushMessage[] = []
    const send = async (_subscription: PushSubscriptionRecord, message: PushMessage) => {
      sent.push(message)
      return 'ok' as const
    }
    const start = new Date('2026-06-01T00:00:00.000Z')
    const first = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    const seeded = await runPoll(db, { schemaSql, fetchCsv: async () => first, send, now: start })
    expect(seeded.seeded).toBe(true)
    expect(seeded.sent).toBe(0)
    expect(sent).toHaveLength(0)

    await saveSubscription(db, {
      endpoint: 'https://push.example/device',
      keys: { p256dh: 'key', auth: 'auth' },
    })
    const second = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
      'Josh Gottheimer,G000583,D,NJ,MSFT,Microsoft Corporation,BUY,Joint,2024-12-01,2024-12-10,1001,15000,420',
    ])
    const updated = await runPoll(db, {
      schemaSql,
      fetchCsv: async () => second,
      send,
      now: new Date(start.getTime() + REFRESH_INTERVAL_MS),
    })
    expect(updated.seeded).toBe(false)
    expect(updated.fresh).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.title).toContain('Josh Gottheimer')
    expect(sent[0]?.title).toContain('MSFT')
    expect(sent[0]?.title).toContain('BUY')
    expect(sent[0]?.body).toContain('$1k–$15k · mid $8k')
    expect(sent[0]?.url.startsWith('/trade/')).toBe(true)

    sent.length = 0
    const again = await runPoll(db, {
      schemaSql,
      fetchCsv: async () => second,
      send,
      now: new Date(start.getTime() + REFRESH_INTERVAL_MS * 2),
    })
    expect(again.changed).toBe(false)
    expect(again.fresh).toBe(0)
    expect(sent).toHaveLength(0)
  })
})

const TWO_HOURS = 2 * 60 * 60 * 1000

const adaDoc = {
  label: 'Ledger, Ada Periodic Transaction Report',
  url: 'https://www.whitehouse.gov/wp-content/uploads/2024/03/ada-ledger-ptr.pdf',
  hint: 'whitehouse' as const,
  text: `Periodic Transaction Report (OGE Form 278-T)
Filer's Information
Ledger, Ada
Assistant to the President - White House
/s/ Ledger, Ada [electronically signed on 03/01/2024 by Ledger, Ada in Integrity.gov]
1 Apple Inc. (AAPL) Purchase 02/01/2024 No $1,001 - $15,000
`,
}

const beaDoc = {
  label: 'Ledger, Bea Periodic Transaction Report',
  url: 'https://www.whitehouse.gov/wp-content/uploads/2024/04/bea-ledger-ptr.pdf',
  hint: 'whitehouse' as const,
  text: `Periodic Transaction Report (OGE Form 278-T)
Filer's Information
Ledger, Bea
Assistant to the President - White House
/s/ Ledger, Bea [electronically signed on 04/02/2024 by Ledger, Bea in Integrity.gov]
1 Microsoft Corporation (MSFT) Purchase 03/15/2024 No $15,001 - $50,000
`,
}

describe('poll rechecks disclosures on the 2 hour gate', () => {
  it('stores a new disclosure when the Hillscore file is unchanged, then goes quiet', async () => {
    expect(REFRESH_INTERVAL_MS).toBe(TWO_HOURS)
    const pg = new PGlite()
    const db = adapter(pg)
    const start = new Date('2026-06-01T00:00:00.000Z')
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let documents = [adaDoc]
    let csvFetches = 0
    let disclosureFetches = 0
    const sent: PushMessage[] = []
    const send = async (_subscription: PushSubscriptionRecord, message: PushMessage) => {
      sent.push(message)
      return 'ok' as const
    }
    const poll = (now: Date, force = false) =>
      runPoll(db, {
        schemaSql,
        now,
        force,
        fetchCsv: async () => {
          csvFetches += 1
          return trades
        },
        fetchDisclosures: async () => {
          disclosureFetches += 1
          return { documents, omissions: [] }
        },
        send,
      })

    const seeded = await poll(start)
    expect(seeded.seeded).toBe(true)
    expect(seeded.sent).toBe(0)
    expect(sent).toHaveLength(0)
    expect(csvFetches).toBe(1)
    expect(disclosureFetches).toBe(1)
    const firstBook = await stored(pg)
    expect(firstBook.some((row) => row.politician.includes('Nancy Pelosi') && row.symbol === 'NVDA' && row.source === 'hillscore')).toBe(true)
    expect(firstBook.some((row) => row.politician.includes('Ada Ledger') && row.symbol === 'AAPL' && row.source === 'disclosure')).toBe(true)

    const tooSoon = await poll(new Date(start.getTime() + TWO_HOURS - 1))
    expect(tooSoon.fresh).toBe(0)
    expect(tooSoon.changed).toBe(false)
    expect(csvFetches).toBe(1)
    expect(disclosureFetches).toBe(1)

    const forced = await poll(new Date(start.getTime() + 60_000), true)
    expect(csvFetches).toBe(2)
    expect(disclosureFetches).toBe(2)
    expect(forced.fresh).toBe(0)
    expect(sent).toHaveLength(0)

    await saveSubscription(db, {
      endpoint: 'https://push.example/device',
      keys: { p256dh: 'key', auth: 'auth' },
    })
    documents = [adaDoc, beaDoc]
    const opened = await poll(new Date(start.getTime() + 60_000 + TWO_HOURS))
    expect(opened.seeded).toBe(false)
    expect(opened.fresh).toBe(1)
    expect(sent).toHaveLength(1)
    expect(csvFetches).toBe(3)
    expect(disclosureFetches).toBe(3)
    const secondBook = await stored(pg)
    expect(secondBook.some((row) => row.politician.includes('Ada Ledger') && row.symbol === 'AAPL' && row.source === 'disclosure')).toBe(true)
    expect(secondBook.some((row) => row.politician.includes('Bea Ledger') && row.symbol === 'MSFT' && row.source === 'disclosure')).toBe(true)
    expect(secondBook.some((row) => row.politician.includes('Nancy Pelosi') && row.source === 'hillscore')).toBe(true)
    expect(secondBook.filter((row) => row.source === 'disclosure')).toHaveLength(2)

    sent.length = 0
    const quiet = await poll(new Date(start.getTime() + 60_000 + TWO_HOURS * 2))
    expect(quiet.fresh).toBe(0)
    expect(quiet.sent).toBe(0)
    expect(sent).toHaveLength(0)
    expect(csvFetches).toBe(4)
    expect(disclosureFetches).toBe(4)
    const thirdBook = await stored(pg)
    expect(thirdBook.some((row) => row.politician.includes('Ada Ledger') && row.source === 'disclosure')).toBe(true)
    expect(thirdBook.some((row) => row.politician.includes('Bea Ledger') && row.source === 'disclosure')).toBe(true)
  })

  it('seeds the notify cursor without downloading when a page ingest already ran', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    const start = new Date('2026-06-01T00:00:00.000Z')
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let documents = [adaDoc]
    let csvFetches = 0
    let disclosureFetches = 0
    const fetchCsv = async () => {
      csvFetches += 1
      return trades
    }
    const fetchDisclosures = async () => {
      disclosureFetches += 1
      return { documents, omissions: [] }
    }
    await ingestFilings(db, {
      schemaSql,
      force: true,
      now: start,
      fetchCsv,
      fetchDisclosures,
    })
    expect(csvFetches).toBe(1)
    expect(disclosureFetches).toBe(1)

    const sent: PushMessage[] = []
    const inside = await runPoll(db, {
      schemaSql,
      now: new Date(start.getTime() + 60_000),
      fetchCsv,
      fetchDisclosures,
      send: async (_subscription, message) => {
        sent.push(message)
        return 'ok'
      },
    })
    expect(inside.seeded).toBe(true)
    expect(inside.fresh).toBe(0)
    expect(inside.sent).toBe(0)
    expect(sent).toHaveLength(0)
    expect(csvFetches).toBe(1)
    expect(disclosureFetches).toBe(1)

    await saveSubscription(db, {
      endpoint: 'https://push.example/after-page',
      keys: { p256dh: 'key', auth: 'auth' },
    })
    documents = [adaDoc, beaDoc]
    const later = await runPoll(db, {
      schemaSql,
      now: new Date(start.getTime() + TWO_HOURS),
      fetchCsv,
      fetchDisclosures,
      send: async (_subscription, message) => {
        sent.push(message)
        return 'ok'
      },
    })
    expect(later.seeded).toBe(false)
    expect(later.fresh).toBe(1)
    expect(sent).toHaveLength(1)
    const book = await stored(pg)
    expect(book.some((row) => row.politician.includes('Ada Ledger') && row.source === 'disclosure')).toBe(true)
    expect(book.some((row) => row.politician.includes('Bea Ledger') && row.symbol === 'MSFT')).toBe(true)
  })

  it('does not arm notifications on the sample book when Hillscore is down', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    const start = new Date('2026-06-01T00:00:00.000Z')
    const sent: PushMessage[] = []
    const send = async (_subscription: PushSubscriptionRecord, message: PushMessage) => {
      sent.push(message)
      return 'ok' as const
    }
    let live = false
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    const down = await runPoll(db, {
      schemaSql,
      now: start,
      fetchCsv: async () => {
        if (!live) throw new Error('hillscore down')
        return trades
      },
      fetchDisclosures: async () => ({ documents: [], omissions: [] }),
      send,
    })
    expect(down.sent).toBe(0)
    expect(down.seeded).toBe(false)
    const sample = await stored(pg)
    expect(sample.length).toBeGreaterThan(0)
    expect(sample.every((row) => row.source === 'sample')).toBe(true)

    await saveSubscription(db, {
      endpoint: 'https://push.example/sample',
      keys: { p256dh: 'key', auth: 'auth' },
    })
    live = true
    const recovered = await runPoll(db, {
      schemaSql,
      now: new Date(start.getTime() + TWO_HOURS),
      fetchCsv: async () => trades,
      fetchDisclosures: async () => ({ documents: [adaDoc], omissions: [] }),
      send,
    })
    expect(recovered.seeded).toBe(true)
    expect(recovered.sent).toBe(0)
    expect(sent).toHaveLength(0)
    const book = await stored(pg)
    expect(book.some((row) => row.source === 'sample')).toBe(false)
    expect(book.some((row) => row.politician.includes('Nancy Pelosi') && row.source === 'hillscore')).toBe(true)
    expect(book.some((row) => row.politician.includes('Ada Ledger') && row.source === 'disclosure')).toBe(true)
  })

  it('a second unforced poll in the same window does not download again', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    const start = new Date('2026-06-01T12:00:00.000Z')
    let csvFetches = 0
    let releaseFirst: () => void = () => {}
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    const fetchCsv = async () => {
      csvFetches += 1
      if (csvFetches === 1) await firstHeld
      return trades
    }
    const send = async () => 'ok' as const
    const first = runPoll(db, { schemaSql, fetchCsv, send, now: start })
    const second = runPoll(db, { schemaSql, fetchCsv, send, now: start })
    const pull = (globalThis as { [PULL_SLOT]?: { pending: Promise<void> | null } })[PULL_SLOT]
    expect(pull?.pending).toBeInstanceOf(Promise)
    releaseFirst()
    const [seeded, joined] = await Promise.all([first, second])
    expect(csvFetches).toBe(1)
    expect(seeded.seeded).toBe(true)
    expect(joined.fresh).toBe(0)
    expect(joined.sent).toBe(0)
  })

  it('pushes a filing a page refresh stored inside the window without downloading again', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    const start = new Date('2026-06-01T00:00:00.000Z')
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let documents = [adaDoc]
    let csvFetches = 0
    let disclosureFetches = 0
    const sent: PushMessage[] = []
    const fetchCsv = async () => {
      csvFetches += 1
      return trades
    }
    const fetchDisclosures = async () => {
      disclosureFetches += 1
      return { documents, omissions: [] }
    }
    const send = async (_subscription: PushSubscriptionRecord, message: PushMessage) => {
      sent.push(message)
      return 'ok' as const
    }
    const seeded = await runPoll(db, { schemaSql, now: start, fetchCsv, fetchDisclosures, send })
    expect(seeded.seeded).toBe(true)
    expect(sent).toHaveLength(0)
    await saveSubscription(db, {
      endpoint: 'https://push.example/page-refresh',
      keys: { p256dh: 'key', auth: 'auth' },
    })
    documents = [adaDoc, beaDoc]
    await ingestFilings(db, {
      schemaSql,
      force: true,
      now: new Date(start.getTime() + 60_000),
      fetchCsv,
      fetchDisclosures,
    })
    expect(csvFetches).toBe(2)
    expect(disclosureFetches).toBe(2)

    const noticed = await runPoll(db, {
      schemaSql,
      now: new Date(start.getTime() + 120_000),
      fetchCsv,
      fetchDisclosures,
      send,
    })
    expect(csvFetches).toBe(2)
    expect(disclosureFetches).toBe(2)
    expect(noticed.fresh).toBe(1)
    expect(noticed.sent).toBe(1)
    expect(sent).toHaveLength(1)
    const book = await stored(pg)
    expect(book.some((row) => row.politician.includes('Ada Ledger') && row.source === 'disclosure')).toBe(true)
    expect(book.some((row) => row.politician.includes('Bea Ledger') && row.symbol === 'MSFT' && row.source === 'disclosure')).toBe(true)

    const quiet = await runPoll(db, {
      schemaSql,
      now: new Date(start.getTime() + 60_000 + TWO_HOURS),
      fetchCsv,
      fetchDisclosures,
      send,
    })
    expect(quiet.fresh).toBe(0)
    expect(quiet.sent).toBe(0)
    expect(sent).toHaveLength(1)
    expect(csvFetches).toBe(3)
    expect(disclosureFetches).toBe(3)
  })

  it('a failed fetch does not count as a successful check', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    const start = new Date('2026-06-01T00:00:00.000Z')
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let live = true
    let csvFetches = 0
    let disclosureFetches = 0
    const fetchCsv = async () => {
      csvFetches += 1
      if (!live) throw new Error('hillscore down')
      return trades
    }
    const fetchDisclosures = async () => {
      disclosureFetches += 1
      return { documents: [adaDoc], omissions: [] }
    }
    const send = async () => 'ok' as const
    await runPoll(db, { schemaSql, now: start, fetchCsv, fetchDisclosures, send })
    expect(csvFetches).toBe(1)
    expect(disclosureFetches).toBe(1)

    live = false
    const failedAt = new Date(start.getTime() + TWO_HOURS)
    const failed = await runPoll(db, { schemaSql, now: failedAt, fetchCsv, fetchDisclosures, send })
    expect(failed.fresh).toBe(0)
    expect(failed.sent).toBe(0)
    expect(csvFetches).toBe(2)
    const kept = await stored(pg)
    expect(kept.some((row) => row.politician.includes('Ada Ledger') && row.source === 'disclosure')).toBe(true)
    expect(kept.some((row) => row.politician.includes('Nancy Pelosi') && row.source === 'hillscore')).toBe(true)

    live = true
    const retried = await runPoll(db, {
      schemaSql,
      now: new Date(failedAt.getTime() + 1000),
      fetchCsv,
      fetchDisclosures,
      send,
    })
    expect(csvFetches).toBe(3)
    expect(disclosureFetches).toBe(2)
    expect(retried.fresh).toBe(0)
    expect(retried.sent).toBe(0)
  })

  it('rejects a missing or wrong poll token', async () => {
    const previous = process.env.PUSH_POLL_TOKEN
    try {
      delete process.env.PUSH_POLL_TOKEN
      const missingConfig = await handlePoll(new Request('http://127.0.0.1/internal/poll', { method: 'POST' }))
      expect(missingConfig.status).toBe(401)
      console.log('missing poll token rejected', missingConfig.status)

      process.env.PUSH_POLL_TOKEN = 'expected-token'
      const missingHeader = await handlePoll(new Request('http://127.0.0.1/internal/poll', { method: 'POST' }))
      expect(missingHeader.status).toBe(401)
      console.log('absent poll token rejected', missingHeader.status)
      const wrong = await handlePoll(
        new Request('http://127.0.0.1/internal/poll', {
          method: 'POST',
          headers: { 'x-floor-tape-poll-token': 'other-token' },
        }),
      )
      expect(wrong.status).toBe(401)
      console.log('wrong poll token rejected', wrong.status)
      expect(await missingConfig.text()).toContain('unauthorized')
    } finally {
      if (previous == null) delete process.env.PUSH_POLL_TOKEN
      else process.env.PUSH_POLL_TOKEN = previous
    }
  })
})

async function stored(pg: PGlite): Promise<Array<{ politician: string; symbol: string | null; source: string }>> {
  const result = await pg.query<{ politician: string; symbol: string | null; source: string }>(
    'SELECT politician, symbol, source FROM filings',
  )
  return result.rows
}
