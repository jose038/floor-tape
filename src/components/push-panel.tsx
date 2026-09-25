import { useState } from 'react'
import { enablePush, isIos, isStandalone } from '../client/push'

export function PushPanel() {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ios = isIos()
  const standalone = isStandalone()

  return (
    <section className="space-y-2 border border-line bg-panel px-3 py-3">
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-muted">Push notifications</h2>
      <p className="font-mono text-[12px] leading-relaxed text-muted">
        A check runs about every 2 hours. Each new filing sends a notification. A burst of more than five becomes one summary. The server sleeps between checks.
      </p>
      {ios && !standalone ? (
        <p className="font-mono text-[12px] leading-relaxed text-late">
          On iPhone, add Floor Tape to the Home Screen first (Share, then Add to Home Screen), open it from the icon, then turn notifications on. Safari itself cannot receive them.
        </p>
      ) : (
        <p className="font-mono text-[12px] leading-relaxed text-muted">
          On iPhone this works from the Home Screen app. On a Mac or PC it works in the browser.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        className="border border-accent px-3 py-2 font-mono text-xs text-accent disabled:opacity-50"
        onClick={() => {
          setBusy(true)
          setStatus(null)
          void enablePush()
            .then((result) => {
              if (result === 'on') setStatus('Notifications are on for this device.')
              else if (result === 'denied') setStatus('Notifications were blocked. Allow them in system settings and try again.')
              else if (result === 'needs-install') setStatus('Install Floor Tape to the Home Screen, then open it from the icon.')
              else if (result === 'unconfigured') setStatus('Push is not configured on the server yet.')
              else setStatus('This browser cannot receive push notifications.')
            })
            .finally(() => setBusy(false))
        }}
      >
        {busy ? 'Requesting…' : 'Turn on notifications'}
      </button>
      {status ? <p className="font-mono text-[12px] text-ink">{status}</p> : null}
    </section>
  )
}
