import { describe, expect, it } from 'vitest'
import {
  HOUSE_PORTAL,
  LARGE_AMOUNT_MIN,
  REFRESH_INTERVAL_MS,
  SENATE_PORTAL,
  alertPreview,
  buildFilings,
  formatRange,
  isLate,
  markTrade,
  matchesChip,
  parseCsv,
  parseLegislators,
  shouldRefresh,
  summarizeMarks,
  toYahooSymbol,
} from './pure'

describe('floor tape pure rules', () => {
  it('a 46-day lag is late and a 45-day lag is not', () => {
    const late = isLate('2024-01-01', '2024-02-16')
    const onTime = isLate('2024-01-01', '2024-02-15')
    console.log(late ? 'a 46-day lag is late' : '46-day lag was not late')
    console.log(!onTime ? 'a 45-day lag is not' : '45-day lag was late')
    expect(late).toBe(true)
    expect(onTime).toBe(false)
  })

  it('shares_est * trade_date_close equals amount_mid', () => {
    const amountMid = 8000
    const tradeDateClose = 100
    const mark = markTrade({
      id: 'buy',
      transactionType: 'BUY',
      symbol: 'AAPL',
      amountMid,
      tradeDateClose,
      lastClose: 125,
    })
    expect(mark.sharesEst).not.toBeNull()
    expect(mark.sharesEst! * tradeDateClose).toBe(amountMid)
    console.log('shares_est * trade_date_close equals amount_mid', mark.sharesEst! * tradeDateClose, amountMid)
  })

  it("a sell's default mark does not invent a cost basis", () => {
    const mark = markTrade({
      id: 'sell',
      transactionType: 'SELL',
      symbol: 'AAPL',
      amountMid: 8000,
      tradeDateClose: 100,
      lastClose: 140,
    })
    console.log('sell unrealized', mark.unrealizedEst, 'included', mark.includedInTotals)
    expect(mark.unrealizedEst).toBeNull()
    expect(mark.returnPct).toBeNull()
    expect(mark.includedInTotals).toBe(false)
  })

  it('an unquoted ticker remains in the row list and is absent from totals', () => {
    const rows = [
      {
        id: 'quoted',
        transactionType: 'BUY' as const,
        symbol: 'AAPL',
        amountMid: 8000,
        tradeDateClose: 100,
        lastClose: 110,
      },
      {
        id: 'unquoted',
        transactionType: 'BUY' as const,
        symbol: null,
        amountMid: 8000,
        tradeDateClose: 100,
        lastClose: null,
      },
    ]
    const summary = summarizeMarks(rows)
    console.log('row ids', summary.rows.map((row) => row.id).join(','))
    console.log('included', summary.includedIds.join(','))
    expect(summary.rows.map((row) => row.id)).toContain('unquoted')
    expect(summary.includedIds).not.toContain('unquoted')
    expect(summary.includedIds).toEqual(['quoted'])
    expect(summary.total).toBe(800)
  })

  it('BRK.B maps to BRK-B', () => {
    const mapped = toYahooSymbol('BRK.B')
    console.log('BRK.B maps to', mapped)
    expect(mapped).toBe('BRK-B')
  })

  it('unforced refresh is due at 2 hours, not sooner, and a missing check is due', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const twoHours = 2 * 60 * 60 * 1000
    const justUnder = new Date(now.getTime() - twoHours + 1).toISOString()
    const exact = new Date(now.getTime() - twoHours).toISOString()
    console.log('interval', REFRESH_INTERVAL_MS, 'just under', shouldRefresh(justUnder, now, false), 'exact', shouldRefresh(exact, now, false))
    expect(REFRESH_INTERVAL_MS).toBe(twoHours)
    expect(shouldRefresh(justUnder, now, false)).toBe(false)
    expect(shouldRefresh(exact, now, false)).toBe(true)
    expect(shouldRefresh(null, now, false)).toBe(true)
    expect(shouldRefresh(justUnder, now, true)).toBe(true)
  })

  it('the alert preview string includes member, ticker or asset, buy or sell, both range ends, trade date, filed date, and a Clerk or eFD link', () => {
    const text = alertPreview({
      politician: 'Nancy Pelosi',
      symbol: 'NVDA',
      assetName: 'NVIDIA Corporation',
      transactionType: 'BUY',
      amountMin: 1001,
      amountMax: 15000,
      amountMid: 8000.5,
      transactionDate: '2024-06-01',
      filedDate: '2024-07-20',
      officialUrl: HOUSE_PORTAL,
    })
    console.log(text)
    expect(text).toContain('Nancy Pelosi')
    expect(text).toContain('NVDA')
    expect(text).toContain('BUY')
    expect(text).toContain('1001')
    expect(text).toContain('15000')
    expect(text).toContain('$1k–$15k · mid $8k')
    expect(text).toContain('2024-06-01')
    expect(text).toContain('2024-07-20')
    expect(text.includes('disclosures-clerk.house.gov') || text.includes('efdsearch.senate.gov')).toBe(true)
    expect(formatRange(1001, 15000, 8000.5)).toBe('$1k–$15k · mid $8k')
  })

  it('a quoted name containing a comma parses', () => {
    const csv = [
      'politician,bioguide_id,party,state,symbol,asset_name,transaction_type,owner,transaction_date,filed_date,amount_min,amount_max,price_on_trade_date',
      '"Gilbert Ray Cisneros, Jr.",C001123,D,CA,DASH,"DoorDash, Inc.",SELL,Self,2024-01-02,2024-02-20,1001,15000,20',
      '"Thomas H. Kean, Jr.",K000398,R,NJ,MSFT,Microsoft Corporation,BUY,Self,2024-01-01,2024-02-15,1001,15000,400',
    ].join('\n')
    const rows = parseCsv(csv)
    console.log('parsed', rows.map((row) => row.politician).join(' | '))
    expect(rows[0]?.politician).toBe('Gilbert Ray Cisneros, Jr.')
    expect(rows[0]?.asset_name).toBe('DoorDash, Inc.')
    expect(rows[1]?.politician).toBe('Thomas H. Kean, Jr.')
    const filings = buildFilings(
      csv,
      parseLegislators(JSON.stringify([{ id: { bioguide: 'C001123' }, terms: [{ type: 'rep' }] }])),
      'hillscore',
    )
    expect(filings.map((row) => row.politician)).toContain('Gilbert Ray Cisneros, Jr.')
    expect(filings.map((row) => row.politician)).toContain('Thomas H. Kean, Jr.')
  })

  it('large is not the same set as all', () => {
    const small = {
      transactionType: 'BUY',
      late: false,
      amountMin: 1001,
      memberId: 'P000197',
      symbol: 'AAPL',
      party: 'D',
      chamber: 'house',
    }
    const big = { ...small, amountMin: LARGE_AMOUNT_MIN }
    expect(matchesChip(small, 'all', null)).toBe(true)
    expect(matchesChip(small, 'large', null)).toBe(false)
    expect(matchesChip(big, 'large', null)).toBe(true)
    expect(LARGE_AMOUNT_MIN).toBe(100_001)
  })

  it('senate portal is the eFD search site', () => {
    expect(SENATE_PORTAL).toContain('efdsearch.senate.gov')
  })
})
