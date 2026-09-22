import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CHIP_LABEL, FilingCard, SourceBanner } from '../components/ui'
import { useWatches } from '../client/watches'
import { formatCount, isChip, type Chip } from '../domain/pure'
import { loadTape } from '../server/api'

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>) => {
    const next: { chip?: Chip; q?: string } = {}
    if (typeof search.chip === 'string' && isChip(search.chip) && search.chip !== 'all') next.chip = search.chip
    if (typeof search.q === 'string' && search.q.trim()) next.q = search.q.trim().slice(0, 80)
    return next
  },
  loaderDeps: ({ search }) => ({ chip: search.chip ?? 'all', q: search.q ?? '' }),
  loader: ({ deps }) => loadTape({ data: { chip: deps.chip, q: deps.q, watches: null } }),
  component: TapePage,
})

const CHIPS: Chip[] = ['all', 'buys', 'sells', 'late', 'large', 'watches']

function TapePage() {
  const search = Route.useSearch()
  const chip = search.chip ?? 'all'
  const q = search.q ?? ''
  const initial = Route.useLoaderData()
  const navigate = useNavigate()
  const [rules] = useWatches()
  const [data, setData] = useState(initial)
  const [draft, setDraft] = useState(q)
  const rulesKey = JSON.stringify(rules)

  useEffect(() => {
    setData(initial)
  }, [initial])

  useEffect(() => {
    setDraft(q)
  }, [q])

  useEffect(() => {
    if (chip !== 'watches') return
    let cancel = false
    void loadTape({ data: { chip: 'watches', q, watches: rules } }).then((next) => {
      if (!cancel) setData(next)
    })
    return () => {
      cancel = true
    }
  }, [chip, q, rulesKey])

  return (
    <div className="min-w-0 space-y-3">
      <SourceBanner labeledSample={data.labeledSample} />
      <form
        className="flex min-w-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void navigate({ to: '/', search: { chip: chip === 'all' ? undefined : chip, q: draft.trim() || undefined } })
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Search member, ticker, company"
          aria-label="Search member, ticker, company"
          suppressHydrationWarning
          className="min-w-0 flex-1 border border-line bg-panel px-3 py-2 font-mono text-sm text-ink outline-none"
        />
        <button type="submit" className="shrink-0 border border-line px-3 font-mono text-xs text-accent">
          Search
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((item) => (
          <Link
            key={item}
            to="/"
            search={{ chip: item === 'all' ? undefined : item, q: q || undefined }}
            title={item === 'large' ? 'Reported minimum at least $100,001' : undefined}
            className={`border px-2 py-1 font-mono text-[11px] ${chip === item ? 'border-accent text-accent' : 'border-line text-muted'}`}
          >
            {CHIP_LABEL[item]}
          </Link>
        ))}
      </div>
      <p className="font-mono text-[11px] text-muted">
        Newest {formatCount(data.filings.length)} of {formatCount(data.totalMatched)}
      </p>
      <div className="space-y-2">
        {data.filings.length === 0 ? (
          <p className="font-mono text-sm text-muted">No filings match this filter.</p>
        ) : (
          data.filings.map((filing) => <FilingCard key={filing.id} filing={filing} />)
        )}
      </div>
    </div>
  )
}
