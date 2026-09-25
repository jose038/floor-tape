import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { listMigrationFiles } from '../domain/migrations'
import type { PushMessage } from '../domain/notify'
import { ensureSchema, type Db } from '../domain/ingest'
import { PROCESS_DB, getDb } from './db'
import { armFilingRecheck, pullsOnStartup, type ScheduleTimer } from './recheck'
import { runPoll, saveSubscription, type PushSubscriptionRecord } from './notify'

const schemaSql = listMigrationFiles(['0002_filings.sql', '0003_push.sql', '0004_omissions.sql'])
  .map((name) => readFileSync(path.join(process.cwd(), 'migrations', name), 'utf8'))
  .join('\n')

const header =
  'politician,bioguide_id,party,state,symbol,asset_name,transaction_type,owner,transaction_date,filed_date,amount_min,amount_max,price_on_trade_date'

const TWO_HOURS = 2 * 60 * 60 * 1000

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

function fakeClock(startMs: number): ScheduleTimer & { now(): Date; advance(ms: number): void } {
  let ms = startMs
  let callback: (() => void) | null = null
  let due: number | null = null
  return {
    now: () => new Date(ms),
    set(next, delayMs) {
      callback = next
      due = ms + delayMs
    },
    clear() {
      callback = null
      due = null
    },
    advance(delta) {
      ms += delta
      if (callback && due != null && due <= ms) {
        const fire = callback
        callback = null
        due = null
        fire()
      }
    },
  }
}

