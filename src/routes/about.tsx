import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { SourceBanner } from '../components/ui'
import { HOUSE_PORTAL, LARGE_AMOUNT_MIN, SENATE_PORTAL } from '../domain/pure'
import { loadAbout, refreshLiveFilings } from '../server/api'

export const Route = createFileRoute('/about')({
  loader: () => loadAbout(),
  component: AboutPage,
})

const BUCKETS = [
  '$1,001–$15,000',
  '$15,001–$50,000',
  '$50,001–$100,000',
  '$100,001–$250,000',
  '$250,001–$500,000',
  '$500,001–$1,000,000',
  '$1,000,001–$5,000,000',
  '$5,000,001–$25,000,000',
  '$25,000,001–$50,000,000',
  'Over $50,000,000',
]

function AboutPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <div className="min-w-0 space-y-4 text-sm leading-relaxed">
      <SourceBanner labeledSample={data.labeledSample} />
      <h1 className="font-mono text-sm tracking-wide">Method</h1>
      <p>
        Floor Tape is a disclosure tracker for U.S. STOCK Act periodic transaction reports. It is not a claim that Congress beats the market, and it never shows an official profit.
      </p>
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">45-day rule</h2>
        <p>
          Members are generally required to file within 45 days of the trade. Floor Tape marks a filing late only when the filed date is more than 45 days after the trade date. A 45-day lag is on time. Late rows carry an amber mark.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Range buckets</h2>
        <p>The STOCK Act reports an amount range, not a share count or an exact dollar.</p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-[12px]">
          {BUCKETS.map((bucket) => (
            <li key={bucket}>{bucket}</li>
          ))}
        </ul>
        <p>
          The midpoint is (minimum + maximum) / 2. The Large chip keeps filings whose reported minimum is at least ${LARGE_AMOUNT_MIN.toLocaleString('en-US')} — the $100,001–$250,000 bucket and above. Large is not the same set as All.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Hypothetical P&amp;L</h2>
        <pre className="max-w-full whitespace-pre-wrap break-all border border-line bg-panel p-3 font-mono text-[12px] leading-5">{`shares_est = amount_mid / trade_date_close
unrealized_est = shares_est * (last_close - trade_date_close)
return = last_close / trade_date_close - 1`}</pre>
        <p>
          Every such figure is hypothetical. The trade-date close is the compilation’s price when it has one, otherwise a Yahoo chart close. The last close is Yahoo Finance spark, then the chart endpoint if spark fails. BRK.B is requested as BRK-B. A dollar figure is shown with its source range. Sells do not get an invented cost basis on the default mark. FIFO for the same member and ticker is off unless you turn it on, and it is labeled experimental. Unmapped or unquoted tickers stay on the tape and drop out of totals.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Sources</h2>
        <p>
          Filings since 2023 come from the{' '}
          <a className="text-accent" href="https://hillscore.com/data/" target="_blank" rel="noreferrer">
            Hillscore trades.csv
          </a>{' '}
          compilation, CC BY 4.0. Hillscore covers most-active traders, not all 535 members. If that file is unreachable, the tape shows a labeled non-official sample so the screens still work. Official documents remain the{' '}
          <a className="text-accent" href={HOUSE_PORTAL} target="_blank" rel="noreferrer">
            House Clerk
          </a>{' '}
          and{' '}
          <a className="text-accent" href={SENATE_PORTAL} target="_blank" rel="noreferrer">
            Senate eFD
          </a>
          . Floor Tape does not scrape those portals. Chamber is joined from the public congress-legislators file when a bioguide id is present. Prices are Yahoo Finance public quotes. No paid price feed.
        </p>
        <p className="font-mono text-[11px] text-muted">
          Stored now: {data.labeledSample ? 'sample book' : 'live Hillscore rows'} · {data.rowCount} rows
          {data.lastIngestAt ? ` · ingested ${data.lastIngestAt}` : ''}.
        </p>
      </section>
      <button
        type="button"
        disabled={busy}
        className="border border-accent px-3 py-2 font-mono text-xs text-accent disabled:opacity-50"
        onClick={() => {
          setBusy(true)
          setMessage(null)
          void refreshLiveFilings()
            .then((result) => {
              setMessage(
                result.labeledSample
                  ? 'Hillscore was unreachable. The sample book is on the tape.'
                  : `Loaded ${result.count} live filings.`,
              )
              return router.invalidate()
            })
            .catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : 'Refresh failed')
            })
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Refreshing…' : 'Refresh live filings'}
      </button>
      {message ? <p className="font-mono text-[12px] text-muted">{message}</p> : null}
      <p className="font-mono text-[11px] text-muted">Not investment advice. No auto-trading, copy-trading, or vote prediction.</p>
    </div>
  )
}
