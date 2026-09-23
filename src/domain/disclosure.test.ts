import { describe, expect, it } from 'vitest'
import {
  SOURCES_COPY,
  parsePeriodicReport,
  periodicReportLinks,
} from './disclosure'
import {
  HOUSE_PORTAL,
  SENATE_PORTAL,
  buildFilings,
  documentLabel,
  filterByGroup,
  institutionGroup,
  parseLegislators,
  seatLabel,
} from './pure'
import { buildRoster } from './roster'
import { toView } from './view'

const TRUMP_URL =
  'https://www.whitehouse.gov/wp-content/uploads/2026/01/President-Donald-J.-Trump-Periodic-Transaction-Report-Amendment-1.14.26.pdf'
const WILES_URL =
  'https://www.whitehouse.gov/wp-content/uploads/2025/11/Wiles-Susie-Periodic-Transaction-Report-06.13.25.pdf'
const KUSHNER_URL = 'https://www.documentcloud.org/documents/27968452-charles-kushner-09262025-278t.pdf'

/** Vision OCR of the public Trump amendment exhibit, plus the report header. */
const TRUMP_EXCERPT = `PERIODIC TRANSACTION REPORT
Filer: Donald J. Trump
Position: President of the United States
Date of Report: August 12, 2025
EXHIBITA
In place of line item #27, substitute the following:
#
Description
Type
Date
27
WISCONSIN ST HLTH & EFA REV ADVOCATE HLTH HOSP
CORP SER 82 8/E 5.00 % Duo Aue 15, 2054
Purchase 7/17/25
In place of line item #52, substitute the following:
# Description
Type
Date
52
BLACK BELT ENERGY GAS DIST AL GAS REV PJ 6 SER B B/E
4.00% Duo Oct 1 2052
Purchase
| 7/11/25
In place of line item #71, substitute the following:
#
Description
Type
|Date
IKHOXVILLE TN CMNTY DEV CORPMITIFAM REV COLLZD
HSG DGA GROSVENSOR BIE 4.00 % Duo D
Purchase 7/10/25
In place of line item #123, substitute the following:
#
Description
Type
Date
123
BASTROP TX INOPT SCH DIST BLOG PSF GTD B/E 4.00% Duo
Fob 15,2034
Purchase
7/7/25
Notification
Over 30 days
| Yes
Notification
Over 30 days
Yes
Notification
Over 30 days
Yes
Notification
Over 30 days
Yes
Amount
100,001-250,000
Amount
1,000,001-
5,000,000
Amount
50,001-100,000
Amount
15,001-50,000
`

/** extractText of Susie Wiles's public 278-T. */
const WILES_EXCERPT = `Periodic Transaction Report (OGE Form 278-T)
Filer's Information
Wiles, Susie
Assistant to the President and Chief of Staff, Trump-Vance (2025) - White House
/s/ Wiles, Susie [electronically signed on 06/13/2025 by Wiles, Susie in Integrity.gov]
# DESCRIPTION TYPE DATE NOTIFICATION
RECEIVED OVER
30 DAYS AGO
AMOUNT
1 Procter & Gamble Co. (PG) Sale 06/09/2025 No $15,001 - $50,000
2 Defiance 5g Next General Connectivity ETF (SIXG) Sale 06/10/2025 No $100,001 -
$250,000
`

/** extractText of Charles Kushner's public State Department 278-T. */
const KUSHNER_EXCERPT = `Periodic Transaction Report (OGE Form 278-T)
Filer's Information
Kushner, Charles
Ambassador To France and Monaco, Department of State
/s/ Kushner, Charles [electronically signed on 09/26/2025 by Kushner, Charles in Integrity.gov]
# DESCRIPTION TYPE DATE NOTIFICATION
RECEIVED OVER
30 DAYS AGO
AMOUNT
1 Alphabet/Google Sale 08/25/2025 No $1,000,001 -
$5,000,000
2 Amazon Sale 08/25/2025 No $1,000,001 -
$5,000,000
`

const HILL_CSV = `politician,bioguide_id,party,state,symbol,asset_name,transaction_type,owner,transaction_date,filed_date,amount_min,amount_max,price_on_trade_date
Nancy Pelosi,P000197,D,CA,NVDA,NVIDIA Corporation,BUY,Self,2024-11-01,2024-11-20,1000001,5000000,140.25
Tommy Tuberville,T000278,R,AL,HUM,Humana Inc.,SELL,Self,2024-01-02,2024-03-15,15001,50000,450
Riley Other,,I,DC,,Some Family LP,BUY,Self,2024-04-01,2024-04-20,1001,15000,
`

