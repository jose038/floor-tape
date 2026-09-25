/** Shared by the startup bundle and the request bundle. A module-local lock is not. */
export const PULL_SLOT = '__floorTapePull'

type PullSlot = { pending: Promise<void> | null }
type PullHost = typeof globalThis & { [PULL_SLOT]?: PullSlot }

function slot(): PullSlot {
  const host = globalThis as PullHost
  const existing = host[PULL_SLOT]
  if (existing) return existing
  const created: PullSlot = { pending: null }
  host[PULL_SLOT] = created
  return created
}

/**
 * Run pulls one at a time. A caller that arrives while one is in flight waits,
 * then runs itself, so a second unforced check can see the new last-success
 * time and skip the download. A forced check that waited still runs.
 */
export function sharePull<T>(force: boolean, run: () => Promise<T>): Promise<T> {
  const state = slot()
  if (state.pending) {
    return state.pending.then(
      () => sharePull(force, run),
      () => sharePull(force, run),
    )
  }
  const job = Promise.resolve().then(run)
  const tracked = job.then(
    () => undefined,
    () => undefined,
  )
  state.pending = tracked
  void tracked.finally(() => {
    if (state.pending === tracked) state.pending = null
  })
  return job
}
