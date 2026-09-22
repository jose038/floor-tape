import { downsample, filingsForSymbol, toYahooSymbol, type Filing } from './pure'
import { readCloseOnDate, readLastCloses, readSeries, type Bar, type FetchLike } from './quotes'
import { toView, type ViewFiling } from './view'

/** Attach last closes for every distinct mapped symbol. The quote cache skips repeats. */
export async function priceFilings(
  rows: Filing[],
  fetchImpl: FetchLike,
  seriesSymbol?: string | null,
): Promise<{ filings: ViewFiling[]; series: Bar[] }> {
  const symbols: string[] = []
  for (const row of rows) {
    if (row.yahooSymbol && !symbols.includes(row.yahooSymbol)) symbols.push(row.yahooSymbol)
  }
  const closes = await readLastCloses(symbols, fetchImpl)
  const tradeCache = new Map<string, number | null>()
  const missing = rows.filter((row) => row.priceOnTradeDate == null && row.yahooSymbol)
  for (const row of missing) {
    const key = `${row.yahooSymbol}|${row.transactionDate}`
    if (tradeCache.has(key)) continue
    tradeCache.set(key, await readCloseOnDate(row.yahooSymbol as string, row.transactionDate, fetchImpl))
  }
  let series: Bar[] = []
  if (seriesSymbol) series = downsample(await readSeries(seriesSymbol, fetchImpl, '1y'), 160)
  const filings = rows.map((row) => {
    const last = row.yahooSymbol ? (closes.get(row.yahooSymbol) ?? null) : null
    const trade =
      row.priceOnTradeDate ??
      (row.yahooSymbol ? (tradeCache.get(`${row.yahooSymbol}|${row.transactionDate}`) ?? null) : null)
    return toView(row, trade, last)
  })
  return { filings, series }
}

export async function presentTicker(rows: Filing[], sym: string, fetchImpl: FetchLike) {
  const selected = filingsForSymbol(rows, sym)
  const want = sym.trim().toUpperCase()
  const { filings, series } = await priceFilings(selected, fetchImpl, toYahooSymbol(want))
  const lastClose = filings.find((row) => row.lastClose != null)?.lastClose ?? null
  return { symbol: want, filings, total: selected.length, series, lastClose }
}
