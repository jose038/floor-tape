import { createFileRoute, Link } from '@tanstack/react-router'
import { MoneyBlock, PriceChart, SourceBanner } from '../components/ui'
import { documentLabel, formatPct, formatPx, formatRange, formatSignedUsd } from '../domain/pure'
import { loadTrade } from '../server/api'

export const Route = createFileRoute('/trade/$id')({
  loader: ({ params }) => loadTrade({ data: params.id }),
  component: TradePage,
})

function TradePage() {
  const data = Route.useLoaderData()
  const filing = data.filing
  if (!filing) {
    return <p className="font-mono text-sm text-muted">That filing is not on the tape.</p>
  }
  const range = formatRange(filing.amountMin, filing.amountMax, filing.amountMid)
  const portal = documentLabel(filing)
  return (
    <div className="min-w-0 space-y-3">
      <SourceBanner labeledSample={data.labeledSample} />
      <div className="min-w-0">
        <p className="font-mono text-[11px] text-muted">
          <Link to="/member/$id" params={{ id: filing.memberId }} className="text-ink">
            {filing.politician}
          </Link>
          {' · '}
          {filing.seat}
        </p>
        <h1 className="mt-1 break-words text-xl text-ink">{filing.assetName}</h1>
        <p className="mt-1 font-mono text-sm">
          {filing.symbol ? (
            <Link to="/ticker/$sym" params={{ sym: filing.symbol }} className="text-accent">
              {filing.symbol}
            </Link>
          ) : (
            <span className="text-muted">No ticker</span>
          )}
          <span className={filing.transactionType === 'BUY' ? 'text-buy' : filing.transactionType === 'SELL' ? 'text-sell' : 'text-muted'}>
            {' · '}
            {filing.transactionType}
          </span>
          <span className="text-muted"> · {filing.ownerLabel}</span>
        </p>
      </div>
      <p className={`font-mono text-[12px] ${filing.late ? 'text-late' : 'text-muted'}`}>
        Traded {filing.transactionDate}. Filed {filing.filedDate}. Lag {filing.lagDays} days versus the 45-day rule.
        {filing.late ? ' Late filing.' : ' Within 45 days.'}
      </p>
      <div className="grid min-w-0 gap-2">
        <MoneyBlock label="Reported range" value={range} range={range} />
        <MoneyBlock label="Trade-date close" value={formatPx(filing.tradeDateClose)} range={range} />
        <MoneyBlock label="Last close" value={formatPx(filing.lastClose)} range={range} />
        <MoneyBlock
          label="Hypothetical P&L"
          value={
            filing.unrealizedEst == null
              ? filing.transactionType === 'SELL'
                ? 'No cost basis on sells'
                : 'Excluded from totals'
              : `${formatSignedUsd(filing.unrealizedEst)} hyp. · ${formatPct(filing.returnPct)}`
          }
          range={range}
        />
      </div>
      {filing.transactionType === 'SELL' ? (
        <p className="font-mono text-[11px] text-muted">Default per-trade mark does not invent a cost basis for sells.</p>
      ) : null}
      {!filing.symbol || filing.lastClose == null ? (
        <p className="font-mono text-[11px] text-muted">Unmapped or unquoted tickers stay on the tape and drop out of totals.</p>
      ) : null}
      <a href={filing.officialUrl} target="_blank" rel="noreferrer" className="inline-block font-mono text-sm text-accent">
        Official filing · {portal}
      </a>
      <section className="border border-line bg-panel px-3 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Price</h2>
        <div className="mt-2">
          <PriceChart series={data.series} />
        </div>
      </section>
    </div>
  )
}
