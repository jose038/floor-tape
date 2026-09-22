import { createServerFn } from '@tanstack/react-start'
import type { WatchRules } from '../domain/pure'

export const loadTape = createServerFn({ method: 'POST' })
  .validator((input: { chip: string; q: string; watches: WatchRules | null }) => input)
  .handler(async ({ data }) => {
    const { getTape } = await import('./service')
    return getTape(data)
  })

export const searchFilings = createServerFn({ method: 'POST' })
  .validator((query: string) => (typeof query === 'string' ? query.slice(0, 80) : ''))
  .handler(async ({ data }) => {
    const { searchTape } = await import('./service')
    return searchTape(data)
  })

export const loadTrade = createServerFn({ method: 'POST' })
  .validator((id: string) => (typeof id === 'string' ? id : ''))
  .handler(async ({ data }) => {
    const { getTrade } = await import('./service')
    return getTrade(data)
  })

export const loadMembers = createServerFn({ method: 'GET' }).handler(async () => {
  const { getMembers } = await import('./service')
  return getMembers()
})

export const loadMember = createServerFn({ method: 'POST' })
  .validator((id: string) => (typeof id === 'string' ? id : ''))
  .handler(async ({ data }) => {
    const { getMember } = await import('./service')
    return getMember(data)
  })

export const loadTicker = createServerFn({ method: 'POST' })
  .validator((sym: string) => (typeof sym === 'string' ? sym : ''))
  .handler(async ({ data }) => {
    const { getTicker } = await import('./service')
    return getTicker(data)
  })

export const loadAlerts = createServerFn({ method: 'GET' }).handler(async () => {
  const { getAlerts } = await import('./service')
  return getAlerts()
})

export const loadAbout = createServerFn({ method: 'GET' }).handler(async () => {
  const { getAbout } = await import('./service')
  return getAbout()
})

export const refreshLiveFilings = createServerFn({ method: 'POST' }).handler(async () => {
  const { refreshTape } = await import('./service')
  return refreshTape()
})
