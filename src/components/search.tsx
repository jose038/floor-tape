import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { searchFilings } from '../server/api'
import type { ViewFiling } from '../domain/view'

export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<ViewFiling[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!open) return
    const handle = window.setTimeout(() => {
      void searchFilings({ data: query }).then((result) => {
        setRows(result.filings)
        setTotal(result.total)
      })
    }, 180)
    return () => window.clearTimeout(handle)
  }, [open, query])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 p-3" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-3xl border border-line bg-bg"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          suppressHydrationWarning
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search member, ticker, company"
          aria-label="Search member, ticker, company"
          className="w-full border-b border-line bg-bg px-3 py-3 font-mono text-sm text-ink outline-none"
        />
        <p className="px-3 py-2 font-mono text-[11px] text-muted">{total} matches</p>
        <ul className="max-h-[50vh] overflow-y-auto">
          {rows.map((row) => (
            <li key={row.id} className="border-t border-line">
              <Link
                to="/trade/$id"
                params={{ id: row.id }}
                onClick={onClose}
                className="block min-w-0 px-3 py-2"
              >
                <span className="font-mono text-xs text-accent">{row.symbol ?? 'No ticker'}</span>
                <span className="ml-2 text-sm">{row.politician}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{row.assetName}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-line px-3 py-2">
          <Link to="/" search={{ q: query || undefined }} onClick={onClose} className="font-mono text-xs text-accent">
            Open on the tape
          </Link>
        </div>
      </div>
    </div>
  )
}