describe('process recheck schedule', () => {
  it('pulls once when armed, waits out the window, and runs one full recheck at 2 hours', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    await ensureSchema(db, schemaSql)
    const clock = fakeClock(Date.parse('2026-06-01T00:00:00.000Z'))
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let documents = [adaDoc]
    let csvFetches = 0
    let disclosureFetches = 0
    const sent: PushMessage[] = []
    const handle = armFilingRecheck({
      timer: clock,
      now: () => clock.now(),
      run: (force) =>
        runPoll(db, {
          schemaSql,
          force,
          now: clock.now(),
          fetchCsv: async () => {
            csvFetches += 1
            return trades
          },
          fetchDisclosures: async () => {
            disclosureFetches += 1
            return { documents, omissions: [] }
          },
          send: async (_subscription: PushSubscriptionRecord, message: PushMessage) => {
            sent.push(message)
            return 'ok'
          },
        }),
    })

    try {
      await handle.idle()
      expect(csvFetches).toBe(1)
      expect(disclosureFetches).toBe(1)
      expect(sent).toHaveLength(0)
      const seeded = await pg.query<{ politician: string; symbol: string | null; source: string }>(
        'SELECT politician, symbol, source FROM filings',
      )
      expect(seeded.rows.some((row) => row.politician.includes('Nancy Pelosi') && row.source === 'hillscore')).toBe(true)
      expect(seeded.rows.some((row) => row.politician.includes('Ada Ledger') && row.symbol === 'AAPL' && row.source === 'disclosure')).toBe(true)

      await handle.trigger(false)
      expect(csvFetches).toBe(1)
      expect(disclosureFetches).toBe(1)

      clock.advance(TWO_HOURS - 1)
      await handle.idle()
      expect(csvFetches).toBe(1)
      expect(disclosureFetches).toBe(1)

      await saveSubscription(db, {
        endpoint: 'https://push.example/schedule',
        keys: { p256dh: 'key', auth: 'auth' },
      })
      documents = [adaDoc, beaDoc]
      clock.advance(1)
      await handle.idle()
      expect(csvFetches).toBe(2)
      expect(disclosureFetches).toBe(2)
      expect(sent).toHaveLength(1)
      const refreshed = await pg.query<{ politician: string; symbol: string | null; source: string }>(
        'SELECT politician, symbol, source FROM filings',
      )
      expect(refreshed.rows.some((row) => row.politician.includes('Ada Ledger') && row.source === 'disclosure')).toBe(true)
      expect(refreshed.rows.some((row) => row.politician.includes('Bea Ledger') && row.symbol === 'MSFT' && row.source === 'disclosure')).toBe(true)
      expect(refreshed.rows.some((row) => row.politician.includes('Nancy Pelosi') && row.source === 'hillscore')).toBe(true)

      await handle.trigger(false)
      expect(csvFetches).toBe(2)
      expect(disclosureFetches).toBe(2)

      const forced = await handle.trigger(true)
      expect(csvFetches).toBe(3)
      expect(disclosureFetches).toBe(3)
      expect(forced.fresh).toBe(0)
      expect(sent).toHaveLength(1)
    } finally {
      handle.stop()
    }
  })

  it('a forced refresh inside the window does not push the next download out by another 2 hours', async () => {
    const pg = new PGlite()
    const db = adapter(pg)
    await ensureSchema(db, schemaSql)
    const start = Date.parse('2026-06-01T00:00:00.000Z')
    const clock = fakeClock(start)
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let csvFetches = 0
    let disclosureFetches = 0
    const handle = armFilingRecheck({
      timer: clock,
      now: () => clock.now(),
      run: (force) =>
        runPoll(db, {
          schemaSql,
          force,
          now: clock.now(),
          fetchCsv: async () => {
            csvFetches += 1
            return trades
          },
          fetchDisclosures: async () => {
            disclosureFetches += 1
            return { documents: [adaDoc], omissions: [] }
          },
          send: async () => 'ok',
        }),
    })

    try {
      await handle.idle()
      expect(csvFetches).toBe(1)
      expect(disclosureFetches).toBe(1)

      clock.advance(60_000)
      await handle.idle()
      expect(csvFetches).toBe(1)

      await handle.trigger(true)
      expect(csvFetches).toBe(2)
      expect(disclosureFetches).toBe(2)

      clock.advance(TWO_HOURS - 60_000)
      await handle.idle()
      expect(csvFetches).toBe(2)
      expect(disclosureFetches).toBe(2)

      clock.advance(60_000)
      await handle.idle()
      expect(csvFetches).toBe(3)
      expect(disclosureFetches).toBe(3)
    } finally {
      handle.stop()
    }
  })

  it('on Cloud Run the process arms the timer without pulling during boot', async () => {
    expect(pullsOnStartup({})).toBe(true)
    expect(pullsOnStartup({ K_SERVICE: 'floor-tape' })).toBe(false)

    const pg = new PGlite()
    const db = adapter(pg)
    await ensureSchema(db, schemaSql)
    const start = Date.parse('2026-06-01T00:00:00.000Z')
    const clock = fakeClock(start)
    const trades = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    let csvFetches = 0
    let disclosureFetches = 0
    const handle = armFilingRecheck({
      timer: clock,
      now: () => clock.now(),
      immediate: false,
      run: (force) =>
        runPoll(db, {
          schemaSql,
          force,
          now: clock.now(),
          fetchCsv: async () => {
            csvFetches += 1
            return trades
          },
          fetchDisclosures: async () => {
            disclosureFetches += 1
            return { documents: [adaDoc], omissions: [] }
          },
          send: async () => 'ok',
        }),
    })

    try {
      await handle.idle()
      expect(csvFetches).toBe(0)
      expect(disclosureFetches).toBe(0)
      clock.advance(TWO_HOURS - 1)
      await handle.idle()
      expect(csvFetches).toBe(0)
      clock.advance(1)
      await handle.idle()
      expect(csvFetches).toBe(1)
      expect(disclosureFetches).toBe(1)
    } finally {
      handle.stop()
    }
  })

  it('getDb returns the one process-wide client', async () => {
    const host = globalThis as { [PROCESS_DB]?: Promise<unknown> }
    const previous = host[PROCESS_DB]
    const marker = { shared: true }
    host[PROCESS_DB] = Promise.resolve(marker)
    try {
      await expect(getDb()).resolves.toBe(marker)
    } finally {
      if (previous) host[PROCESS_DB] = previous
      else delete host[PROCESS_DB]
    }
  })

  it('keeps the checked-in wake on a 2 hour schedule and the refresh control forced', () => {
    const plugin = readFileSync(path.join(process.cwd(), 'src/server/filing-recheck-plugin.ts'), 'utf8')
    const vite = readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8')
    const notify = readFileSync(path.join(process.cwd(), 'src/server/notify.ts'), 'utf8')
    const about = readFileSync(path.join(process.cwd(), 'src/routes/about.tsx'), 'utf8')
    const service = readFileSync(path.join(process.cwd(), 'src/server/service.ts'), 'utf8')
    const panel = readFileSync(path.join(process.cwd(), 'src/components/push-panel.tsx'), 'utf8')
    const readme = readFileSync(path.join(process.cwd(), 'deploy/README.md'), 'utf8')
    const setup = readFileSync(path.join(process.cwd(), 'deploy/setup-notify.sh'), 'utf8')

    expect(plugin).toContain('armProcessRecheck')
    expect(vite).toContain('src/server/filing-recheck-plugin.ts')
    expect(notify).toContain('armFilingRecheck')
    expect(notify).toContain('loadDisclosureBatch')
    expect(notify).not.toContain('csvHash ===')
    expect(about).toContain('Refresh live filings')
    expect(about).toContain('refreshLiveFilings()')
    expect(service).toContain('return ensureIngest(true)')
    expect(panel).toContain('about every 2 hours')
    expect(panel).toContain('Each new filing sends a notification.')
    expect(panel).toContain('A burst of more than five becomes one summary.')
    expect(panel).toContain('The server sleeps between checks.')
    expect(panel.toLowerCase()).not.toContain('15 minute')
    expect(readme).toContain('about every 2 hours')
    expect(readme.toLowerCase()).not.toContain('15 minute')
    expect(setup).toContain('about every 2 hours')
    expect(setup).toContain('0 */2 * * *')
    expect(setup).not.toContain('*/15')
    expect(setup.toLowerCase()).not.toContain('15 minute')
  })
})
