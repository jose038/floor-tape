import { createHash } from 'node:crypto'
import { freshFilingIds, pushesFor, type FilingNotice, type PushMessage } from '../domain/notify'
import { ingestFilings, type Db } from '../domain/ingest'
import { getDb, readMigrationSql } from './db'

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

export async function runPoll(
  db: Db,
  options: {
    schemaSql: string
    fetchCsv: () => Promise<string>
    fetchLegislators?: () => Promise<string>
    send: (subscription: PushSubscriptionRecord, message: PushMessage) => Promise<SendResult>
    now?: Date
  },
): Promise<{ seeded: boolean; changed: boolean; fresh: number; sent: number }> {
  const now = options.now ?? new Date()
  const csv = await options.fetchCsv()
  const csvHash = sha256(csv)
  const cursor = await readCursor(db)
  if (cursor && cursor.csvHash === csvHash) {
    return { seeded: false, changed: false, fresh: 0, sent: 0 }
  }
  await ingestFilings(db, {
    schemaSql: options.schemaSql,
    force: true,
    now,
    fetchCsv: async () => csv,
    fetchLegislators: options.fetchLegislators,
  })
  const rows = (await db.query<Record<string, unknown>>(
    'SELECT id, politician, symbol, asset_name, transaction_type, amount_min, amount_max, amount_mid, filed_date FROM filings',
  )).map(asNotice)
  const ids = rows.map((row) => row.id)
  const diff = freshFilingIds(cursor ? cursor.seen : null, ids)
  const freshRows = rows.filter((row) => diff.fresh.includes(row.id))
  const messages = diff.seeded ? [] : pushesFor(freshRows)
  let sent = 0
  if (messages.length > 0) {
    const subscriptions = await listSubscriptions(db)
    for (const message of messages) {
      for (const subscription of subscriptions) {
        const result = await options.send(subscription, message)
        if (result === 'gone') await deleteSubscription(db, subscription.endpoint)
        if (result === 'ok') sent += 1
      }
    }
  }
  await writeCursor(db, csvHash, ids, now)
  return { seeded: diff.seeded, changed: true, fresh: diff.fresh.length, sent }
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

export async function handlePoll(request: Request): Promise<Response> {
  if (!pollAuthorized(request)) return new Response('unauthorized\n', { status: 401 })
  const db = await getDb()
  const schemaSql = await readMigrationSql()
  const result = await runPoll(db, {
    schemaSql,
    fetchCsv: () => fetchText(HILLSCORE_CSV),
    fetchLegislators: () => fetchText(LEGISLATORS_URL),
    send: sendWebPush,
  })
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
