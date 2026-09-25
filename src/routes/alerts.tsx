import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { PushPanel } from '../components/push-panel'
import { SourceBanner } from '../components/ui'
import { useWatches } from '../client/watches'
import { alertPreview, compareNewest, hasWatchRules, isWatched, LARGE_AMOUNT_MIN } from '../domain/pure'
import { loadAlerts } from '../server/api'

export const Route = createFileRoute('/alerts')({
  loader: () => loadAlerts(),
  component: AlertsPage,
})

function AlertsPage() {
  const data = Route.useLoaderData()
  const [rules, setRules] = useWatches()
  const [memberQuery, setMemberQuery] = useState('')
  const [tickerDraft, setTickerDraft] = useState('')
  const members = data.members
    .filter((member) => member.politician.toLowerCase().includes(memberQuery.trim().toLowerCase()))
    .slice(0, 40)
  const preview = useMemo(() => {
    const sorted = [...data.latest].sort(compareNewest)
    if (hasWatchRules(rules)) {
      const hit = sorted.find((row) => isWatched(row, rules))
      if (hit) return { filing: hit, matched: true }
    }
    return { filing: sorted[0] ?? null, matched: false }
  }, [data.latest, rules])
  const letter = preview.filing ? alertPreview(preview.filing) : ''

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
  }

  return (
    <div className="min-w-0 space-y-4">
      <SourceBanner labeledSample={data.labeledSample} />
      <PushPanel />
      <h1 className="font-mono text-sm tracking-wide">Alerts</h1>
      <p className="font-mono text-[11px] leading-relaxed text-muted">
        Follows stay in this browser. The letter below is a preview — Floor Tape does not send email.
      </p>

      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Members</h2>
        <input
          value={memberQuery}
          onChange={(event) => setMemberQuery(event.target.value)}
          placeholder="Filter members"
          aria-label="Filter members"
          suppressHydrationWarning
          className="w-full border border-line bg-panel px-3 py-2 font-mono text-sm outline-none"
        />
        <ul className="max-h-64 overflow-y-auto border border-line">
          {members.map((member) => {
            const on = rules.members.includes(member.memberId)
            return (
              <li key={member.memberId} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left"
                  onClick={() => setRules({ ...rules, members: toggle(rules.members, member.memberId) })}
                >
                  <span className="min-w-0 truncate text-sm">{member.politician}</span>
                  <span className={`shrink-0 font-mono text-[11px] ${on ? 'text-accent' : 'text-muted'}`}>{on ? 'On' : 'Off'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Tickers</h2>
        <form
          className="flex min-w-0 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const ticker = tickerDraft.trim().toUpperCase()
            if (!ticker) return
            if (!rules.tickers.includes(ticker)) setRules({ ...rules, tickers: [...rules.tickers, ticker] })
            setTickerDraft('')
          }}
        >
          <input
            value={tickerDraft}
            onChange={(event) => setTickerDraft(event.target.value)}
            placeholder="NVDA"
            aria-label="Ticker to follow"
            suppressHydrationWarning
            className="min-w-0 flex-1 border border-line bg-panel px-3 py-2 font-mono text-sm outline-none"
          />
          <button type="submit" className="shrink-0 border border-line px-3 font-mono text-xs text-accent">
            Follow
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {rules.tickers.map((ticker) => (
            <button
              key={ticker}
              type="button"
              className="border border-line px-2 py-1 font-mono text-[11px] text-accent"
              onClick={() => setRules({ ...rules, tickers: rules.tickers.filter((item) => item !== ticker) })}
            >
              {ticker} ×
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Parties</h2>
        <div className="flex flex-wrap gap-2">
          {['D', 'R', 'I'].map((party) => {
            const on = rules.parties.includes(party)
            return (
              <button
                key={party}
                type="button"
                className={`border px-3 py-1 font-mono text-xs ${on ? 'border-accent text-accent' : 'border-line text-muted'}`}
                onClick={() => setRules({ ...rules, parties: toggle(rules.parties, party) })}
              >
                {party}
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Chambers</h2>
        <div className="flex flex-wrap gap-2">
          {[
            ['house', 'House'],
            ['senate', 'Senate'],
            ['whitehouse', 'White House'],
            ['other', 'Other'],
          ].map(([id, label]) => {
            const on = rules.chambers.includes(id)
            return (
              <button
                key={id}
                type="button"
                className={`border px-3 py-1 font-mono text-xs ${on ? 'border-accent text-accent' : 'border-line text-muted'}`}
                onClick={() => setRules({ ...rules, chambers: toggle(rules.chambers, id) })}
              >
                {label}
              </button>
            )
          })}
        </div>
      </section>

      <label className="flex items-center gap-2 font-mono text-[12px]">
        <input
          type="checkbox"
          checked={rules.largeBuysOnly}
          onChange={(event) => setRules({ ...rules, largeBuysOnly: event.target.checked })}
        />
        Large buys only (minimum at least ${LARGE_AMOUNT_MIN.toLocaleString('en-US')})
      </label>

      <section className="border border-line bg-panel px-3 py-3">
        <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Email letter preview</h2>
        <p className="mt-1 font-mono text-[11px] text-muted">
          {preview.matched ? 'Newest filing that matches your follows.' : 'Example from the newest filing. Follow someone to narrow this.'}
        </p>
        {letter ? (
          <pre className="mt-3 max-w-full whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-ink">{letter}</pre>
        ) : (
          <p className="mt-3 font-mono text-sm text-muted">No filing to preview.</p>
        )}
        {preview.filing ? (
          <a href={preview.filing.officialUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block font-mono text-xs text-accent">
            Official filing
          </a>
        ) : null}
      </section>
    </div>
  )
}
