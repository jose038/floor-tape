import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { FilingCard, SourceBanner, VsChart } from '../components/ui'
import { useWatches } from '../client/watches'
import { fifoExperimental, formatPct, formatRate, formatSignedUsd } from '../domain/pure'
import { loadMember } from '../server/api'

export const Route = createFileRoute('/member/$id')({
  loader: ({ params }) => loadMember({ data: params.id }),
  component: MemberPage,
})

function MemberPage() {
  const data = Route.useLoaderData()
  const [rules, setRules] = useWatches()
  const [fifoOn, setFifoOn] = useState(false)
  const member = data.member
  if (!member || !data.stats) {
    return <p className="font-mono text-sm text-muted">That member is not on the tape.</p>
  }
  const watching = rules.members.includes(member.memberId)
  const fifo = fifoOn ? fifoExperimental(data.lots) : null
  return (
    <div className="min-w-0 space-y-4">
      <SourceBanner labeledSample={data.labeledSample} />
      <div className="relative min-w-0 pr-28">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-line font-mono text-sm">
            {member.initials}
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-xl text-ink">{member.politician}</h1>
            <p className="font-mono text-[12px] text-muted">{member.seat}</p>
          </div>
        </div>
        <button
          type="button"
          className="absolute right-0 top-0 border border-line bg-panel px-3 py-1.5 font-mono text-xs text-accent"
          onClick={() => {
            const members = watching
              ? rules.members.filter((id) => id !== member.memberId)
              : [...rules.members, member.memberId]
            setRules({ ...rules, members })
          }}
        >
          {watching ? 'Watching' : 'Watch'}
        </button>
      </div>
      <p className="font-mono text-[11px] text-muted">range mids · not actual</p>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Open hyp. P&L" value={data.stats.openHyp == null ? '—' : `${formatSignedUsd(data.stats.openHyp)} hyp.`} />
        <Stat label="Win rate" value={formatRate(data.stats.winRate)} />
        <Stat label="Avg vs SPY" value={formatPct(data.stats.avgVsSpy)} />
        <Stat label="Late rate" value={formatRate(data.stats.lateRate)} />
      </div>
      <section className="border border-line bg-panel px-3 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Hyp. book vs SPY</h2>
        <p className="mt-1 font-mono text-[11px] text-muted">Mapped buys only. Green is the hypothetical return. Blue is SPY over the same dates.</p>
        <div className="mt-3">
          <VsChart bars={data.bars} />
        </div>
      </section>
      <label className="flex items-center gap-2 font-mono text-[12px] text-ink">
        <input type="checkbox" checked={fifoOn} onChange={(event) => setFifoOn(event.target.checked)} />
        FIFO same member + ticker (experimental)
      </label>
      {fifo ? (
        <p className="font-mono text-[12px] text-muted">
          Experimental FIFO · realized {fifo.realized == null ? '—' : `${formatSignedUsd(fifo.realized)} hyp.`} · open{' '}
          {fifo.openUnrealized == null ? '—' : `${formatSignedUsd(fifo.openUnrealized)} hyp.`} · range mids · not actual. Sells without a prior lot
          get no invented basis.
        </p>
      ) : null}
      <p className="font-mono text-[11px] text-muted">
        Newest {data.filings.length} of {data.total} ·{' '}
        <Link to="/" search={{ q: member.politician }} className="text-accent">
          on the tape
        </Link>
      </p>
      <div className="space-y-2">
        {data.filings.map((filing) => (
          <FilingCard key={filing.id} filing={filing} />
        ))}
      </div>
      <p className="font-mono text-[11px] text-muted">Not investment advice.</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border border-line bg-panel px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 break-words font-mono text-sm text-ink">{value}</p>
      <p className="font-mono text-[10px] text-muted">range mids · not actual</p>
    </div>
  )
}
