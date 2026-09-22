import { beforeEach, describe, expect, it } from 'vitest'
import { clearQuoteCache, readLastClose, type FetchLike } from './quotes'

describe('yahoo quote client', () => {
  beforeEach(() => {
    clearQuoteCache()
  })

  it('a second quote read does not call the fetcher again', async () => {
    let calls = 0
    const fetcher: FetchLike = async (url) => {
      calls += 1
      expect(url).toContain('BRK-B')
      expect(url.includes('BRK.B')).toBe(false)
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            spark: {
              result: [
                {
                  symbol: 'BRK-B',
                  response: [
                    {
                      meta: { regularMarketPrice: 410.25 },
                      timestamp: [1_700_000_000],
                      indicators: { quote: [{ close: [410.25] }] },
                    },
                  ],
                },
              ],
              error: null,
            },
          }),
      }
    }
    const first = await readLastClose('BRK.B', fetcher)
    const second = await readLastClose('BRK.B', fetcher)
    console.log('quote calls', calls, 'last', first, second)
    expect(first).toBe(410.25)
    expect(second).toBe(410.25)
    expect(calls).toBe(1)
  })

  it('uses the chart endpoint when spark fails', async () => {
    const urls: string[] = []
    const fetcher: FetchLike = async (url) => {
      urls.push(url)
      if (url.includes('/v7/finance/spark')) return { ok: false, status: 401, text: async () => '' }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { regularMarketPrice: 512.5 },
                  timestamp: [1_700_000_000],
                  indicators: { quote: [{ close: [512.5] }] },
                },
              ],
              error: null,
            },
          }),
      }
    }
    const last = await readLastClose('SPY', fetcher)
    expect(last).toBe(512.5)
    expect(urls.some((url) => url.includes('/v8/finance/chart/SPY'))).toBe(true)
  })
})
