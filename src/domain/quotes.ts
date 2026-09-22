import { closeOnOrBefore, toYahooSymbol } from './pure'

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  text: () => Promise<string>
}>

export type Bar = { date: string; close: number }

const lastCache = new Map<string, number | null>()
const seriesCache = new Map<string, Bar[]>()

export function clearQuoteCache(): void {
  lastCache.clear()
  seriesCache.clear()
}

export function quoteCacheSize(): number {
  return lastCache.size
}

export const YAHOO_UA = 'Mozilla/5.0 (compatible; FloorTape/1.0; disclosure-research)'

function nyDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

function lastFinite(values: unknown): number | null {
  if (!Array.isArray(values)) return null
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function parseSparkPayload(payload: unknown): Map<string, number> {
  const out = new Map<string, number>()
  const results = (payload as { spark?: { result?: unknown[] } } | null)?.spark?.result
  if (!Array.isArray(results)) return out
  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    const symbol = (item as { symbol?: string }).symbol
    const response = (item as { response?: unknown[] }).response?.[0] as
      | { meta?: { regularMarketPrice?: number }; indicators?: { quote?: { close?: unknown[] }[] } }
      | undefined
    const fromBars = lastFinite(response?.indicators?.quote?.[0]?.close)
    const fromMeta = response?.meta?.regularMarketPrice
    const last = fromBars ?? (typeof fromMeta === 'number' && Number.isFinite(fromMeta) ? fromMeta : null)
    if (symbol && last != null) out.set(symbol.toUpperCase(), last)
  }
  return out
}

export function parseChartPayload(payload: unknown): { last: number | null; series: Bar[] } {
  const result = (payload as { chart?: { result?: unknown[] } } | null)?.chart?.result?.[0] as
    | {
        meta?: { regularMarketPrice?: number }
        timestamp?: number[]
        indicators?: { quote?: { close?: unknown[] }[] }
      }
    | undefined
  const timestamps = result?.timestamp ?? []
  const closes = result?.indicators?.quote?.[0]?.close ?? []
  const series: Bar[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i]
    if (typeof close === 'number' && Number.isFinite(close) && typeof timestamps[i] === 'number') {
      series.push({ date: nyDate(timestamps[i]), close })
    }
  }
  const meta = result?.meta?.regularMarketPrice
  const last = series.length > 0 ? series[series.length - 1].close : typeof meta === 'number' ? meta : null
  return { last, series }
}

async function readText(fetchImpl: FetchLike, url: string): Promise<string | null> {
  try {
    const response = await fetchImpl(url, { headers: { 'user-agent': YAHOO_UA, accept: 'application/json' } })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

/** Last close via spark, then chart. A cached symbol does not call the fetcher again. */
export async function readLastClose(symbol: string, fetchImpl: FetchLike): Promise<number | null> {
  const yahoo = toYahooSymbol(symbol)
  if (lastCache.has(yahoo)) return lastCache.get(yahoo) ?? null
  let last: number | null = null
  const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(yahoo)}&range=5d&interval=1d`
  const sparkText = await readText(fetchImpl, sparkUrl)
  if (sparkText) {
    try {
      last = parseSparkPayload(JSON.parse(sparkText)).get(yahoo) ?? null
    } catch {
      last = null
    }
  }
  if (last == null) {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=5d&interval=1d`
    const chartText = await readText(fetchImpl, chartUrl)
    if (chartText) {
      try {
        last = parseChartPayload(JSON.parse(chartText)).last
      } catch {
        last = null
      }
    }
  }
  lastCache.set(yahoo, last)
  return last
}

export async function readLastCloses(symbols: string[], fetchImpl: FetchLike): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  const missing: string[] = []
  for (const symbol of symbols) {
    if (!symbol) continue
    const yahoo = toYahooSymbol(symbol)
    if (lastCache.has(yahoo)) out.set(yahoo, lastCache.get(yahoo) ?? null)
    else if (!missing.includes(yahoo)) missing.push(yahoo)
  }
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25)
    const sparkUrl = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${chunk.map(encodeURIComponent).join(',')}&range=5d&interval=1d`
    let parsed = new Map<string, number>()
    const sparkText = await readText(fetchImpl, sparkUrl)
    if (sparkText) {
      try {
        parsed = parseSparkPayload(JSON.parse(sparkText))
      } catch {
        parsed = new Map()
      }
    }
    const still: string[] = []
    for (const yahoo of chunk) {
      if (parsed.has(yahoo)) {
        const last = parsed.get(yahoo) ?? null
        lastCache.set(yahoo, last)
        out.set(yahoo, last)
      } else {
        still.push(yahoo)
      }
    }
    for (const yahoo of still) {
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=5d&interval=1d`
      let last: number | null = null
      const chartText = await readText(fetchImpl, chartUrl)
      if (chartText) {
        try {
          last = parseChartPayload(JSON.parse(chartText)).last
        } catch {
          last = null
        }
      }
      lastCache.set(yahoo, last)
      out.set(yahoo, last)
    }
  }
  return out
}

export async function readSeries(symbol: string, fetchImpl: FetchLike, range = '1y'): Promise<Bar[]> {
  const yahoo = toYahooSymbol(symbol)
  const key = `${yahoo}|${range}`
  const cached = seriesCache.get(key)
  if (cached) return cached
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=${encodeURIComponent(range)}&interval=1d`
  const text = await readText(fetchImpl, url)
  let series: Bar[] = []
  if (text) {
    try {
      series = parseChartPayload(JSON.parse(text)).series
    } catch {
      series = []
    }
  }
  seriesCache.set(key, series)
  if (series.length > 0) lastCache.set(yahoo, series[series.length - 1].close)
  return series
}

/** Trade-date close fallback when the filing has no price_on_trade_date. */
export async function readCloseOnDate(symbol: string, date: string, fetchImpl: FetchLike): Promise<number | null> {
  const yahoo = toYahooSymbol(symbol)
  const key = `${yahoo}|day|${date}`
  const cached = seriesCache.get(key)
  if (cached) return closeOnOrBefore(cached, date)
  const day = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(day)) return null
  const period1 = Math.floor(day / 1000) - 12 * 86_400
  const period2 = Math.floor(day / 1000) + 5 * 86_400
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?period1=${period1}&period2=${period2}&interval=1d`
  const text = await readText(fetchImpl, url)
  let series: Bar[] = []
  if (text) {
    try {
      series = parseChartPayload(JSON.parse(text)).series
    } catch {
      series = []
    }
  }
  seriesCache.set(key, series)
  return closeOnOrBefore(series, date)
}
