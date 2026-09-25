import { REFRESH_INTERVAL_MS } from '../domain/pure'

export type ScheduleTimer = {
  set(callback: () => void, delayMs: number): void
  clear(): void
}

export type ArmedRecheck<T> = {
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

/**
 * Arm a process-local recheck. The first call runs immediately. Later calls
 * share one in-flight run. The timer fires the same `run` the poll uses.
 */
export function armFilingRecheck<T>(deps: {
  run: (force: boolean) => Promise<T>
  timer: ScheduleTimer
  intervalMs?: number
}): ArmedRecheck<T> {
  const intervalMs = deps.intervalMs ?? REFRESH_INTERVAL_MS
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

  function armTimer() {
    if (stopped) return
    deps.timer.set(() => {
      if (stopped) return
      void trigger(false)
        .catch((error: unknown) => {
          console.error('[floor-tape] filing recheck failed', error instanceof Error ? error.message : error)
        })
        .finally(() => {
          armTimer()
        })
    }, intervalMs)
  }

  void trigger(false)
    .catch((error: unknown) => {
      console.error('[floor-tape] filing recheck failed', error instanceof Error ? error.message : error)
    })
    .finally(() => {
      armTimer()
    })

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
