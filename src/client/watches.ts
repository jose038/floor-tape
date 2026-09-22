import { useEffect, useState } from 'react'
import { emptyWatches, sanitizeWatches, type WatchRules } from '../domain/pure'

const KEY = 'floor-tape.watches.v1'

export function loadWatches(): WatchRules {
  if (typeof window === 'undefined') return emptyWatches()
  try {
    return sanitizeWatches(JSON.parse(window.localStorage.getItem(KEY) || 'null'))
  } catch {
    return emptyWatches()
  }
}

export function saveWatches(rules: WatchRules): void {
  window.localStorage.setItem(KEY, JSON.stringify(rules))
}

export function useWatches(): [WatchRules, (next: WatchRules) => void] {
  const [rules, setRules] = useState<WatchRules>(emptyWatches)
  useEffect(() => {
    setRules(loadWatches())
  }, [])
  const update = (next: WatchRules) => {
    const clean = sanitizeWatches(next)
    setRules(clean)
    saveWatches(clean)
  }
  return [rules, update]
}
