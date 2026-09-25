import { createHash } from 'node:crypto'
import { freshFilingIds, pushesFor, type FilingNotice, type PushMessage } from '../domain/notify'
import { ensureSchema, ingestFilings, ingestIsDue, type Db, type DisclosureBatch } from '../domain/ingest'
import { getDb, readMigrationSql } from './db'
import { armFilingRecheck, pullsOnStartup, timeoutScheduleTimer, type ArmedRecheck } from './recheck'
import { sharePull } from './single-flight'
import { loadDisclosureBatch } from './disclosures'

export type PushSubscriptionRecord = {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export type SendResult = 'ok' | 'gone' | 'error'

const HILLSCORE_CSV = 'https://hillscore.com/data/files/trades.csv'
const LEGISLATORS_URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function asNotice(row: Record<string, unknown>): FilingNotice {
  return {
    id: String(row.id),
    politician: String(row.politician),
    symbol: row.symbol == null || String(row.symbol).trim() === '' ? null : String(row.symbol),
    assetName: String(row.asset_name),
    transactionType: String(row.transaction_type),
    amountMin: Number(row.amount_min),
    amountMax: Number(row.amount_max),
    amountMid: Number(row.amount_mid),
    filedDate: String(row.filed_date),
  }
}

async function readCursor(db: Db): Promise<{ csvHash: string | null; seen: Set<string> } | null> {
  const rows = await db.query<{ csv_hash: string | null; seen_ids: string }>(
    'SELECT csv_hash, seen_ids FROM notify_cursor WHERE id = 1',
  )
  const row = rows[0]
  if (!row) return null
  let ids: string[] = []
  try {
    const parsed = JSON.parse(row.seen_ids) as unknown
    if (Array.isArray(parsed)) ids = parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    ids = []
  }
  return { csvHash: row.csv_hash, seen: new Set(ids) }
}

async function writeCursor(db: Db, csvHash: string, ids: readonly string[], now: Date): Promise<void> {
  await db.query(
    `INSERT INTO notify_cursor (id, csv_hash, seen_ids, updated_at)
     VALUES (1, $1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET csv_hash = EXCLUDED.csv_hash, seen_ids = EXCLUDED.seen_ids, updated_at = EXCLUDED.updated_at`,
    [csvHash, JSON.stringify(ids), now.toISOString()],
  )
}

export async function saveSubscription(db: Db, record: PushSubscriptionRecord, now = new Date()): Promise<void> {
  await db.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth_secret, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth_secret = EXCLUDED.auth_secret`,
    [record.endpoint, record.keys.p256dh, record.keys.auth, now.toISOString()],
  )
}

export async function deleteSubscription(db: Db, endpoint: string): Promise<void> {
  await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
}

async function listSubscriptions(db: Db): Promise<PushSubscriptionRecord[]> {
  const rows = await db.query<{ endpoint: string; p256dh: string; auth_secret: string }>(
    'SELECT endpoint, p256dh, auth_secret FROM push_subscriptions',
  )
  return rows.map((row) => ({
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth_secret },
  }))
}

export function parseSubscription(body: unknown): PushSubscriptionRecord | null {
  if (!body || typeof body !== 'object') return null
  const record = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  if (typeof record.endpoint !== 'string' || !record.endpoint.startsWith('https://')) return null
  if (typeof record.keys?.p256dh !== 'string' || typeof record.keys?.auth !== 'string') return null
  if (!record.keys.p256dh || !record.keys.auth) return null
  return { endpoint: record.endpoint, keys: { p256dh: record.keys.p256dh, auth: record.keys.auth } }
}

export type PollResult = {
  seeded: boolean
  changed: boolean
  fresh: number
  sent: number
  downloaded: boolean
  lastSuccessAt: string | null
}

const quietPoll = { seeded: false, changed: false, fresh: 0, sent: 0 }

export async function runPoll(
  db: Db,
  options: {
    schemaSql: string
    fetchCsv: () => Promise<string>
    fetchLegislators?: () => Promise<string>
    fetchDisclosures?: () => Promise<DisclosureBatch>
    send: (subscription: PushSubscriptionRecord, message: PushMessage) => Promise<SendResult>
    now?: Date
    force?: boolean
  },
): Promise<PollResult> {
  const force = options.force ?? false
  return sharePull(force, () => executePoll(db, options))
}

async function executePoll(
  db: Db,
  options: {
    schemaSql: string
    fetchCsv: () => Promise<string>
    fetchLegislators?: () => Promise<string>
    fetchDisclosures?: () => Promise<DisclosureBatch>
    send: (subscription: PushSubscriptionRecord, message: PushMessage) => Promise<SendResult>
    now?: Date
    force?: boolean
  },
): Promise<PollResult> {
  const now = options.now ?? new Date()
  const force = options.force ?? false
  await ensureSchema(db, options.schemaSql)
  // An unchanged Hillscore hash is not a reason to skip. Disclosure filings
  // live outside that file, so a due check always loads both sources.
  if (!(await ingestIsDue(db, now, force))) {
    if (!(await readCursor(db)) && (await bookIsSample(db))) return finish(db, quietPoll, false)
    return publishStored(db, now, options.send, false)
  }
  const ingested = await ingestFilings(db, {
    schemaSql: options.schemaSql,
    force: true,
    now,
    fetchCsv: options.fetchCsv,
    fetchLegislators: options.fetchLegislators,
    fetchDisclosures: options.fetchDisclosures,
  })
  if (ingested.labeledSample) return finish(db, quietPoll, true)
  return publishStored(db, now, options.send, true)
}

async function readLastSuccess(db: Db): Promise<string | null> {
  const rows = await db.query<{ last_ingest_at: string | null }>('SELECT last_ingest_at FROM ingest_state WHERE id = 1')
  return rows[0]?.last_ingest_at ?? null
}

async function finish(
  db: Db,
  result: { seeded: boolean; changed: boolean; fresh: number; sent: number },
  downloaded: boolean,
): Promise<PollResult> {
  return { ...result, downloaded, lastSuccessAt: await readLastSuccess(db) }
}

async function publishStored(
  db: Db,
  now: Date,
  send: (subscription: PushSubscriptionRecord, message: PushMessage) => Promise<SendResult>,
  downloaded: boolean,
): Promise<PollResult> {
  const stored = await listNotices(db)
  const cursor = await readCursor(db)
  const diff = freshFilingIds(cursor ? cursor.seen : null, stored.ids)
  const freshRows = stored.rows.filter((row) => diff.fresh.includes(row.id))
  const messages = diff.seeded ? [] : pushesFor(freshRows)
  let sent = 0
  if (messages.length > 0) {
    const subscriptions = await listSubscriptions(db)
    for (const message of messages) {
      for (const subscription of subscriptions) {
        const result = await send(subscription, message)
        if (result === 'gone') await deleteSubscription(db, subscription.endpoint)
        if (result === 'ok') sent += 1
      }
    }
  }
  await writeCursor(db, sha256(stored.ids.slice().sort().join('\n')), stored.ids, now)
  return finish(db, { seeded: diff.seeded, changed: diff.seeded || diff.fresh.length > 0, fresh: diff.fresh.length, sent }, downloaded)
}

async function bookIsSample(db: Db): Promise<boolean> {
  const rows = await db.query<{ labeled_sample: boolean | number | string | null; source: string | null }>(
    'SELECT labeled_sample, source FROM ingest_state WHERE id = 1',
  )
  const row = rows[0]
  if (!row) return false
  const flag = row.labeled_sample
  return row.source === 'sample' || flag === true || flag === 1 || flag === '1' || flag === 't' || flag === 'true'
}

async function listNotices(db: Db): Promise<{ rows: FilingNotice[]; ids: string[] }> {
  const rows = (await db.query<Record<string, unknown>>(
    'SELECT id, politician, symbol, asset_name, transaction_type, amount_min, amount_max, amount_mid, filed_date FROM filings',
  )).map(asNotice)
  return { rows, ids: rows.map((row) => row.id) }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'FloorTape/1.0 (disclosure tracker)', accept: 'text/csv,application/json,text/plain,*/*' },
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}

export function vapidPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim()
  return key || null
}

export function pollAuthorized(request: Request): boolean {
  const expected = process.env.PUSH_POLL_TOKEN?.trim()
  if (!expected) return false
  return request.headers.get('x-floor-tape-poll-token') === expected
}

async function sendWebPush(subscription: PushSubscriptionRecord, message: PushMessage): Promise<SendResult> {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return 'error'
  const loaded = await import('web-push')
  const webpush = loaded.default ?? loaded
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || 'mailto:floor-tape@localhost', publicKey, privateKey)
  try {
    await webpush.sendNotification(subscription, JSON.stringify(message))
    return 'ok'
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    if (status === 404 || status === 410) return 'gone'
    console.error('[floor-tape] push failed', status ?? error)
    return 'error'
  }
}

const processRecheckKey = '__floorTapeRecheck'

export function armProcessRecheck(): ArmedRecheck<PollResult> {
  const host = globalThis as typeof globalThis & { [processRecheckKey]?: ArmedRecheck<PollResult> }
  if (host[processRecheckKey]) return host[processRecheckKey]
  const handle = armFilingRecheck({
    timer: timeoutScheduleTimer(),
    immediate: pullsOnStartup(),
    run: (force) => runProcessPoll(force),
  })
  host[processRecheckKey] = handle
  console.log('[floor-tape] filing recheck armed')
  return handle
}

async function runProcessPoll(force: boolean): Promise<PollResult> {
  const db = await getDb()
  const schemaSql = await readMigrationSql()
  return runPoll(db, {
    schemaSql,
    force,
    fetchCsv: () => fetchText(HILLSCORE_CSV),
    fetchLegislators: () => fetchText(LEGISLATORS_URL),
    fetchDisclosures: () => loadDisclosureBatch(),
    send: sendWebPush,
  })
}

export async function handlePoll(request: Request): Promise<Response> {
  if (!pollAuthorized(request)) return new Response('unauthorized\n', { status: 401 })
  const result = await armProcessRecheck().trigger(false)
  return Response.json(result)
}

export async function handleSubscribe(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('bad request\n', { status: 400 })
  }
  const record = parseSubscription(body)
  if (!record) return new Response('bad request\n', { status: 400 })
  if (!vapidPublicKey()) return new Response('push is not configured\n', { status: 503 })
  const db = await getDb()
  await saveSubscription(db, record)
  return Response.json({ ok: true })
}

export async function handleUnsubscribe(request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('bad request\n', { status: 400 })
  }
  const endpoint = body && typeof body === 'object' ? (body as { endpoint?: unknown }).endpoint : null
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return new Response('bad request\n', { status: 400 })
  }
  const db = await getDb()
  await deleteSubscription(db, endpoint)
  return Response.json({ ok: true })
}
