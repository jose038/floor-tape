import { REFRESH_INTERVAL_MS } from '../domain/pure'

export type ScheduleTimer = {
  set(callback: () => void, delayMs: number): void
  clear(): void
}

export type RecheckWake = {
  /** False when this wake did not download because the last success is still inside the window. */
  downloaded: boolean
  lastSuccessAt: string | null
}

export type ArmedRecheck<T extends RecheckWake> = {
  trigger(force?: boolean): Promise<T>
  stop(): void
  idle(): Promise<void>
}

export function timeoutScheduleTimer(): ScheduleTimer {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    set(callback, delayMs) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(callback, delayMs)
      timer.unref?.()
    },
    clear() {
      if (timer) clearTimeout(timer)
      timer = undefined
    },
  }
}

/** Cloud Run sets K_SERVICE. A boot-time pull there is what exhausted the instance. */
export function pullsOnStartup(env: NodeJS.ProcessEnv = process.env): boolean {
  return !env.K_SERVICE
}

/**
 * Arm a process-local recheck. The first call runs immediately unless
 * `immediate` is false. Later calls share one in-flight run. The timer fires
 * the same `run` the poll uses. A wake that does not download, because a newer
 * success is still inside the window, waits only until that success is 2 hours old.
 */
export function armFilingRecheck<T extends RecheckWake>(deps: {
  run: (force: boolean) => Promise<T>
  timer: ScheduleTimer
  now?: () => Date
  intervalMs?: number
  immediate?: boolean
}): ArmedRecheck<T> {
  const intervalMs = deps.intervalMs ?? REFRESH_INTERVAL_MS
  const now = deps.now ?? (() => new Date())
  let stopped = false
  let inflight: Promise<T> | null = null
  let pending = 0
  const waiters: Array<() => void> = []

  function track(job: Promise<T>): Promise<T> {
    pending += 1
    void job.finally(() => {
      pending -= 1
      if (pending === 0) {
        const queued = waiters.splice(0)
        for (const resolve of queued) resolve()
      }
    })
    return job
  }

  function delayAfter(wake: RecheckWake | null): number {
    if (!wake || wake.downloaded || !wake.lastSuccessAt) return intervalMs
    const then = Date.parse(wake.lastSuccessAt)
    if (Number.isNaN(then)) return intervalMs
    const remain = then + intervalMs - now().getTime()
    return remain > 0 ? remain : intervalMs
  }

  function trigger(force = false): Promise<T> {
    if (!force && inflight) return inflight
    const job = track(Promise.resolve().then(() => deps.run(force)))
    if (!force) {
      inflight = job
      void job.finally(() => {
        if (inflight === job) inflight = null
      })
    }
    return job
  }

  function armTimer(delayMs: number) {
    if (stopped) return
    deps.timer.set(() => {
      if (stopped) return
      void trigger(false).then(
        (wake) => {
          armTimer(delayAfter(wake))
        },
        (error: unknown) => {
          console.error('[floor-tape] filing recheck failed', error instanceof Error ? error.message : error)
          armTimer(intervalMs)
        },
      )
    }, delayMs)
  }

  if (deps.immediate === false) {
    armTimer(intervalMs)
  } else {
    void trigger(false).then(
      (wake) => {
        armTimer(delayAfter(wake))
      },
      (error: unknown) => {
        console.error('[floor-tape] filing recheck failed', error instanceof Error ? error.message : error)
        armTimer(intervalMs)
      },
    )
  }

  return {
    trigger,
    stop() {
      stopped = true
      deps.timer.clear()
    },
    idle() {
      if (pending === 0) return Promise.resolve()
      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}
