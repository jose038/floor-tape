import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { listMigrationFiles } from '../domain/migrations'
import type { PushMessage } from '../domain/notify'
import { ensureSchema, type Db } from '../domain/ingest'
import { runPoll, saveSubscription, type PushSubscriptionRecord } from './notify'

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
    const first = csv([
      'Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1001,15000,140',
    ])
    const seeded = await runPoll(db, { schemaSql, fetchCsv: async () => first, send })
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
    const updated = await runPoll(db, { schemaSql, fetchCsv: async () => second, send })
    expect(updated.seeded).toBe(false)
    expect(updated.fresh).toBe(1)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.title).toContain('Josh Gottheimer')
    expect(sent[0]?.title).toContain('MSFT')
    expect(sent[0]?.title).toContain('BUY')
    expect(sent[0]?.body).toContain('$1k–$15k · mid $8k')
    expect(sent[0]?.url.startsWith('/trade/')).toBe(true)

    sent.length = 0
    const again = await runPoll(db, { schemaSql, fetchCsv: async () => second, send })
    expect(again.changed).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
