import { compareNewest, type Chamber, type Filing, type FilingSource } from './pure'
import { toView } from './view'

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

export function filingFromRow(row: Record<string, unknown>): Filing {
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
  const asBool = (value: unknown) => value === true || value === 1 || value === '1' || value === 't' || value === 'true'
  const side = row.transaction_type
  const chamber = row.chamber
  const source = row.source
  const known: Chamber[] = ['house', 'senate', 'whitehouse', 'state']
  const filingSource: FilingSource = source === 'sample' || source === 'disclosure' ? source : 'hillscore'
  return {
    id: String(row.id),
    politician: String(row.politician),
    memberId: String(row.member_id),
    bioguideId: text(row.bioguide_id),
    party: text(row.party),
    state: text(row.state),
    chamber: known.includes(chamber as Chamber) ? (chamber as Chamber) : 'unknown',
    symbol: text(row.symbol),
    yahooSymbol: text(row.yahoo_symbol),
    assetName: String(row.asset_name),
    transactionType: side === 'BUY' || side === 'SELL' ? side : 'OTHER',
    owner: String(row.owner),
    ownerRaw: String(row.owner_raw ?? row.owner),
    transactionDate: String(row.transaction_date).slice(0, 10),
    filedDate: String(row.filed_date).slice(0, 10),
    lagDays: Number(row.lag_days),
    late: asBool(row.late),
    amountMin: Number(row.amount_min),
    amountMax: Number(row.amount_max),
    amountMid: Number(row.amount_mid),
    priceOnTradeDate: numberOrNull(row.price_on_trade_date),
    officialUrl: String(row.official_url),
    source: filingSource,
  }
}

export function buildRoster(rows: Filing[]): RosterMember[] {
  const map = new Map<string, RosterMember>()
  const ordered = [...rows].sort(compareNewest)
  for (const row of ordered) {
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
  }
  return [...map.values()].sort((a, b) =>
    a.lastFiled < b.lastFiled ? 1 : a.lastFiled > b.lastFiled ? -1 : a.politician.localeCompare(b.politician),
  )
}
