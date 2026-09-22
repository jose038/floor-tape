import {
  initials,
  markTrade,
  ownerLabel,
  seatLabel,
  type Filing,
  type Mark,
} from './pure'

export type ViewFiling = Filing &
  Mark & {
    tradeDateClose: number | null
    lastClose: number | null
    ownerLabel: string
    initials: string
    seat: string
  }

export function toView(row: Filing, tradeDateClose: number | null, lastClose: number | null): ViewFiling {
  const mark = markTrade({
    id: row.id,
    transactionType: row.transactionType,
    symbol: row.symbol,
    amountMid: row.amountMid,
    tradeDateClose,
    lastClose,
  })
  return {
    ...row,
    ...mark,
    tradeDateClose,
    lastClose,
    ownerLabel: ownerLabel(row.owner),
    initials: initials(row.politician),
    seat: seatLabel(row.party, row.state, row.chamber),
  }
}