function host(url: string): string {
  return new URL(url).host.replace(/^www\./, '')
}

describe('white house and state periodic reports', () => {
  const trump = parsePeriodicReport(TRUMP_EXCERPT, { url: TRUMP_URL, source: 'disclosure', hint: 'whitehouse' })
  const wiles = parsePeriodicReport(WILES_EXCERPT, { url: WILES_URL, source: 'disclosure', hint: 'whitehouse' })
  const kushner = parsePeriodicReport(KUSHNER_EXCERPT, {
    url: KUSHNER_URL,
    source: 'disclosure',
    hint: 'whitehouse',
    label: 'Charles Kushner OGE Form 278-T',
  })
  const hill = buildFilings(
    HILL_CSV,
    parseLegislators(
      JSON.stringify([
        { id: { bioguide: 'P000197' }, terms: [{ type: 'rep' }] },
        { id: { bioguide: 'T000278' }, terms: [{ type: 'sen' }] },
      ]),
    ),
    'hillscore',
  )
  const filings = [...hill, ...trump, ...wiles, ...kushner]

  it('parses Trump and another White House filer as White House, and keeps House and Senate', () => {
    const donald = trump.find((row) => row.politician.includes('Trump'))
    const susie = wiles.find((row) => row.symbol === 'PG')
    const sixg = wiles.find((row) => row.symbol === 'SIXG')
    const pelosi = hill.find((row) => row.politician.includes('Pelosi'))
    const tuberville = hill.find((row) => row.politician.includes('Tuberville'))
    expect(trump).toHaveLength(4)
    expect(wiles).toHaveLength(2)
    expect(donald).toBeTruthy()
    expect(susie).toBeTruthy()
    expect(donald?.chamber).toBe('whitehouse')
    expect(susie?.chamber).toBe('whitehouse')
    expect(pelosi?.chamber).toBe('house')
    expect(tuberville?.chamber).toBe('senate')
    expect(['whitehouse.gov', 'oge.gov']).toContain(host(donald!.officialUrl))
    expect(['whitehouse.gov', 'oge.gov']).toContain(host(susie!.officialUrl))
    expect(donald?.transactionType).toBe('BUY')
    expect(donald?.transactionDate).toBe('2025-07-17')
    expect(donald?.filedDate).toBe('2025-08-12')
    expect(donald?.amountMin).toBe(100001)
    expect(donald?.amountMax).toBe(250000)
    expect(donald?.assetName.toUpperCase()).toContain('WISCONSIN')
    expect(susie?.transactionType).toBe('SELL')
    expect(susie?.symbol).toBe('PG')
    expect(susie?.transactionDate).toBe('2025-06-09')
    expect(susie?.filedDate).toBe('2025-06-13')
    expect(susie?.amountMin).toBe(15001)
    expect(susie?.amountMax).toBe(50000)
    expect(sixg?.amountMin).toBe(100001)
    expect(sixg?.amountMax).toBe(250000)
    expect(seatLabel(donald!.party, donald!.state, donald!.chamber)).toBe('White House')
    expect(seatLabel(donald!.party, donald!.state, donald!.chamber)).not.toContain('Chamber unknown')
    expect(toView(donald!, null, null).seat).toBe('White House')
    const names = filings.map((row) => row.politician)
    expect(names.some((name) => name.includes('Ivanka'))).toBe(false)
    expect(names.some((name) => name.includes('Jared'))).toBe(false)
    console.log('trump', donald?.politician, donald?.assetName, donald?.amountMin, donald?.officialUrl)
    console.log('wiles', susie?.politician, susie?.symbol, susie?.chamber)
  })

  it('does not label a State Department Kushner filing as White House', () => {
    expect(kushner.length).toBeGreaterThan(0)
    expect(kushner.every((row) => row.chamber === 'state')).toBe(true)
    expect(kushner.every((row) => row.chamber !== 'whitehouse')).toBe(true)
    expect(kushner[0]?.politician).toBe('Charles Kushner')
    expect(kushner[0]?.transactionType).toBe('SELL')
    expect(kushner[0]?.transactionDate).toBe('2025-08-25')
    expect(kushner[0]?.amountMin).toBe(1000001)
    expect(institutionGroup(kushner[0]!.chamber)).toBe('other')
    expect(seatLabel(null, null, 'state')).toBe('State')
  })

  it('groups House, Senate, White House, and residual', () => {
    const groups = {
      house: filings.filter((row) => institutionGroup(row.chamber) === 'house'),
      senate: filings.filter((row) => institutionGroup(row.chamber) === 'senate'),
      whitehouse: filings.filter((row) => institutionGroup(row.chamber) === 'whitehouse'),
      other: filings.filter((row) => institutionGroup(row.chamber) === 'other'),
    }
    expect(groups.house.some((row) => row.politician.includes('Pelosi'))).toBe(true)
    expect(groups.senate.some((row) => row.politician.includes('Tuberville'))).toBe(true)
    expect(groups.whitehouse.some((row) => row.politician.includes('Trump'))).toBe(true)
    expect(groups.other.some((row) => row.politician.includes('Kushner') || row.politician.includes('Riley'))).toBe(true)
    expect(filterByGroup(filings, 'whitehouse').every((row) => row.chamber === 'whitehouse')).toBe(true)
    expect(filterByGroup(filings, 'whitehouse').some((row) => row.chamber === 'house')).toBe(false)
    const roster = buildRoster(filings)
    expect(roster.find((member) => member.politician.includes('Trump'))?.chamber).toBe('whitehouse')
    expect(roster.find((member) => member.politician.includes('Pelosi'))?.chamber).toBe('house')
  })

  it('names White House reports and the Kushner omissions in the sources copy', () => {
    expect(SOURCES_COPY.toLowerCase()).toContain('white house')
    expect(SOURCES_COPY.toLowerCase()).toContain('periodic transaction')
    expect(SOURCES_COPY).toContain('No public transaction report was included for Jared Kushner')
    expect(SOURCES_COPY).toContain('FY26-109')
    expect(SOURCES_COPY).toContain('2026-09-14')
    expect(SOURCES_COPY).toContain('not on the White House disclosures index')
    expect(SOURCES_COPY).toContain('No public transaction report was included for Ivanka Trump')
    expect(SOURCES_COPY).toContain('Charles Kushner')
    expect(SOURCES_COPY).toContain('Department of State')
    expect(documentLabel({ chamber: 'house', officialUrl: HOUSE_PORTAL })).toBe('House Clerk')
    expect(documentLabel({ chamber: 'senate', officialUrl: SENATE_PORTAL })).toBe('Senate eFD')
    expect(documentLabel({ chamber: 'whitehouse', officialUrl: TRUMP_URL })).not.toBe('House Clerk')
    expect(documentLabel({ chamber: 'whitehouse', officialUrl: TRUMP_URL })).toBe('White House disclosure')
  })

  it('parses the columnar Vision header from a scanned Trump amendment', () => {
    const text = `Filer:
Position:
Reporting Period:
Date of Report:
Donald J. Trump
President of the United States
July 1, 2025 - July 23, 2025
August 12, 2025
EXHIBITA
In place of line item #27, substitute the following:
27
WISCONSIN ST HLTH & EFA REV ADVOCATE HLTH HOSP
Purchase 7/17/25
Amount
100,001-250,000
`
    const rows = parsePeriodicReport(text, { url: TRUMP_URL, source: 'disclosure', hint: 'whitehouse' })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.politician).toBe('Donald J. Trump')
    expect(rows[0]?.chamber).toBe('whitehouse')
    expect(rows[0]?.filedDate).toBe('2025-08-12')
    expect(rows[0]?.transactionDate).toBe('2025-07-17')
    expect(rows[0]?.assetName.startsWith('WISCONSIN')).toBe(true)
  })

  it('reads periodic transaction links out of the White House disclosures section only', () => {
    const html = `<div><a href="https://www.whitehouse.gov/wp-content/uploads/2025/06/Zakaria-Hannah.pdf">Zakaria, Hannah</a></div>
<details><summary>Transaction Reports</summary>
<div><a href="https://www.whitehouse.gov/wp-content/uploads/2026/08/President-Donald-J.-Trump-Periodic-Transaction-Report-08.12.26.pdf">President Donald J. Trump Periodic Transaction Report 08.12.26</a></div>
<div><a href="https://www.whitehouse.gov/wp-content/uploads/2025/11/Wiles-Susie-Periodic-Transaction-Report.pdf">Wiles, Susie &#8211; Periodic Transaction Report&#8211; 06.13.25</a></div>
</details>
<details><summary>2025-2026 Annual Report to Congress on White House Staff</summary>
<a href="https://www.whitehouse.gov/wp-content/uploads/2026/07/staff.pdf">2026 Annual Report to Congress on White House Staff</a>
</details>`
    const links = periodicReportLinks(html)
    expect(links.map((link) => link.label)).toEqual([
      'President Donald J. Trump Periodic Transaction Report 08.12.26',
      'Wiles, Susie – Periodic Transaction Report– 06.13.25',
    ])
    expect(links.some((link) => link.url.includes('Zakaria'))).toBe(false)
    expect(links.some((link) => link.url.includes('staff.pdf'))).toBe(false)
  })
})
