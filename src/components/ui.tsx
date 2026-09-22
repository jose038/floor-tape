import { Link } from '@tanstack/react-router'
import {
  formatPct,
  formatPx,
  formatRange,
  formatSignedUsd,
  type Chip,
} from '../domain/pure'
import type { Bar } from '../domain/quotes'
import type { ViewFiling } from '../domain/view'

export function SourceBanner({ labeledSample }: { labeledSample: boolean }) {
  if (labeledSample) {
    return (
      <p className="border border-late/50 bg-late/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-late">
        Sample book — not official filings. Live Hillscore data was unreachable.
      </p>
    )
  }
  return (
    <p className="font-mono text-[11px] leading-relaxed text-muted">
      Hillscore compilation of most-active traders, not all 535 members. Filed since 2023. Official documents remain the House Clerk and Senate eFD.
    </p>
  )
}

export function FilingCard({ filing }: { filing: ViewFiling }) {
  const range = formatRange(filing.amountMin, filing.amountMax, filing.amountMid)
  const sideClass = filing.transactionType === 'BUY' ? 'text-buy' : filing.transactionType === 'SELL' ? 'text-sell' : 'text-muted'
  const border = filing.transactionType === 'BUY' ? 'border-l-buy' : filing.transactionType === 'SELL' ? 'border-l-sell' : 'border-l-line'
  return (
    <article className={`min-w-0 border border-line border-l-2 ${border} bg-panel px-3 py-2 ${filing.late ? 'ring-1 ring-late/70' : ''}`}>
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        {filing.symbol ? (
          <Link to="/ticker/$sym" params={{ sym: filing.symbol }} className="font-mono text-sm text-accent">
            {filing.symbol}
          </Link>
        ) : (
          <span className="font-mono text-sm text-muted">No ticker</span>
        )}
        <span className={`shrink-0 font-mono text-[11px] ${sideClass}`}>{filing.transactionType}</span>
      </div>
      <Link to="/trade/$id" params={{ id: filing.id }} className="mt-1 block min-w-0">
        <p className="truncate text-sm text-ink">{filing.assetName}</p>
        <p className="mt-1 font-mono text-[11px] leading-5 text-muted">
          <span className={filing.late ? 'text-late' : ''}>{filing.late ? `LATE ${filing.lagDays}d` : `${filing.lagDays}d`}</span>
          {' · '}
          {filing.ownerLabel}
          {' · traded '}
          {filing.transactionDate}
          {' · filed '}
          {filing.filedDate}
        </p>
        <p className="mt-1 font-mono text-[12px] leading-5 text-ink">
          {filing.transactionType === 'BUY' && filing.unrealizedEst != null ? (
            <>
              <span className="text-buy">{formatSignedUsd(filing.unrealizedEst)} hyp.</span>
              <span className="text-muted">
                {' · '}
                {formatPct(filing.returnPct)}
                {filing.lastClose != null ? ` · last ${formatPx(filing.lastClose)}` : ''}
                {' · '}
              </span>
              <span>{range}</span>
            </>
          ) : (
            <span className="text-muted">
              {filing.transactionType === 'SELL' ? 'Sell · no cost basis' : 'Excluded from totals'}
              {filing.lastClose != null ? ` · last ${formatPx(filing.lastClose)}` : ''}
              {' · '}
              {range}
            </span>
          )}
        </p>
      </Link>
      <Link to="/member/$id" params={{ id: filing.memberId }} className="mt-1 block truncate text-[13px] text-ink">
        {filing.politician}
        <span className="text-muted"> · {filing.seat}</span>
      </Link>
    </article>
  )
}

export function PriceChart({ series }: { series: Bar[] }) {
  if (series.length < 2) {
    return <p className="font-mono text-[11px] text-muted">Price chart unavailable.</p>
  }
  const width = 320
  const height = 112
  const pad = 6
  const closes = series.map((bar) => bar.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || 1
  const points = series
    .map((bar, index) => {
      const x = pad + (index / (series.length - 1)) * (width - pad * 2)
      const y = pad + (1 - (bar.close - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-28 w-full max-w-full" role="img" aria-label="Closing price">
      <polyline fill="none" stroke="#9ad7ff" strokeWidth="1.6" points={points} />
    </svg>
  )
}

export function VsChart({ bars }: { bars: { symbol: string; hypReturn: number; spyReturn: number | null }[] }) {
  if (bars.length === 0) {
    return <p className="font-mono text-[11px] text-muted">No mapped buys to compare with SPY.</p>
  }
  return (
    <div className="space-y-2">
      {bars.map((bar) => {
        const hypWidth = Math.min(100, Math.abs(bar.hypReturn) * 100)
        const spyWidth = Math.min(100, Math.abs(bar.spyReturn ?? 0) * 100)
        return (
          <div key={bar.symbol} className="min-w-0">
            <div className="flex min-w-0 items-baseline justify-between gap-2 font-mono text-[11px]">
              <span className="truncate text-ink">{bar.symbol}</span>
              <span className="shrink-0 text-muted">
                hyp {formatPct(bar.hypReturn)} · SPY {formatPct(bar.spyReturn)}
              </span>
            </div>
            <div className="mt-1 space-y-1">
              <div className="h-1.5 bg-panel-2">
                <div className="h-full bg-buy" style={{ width: `${hypWidth}%` }} />
              </div>
              <div className="h-1.5 bg-panel-2">
                <div className="h-full bg-accent" style={{ width: `${spyWidth}%` }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export const CHIP_LABEL: Record<Chip, string> = {
  all: 'All',
  buys: 'Buys',
  sells: 'Sells',
  late: 'Late',
  large: 'Large',
  watches: 'Watches',
}

export function MoneyBlock({
  label,
  value,
  range,
}: {
  label: string
  value: string
  range: string
}) {
  return (
    <div className="min-w-0 border border-line bg-panel px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 break-words font-mono text-sm text-ink">
        {value}
        <span className="text-muted"> · {range}</span>
      </p>
    </div>
  )
}
