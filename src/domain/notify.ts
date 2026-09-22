import { formatRange } from './pure'

export const MAX_PUSHES_PER_POLL = 5

export type FilingNotice = {
  id: string
  politician: string
  symbol: string | null
  assetName: string
  transactionType: string
  amountMin: number
  amountMax: number
  amountMid: number
  filedDate: string
}

export type PushMessage = {
  title: string
  body: string
  url: string
}

/** First observation seeds the cursor and sends nothing. Later polls only return ids that were not stored. */
export function freshFilingIds(previous: ReadonlySet<string> | null, currentIds: readonly string[]): {
  seeded: boolean
  fresh: string[]
} {
  if (previous == null) return { seeded: true, fresh: [] }
  return { seeded: false, fresh: currentIds.filter((id) => !previous.has(id)) }
}

export function pushForFiling(row: FilingNotice): PushMessage {
  const name = row.symbol?.trim() || row.assetName
  const range = formatRange(row.amountMin, row.amountMax, row.amountMid)
  return {
    title: `${name} ${row.transactionType} · ${row.politician}`,
    body: `${range} · filed ${row.filedDate}`,
    url: `/trade/${row.id}`,
  }
}

/** One push per new filing, capped. A larger batch becomes a single summary so a busy poll cannot flood the phone. */
export function pushesFor(rows: readonly FilingNotice[]): PushMessage[] {
  if (rows.length === 0) return []
  const ordered = [...rows].sort((a, b) => (a.filedDate < b.filedDate ? 1 : a.filedDate > b.filedDate ? -1 : a.id < b.id ? 1 : -1))
  if (ordered.length <= MAX_PUSHES_PER_POLL) return ordered.map(pushForFiling)
  const preview = ordered
    .slice(0, 3)
    .map((row) => `${row.symbol?.trim() || row.assetName} ${row.transactionType} · ${row.politician}`)
    .join(' · ')
  return [
    {
      title: `${ordered.length} new disclosures`,
      body: preview,
      url: '/',
    },
  ]
}
