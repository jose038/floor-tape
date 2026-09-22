import { beforeEach, describe, expect, it } from 'vitest'
import { HOUSE_PORTAL, memberStats, type Filing } from './pure'
import { presentTicker, priceFilings } from './pricing'
import { clearQuoteCache, type FetchLike } from './quotes'

function buy(index: number, patch: Partial<Filing> = {}): Filing {
  const symbol = patch.symbol ?? `S${index}`
  return {
    id: `id-${index}`,
    politician: patch.politician ?? 'Ada Member',
    memberId: patch.memberId ?? 'M000001',
    bioguideId: 'M000001',
    party: 'D',
    state: 'CA',
    chamber: 'house',
    symbol,
    yahooSymbol: patch.yahooSymbol ?? symbol,
    assetName: symbol,
    transactionType: 'BUY',
    owner: 'self',
    ownerRaw: 'Self',
    transactionDate: '2024-01-02',
    filedDate: '2024-01-20',
    lagDays: 18,
    late: false,
    amountMin: 1001,
    amountMax: 15000,
    amountMid: 1000,
    priceOnTradeDate: 10,
    officialUrl: HOUSE_PORTAL,
    source: 'hillscore',
    ...patch,
  }
}

function sparkFetcher(calls: string[]): FetchLike {
  return async (url) => {
    calls.push(url)
    const symbols = new URL(url).searchParams.get('symbols')?.split(',').filter(Boolean) ?? []
    if (symbols.length === 0 && url.includes('/chart/')) {
      const symbol = decodeURIComponent(url.split('/chart/')[1]?.split('?')[0] ?? '')
      if (symbol) symbols.push(symbol)
    }
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          spark: {
            result: symbols.map((symbol) => ({
              symbol,
              response: [
                {
                  meta: { regularMarketPrice: 12 },
                  timestamp: [1_700_000_000],
                  indicators: { quote: [{ close: [12] }] },
                },
              ],
            })),
            error: null,
          },
          chart: {
            result: [
              {
                meta: { regularMarketPrice: 12, symbol: symbols[0] },
                timestamp: [1_700_000_000],
                indicators: { quote: [{ close: [12] }] },
              },
            ],
            error: null,
          },
        }),
    }
  }
}

describe('full-book pricing and ticker selection', () => {
  beforeEach(() => {
    clearQuoteCache()
  })

  it('includes the 81st mapped symbol in member totals', async () => {
    const rows = Array.from({ length: 81 }, (_, index) => buy(index))
    const calls: string[] = []
    const { filings } = await priceFilings(rows, sparkFetcher(calls))
    const eightyFirst = filings.find((row) => row.symbol === 'S80')
    const stats = memberStats(filings, () => null, null)
    console.log('symbols requested', calls.join(' | '))
    console.log('mapped buys', stats.mappedBuys, '81st included', eightyFirst?.includedInTotals)
    expect(calls.some((url) => url.includes('S80'))).toBe(true)
    expect(eightyFirst?.lastClose).toBe(12)
    expect(eightyFirst?.includedInTotals).toBe(true)
    expect(stats.mappedBuys).toBe(81)
    expect(stats.openHyp).toBe(81 * 100 * (12 - 10))
  })

  it('returns every filer when a ticker has more than 120 rows from two members', async () => {
    const rows: Filing[] = []
    for (let index = 0; index < 70; index++) {
      rows.push(buy(index, { symbol: 'MSFT', yahooSymbol: 'MSFT', memberId: 'A000001', politician: 'Ann Able' }))
    }
    for (let index = 70; index < 140; index++) {
      rows.push(buy(index, { symbol: 'MSFT', yahooSymbol: 'MSFT', memberId: 'B000001', politician: 'Ben Baker' }))
    }
    rows.push(buy(999, { symbol: 'AAPL', yahooSymbol: 'AAPL', memberId: 'C000001', politician: 'Cara Cole' }))
    const calls: string[] = []
    const page = await presentTicker(rows, 'msft', sparkFetcher(calls))
    const members = new Set(page.filings.map((row) => row.memberId))
    console.log('ticker rows', page.filings.length, 'members', [...members].join(','))
    expect(page.total).toBe(140)
    expect(page.filings).toHaveLength(140)
    expect(members).toEqual(new Set(['A000001', 'B000001']))
    expect(page.filings.some((row) => row.symbol === 'AAPL')).toBe(false)
  })
})
