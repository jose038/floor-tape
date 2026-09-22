import { createFileRoute } from '@tanstack/react-router'
import { FilingCard, PriceChart, SourceBanner } from '../components/ui'
import { useWatches } from '../client/watches'
import { formatCount, formatPx, formatRange } from '../domain/pure'
import { loadTicker } from '../server/api'

export const Route = createFileRoute('/ticker/$sym')({
  loader: ({ params }) => loadTicker({ data: params.sym }),
  component: TickerPage,
})

function TickerPage() {
  const data = Route.useLoaderData()
  const [rules, setRules] = useWatches()
  const symbol = data.symbol
  const watching = rules.tickers.includes(symbol)
  const sample = data.filings[0]
  const range = sample ? formatRange(sample.amountMin, sample.amountMax, sample.amountMid) : null
  return (
    <div className="min-w-0 space-y-3">
      <SourceBanner labeledSample={data.labeledSample} />
      <div className="relative min-w-0 pr-28">
        <h1 className="font-mono text-2xl text-ink">{symbol}</h1>
        <p className="font-mono text-[12px] text-muted">
          {formatCount(data.total)} filings
          {data.lastClose != null && range ? ` · last ${formatPx(data.lastClose)} · ${range}` : ''}
        </p>
        <button
          type="button"
          className="absolute right-0 top-0 border border-line bg-panel px-3 py-1.5 font-mono text-xs text-accent"
          onClick={() => {
            const tickers = watching ? rules.tickers.filter((item) => item !== symbol) : [...rules.tickers, symbol]
            setRules({ ...rules, tickers })
          }}
        >
          {watching ? 'Watching' : 'Watch'}
        </button>
      </div>
      <section className="border border-line bg-panel px-3 py-3">
        <PriceChart series={data.series} />
      </section>
      <div className="space-y-2">
        {data.filings.length === 0 ? (
          <p className="font-mono text-sm text-muted">No filers in this name.</p>
        ) : (
          data.filings.map((filing) => <FilingCard key={filing.id} filing={filing} />)
        )}
      </div>
    </div>
  )
}
