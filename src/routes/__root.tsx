import {
  createRootRoute,
  HeadContent,
  Link,
  Scripts,
  useRouterState,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import appCss from '../styles.css?url'
import { SearchPalette } from '../components/search'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#07080a' },
      { title: 'Floor Tape' },
      { name: 'description', content: 'STOCK Act periodic transaction tape with hypothetical range-mid marks.' },
      { name: 'apple-mobile-web-app-title', content: 'Floor Tape' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootShell,
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

function RootShell({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-bg text-ink antialiased">
        <div className="min-h-screen bg-bg">
          <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur">
            <div className="mx-auto flex w-full max-w-3xl min-w-0 items-center gap-3 px-3 py-2">
              <Link to="/" className="shrink-0 font-mono text-sm tracking-[0.18em] text-ink">
                FLOOR TAPE
              </Link>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted">STOCK Act disclosures</span>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="shrink-0 border border-line px-2 py-1 font-mono text-[11px] text-accent"
              >
                Search<span className="hidden sm:inline"> Cmd K</span>
              </button>
            </div>
            <p className="mx-auto w-full max-w-3xl px-3 pb-2 font-mono text-[11px] leading-snug text-muted">
              Hypothetical marks from disclosure ranges — not investment advice.
            </p>
          </header>
          <main
            className="mx-auto w-full min-w-0 max-w-3xl px-3 pt-3 pb-32"
            style={{ paddingBottom: 'calc(8rem + env(safe-area-inset-bottom))' }}
          >
            {children}
          </main>
          <nav
            className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="mx-auto grid w-full max-w-3xl grid-cols-4">
              <Tab to="/" label="Tape" match="tape" />
              <Tab to="/members" label="Members" match="members" />
              <Tab to="/alerts" label="Alerts" match="alerts" />
              <Tab to="/about" label="Method" match="about" />
            </div>
          </nav>
        </div>
        <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        <Scripts />
      </body>
    </html>
  )
}

function Tab({ to, label, match }: { to: '/' | '/members' | '/alerts' | '/about'; label: string; match: 'tape' | 'members' | 'alerts' | 'about' }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const active =
    match === 'tape'
      ? pathname === '/' || pathname.startsWith('/trade') || pathname.startsWith('/ticker')
      : match === 'members'
        ? pathname.startsWith('/member')
        : match === 'alerts'
          ? pathname.startsWith('/alerts')
          : pathname.startsWith('/about')
  const className = `px-2 py-3 text-center font-mono text-[11px] ${active ? 'text-accent' : 'text-muted'}`
  return (
    <Link to={to} className={className}>
      {label}
    </Link>
  )
}

function RootError({ error }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : 'The tape failed to load.'
  return <p className="font-mono text-sm text-sell">{message}</p>
}

function NotFound() {
  return <p className="font-mono text-sm text-muted">That page is not on the tape.</p>
}
