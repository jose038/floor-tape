import { describe, expect, it } from 'vitest'
import { freshFilingIds, pushesFor, type FilingNotice } from './notify'
import { listMigrationFiles } from './migrations'

function notice(id: string, filedDate: string, symbol: string | null = 'NVDA'): FilingNotice {
  return {
    id,
    politician: 'Nancy Pelosi',
    symbol,
    assetName: 'NVIDIA Corporation',
    transactionType: 'BUY',
    amountMin: 1001,
    amountMax: 15000,
    amountMid: 8000.5,
    filedDate,
  }
}

describe('new filing notifications', () => {
  it('seeds on the first poll and does not notify the existing book', () => {
    const result = freshFilingIds(null, ['a', 'b', 'c'])
    expect(result.seeded).toBe(true)
    expect(result.fresh).toEqual([])
  })

  it('returns only filing ids that were not already seen', () => {
    const result = freshFilingIds(new Set(['a', 'b']), ['a', 'b', 'c'])
    expect(result.seeded).toBe(false)
    expect(result.fresh).toEqual(['c'])
  })

  it('names the member, ticker, side, range, and trade link', () => {
    const [push] = pushesFor([notice('trade-1', '2026-09-17')])
    expect(push?.title).toContain('Nancy Pelosi')
    expect(push?.title).toContain('NVDA')
    expect(push?.title).toContain('BUY')
    expect(push?.body).toContain('$1k–$15k · mid $8k')
    expect(push?.body).toContain('2026-09-17')
    expect(push?.url).toBe('/trade/trade-1')
  })

  it('collapses a burst of new filings into one summary', () => {
    const rows = Array.from({ length: 6 }, (_, index) => notice(`id-${index}`, `2026-09-${String(index + 1).padStart(2, '0')}`, `S${index}`))
    const pushes = pushesFor(rows)
    expect(pushes).toHaveLength(1)
    expect(pushes[0]?.title).toBe('6 new disclosures')
    expect(pushes[0]?.url).toBe('/')
  })

  it('runs 0003 after 0002', () => {
    expect(listMigrationFiles(['0003_push.sql', 'notes.txt', '0002_filings.sql'])).toEqual([
      '0002_filings.sql',
      '0003_push.sql',
    ])
  })
})
