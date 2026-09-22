export type PushPublicConfig = { publicKey: string | null }

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index)
  return output
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const media = window.matchMedia?.('(display-mode: standalone)').matches
  const safari = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return Boolean(media || safari)
}

export async function enablePush(): Promise<'on' | 'denied' | 'unsupported' | 'unconfigured' | 'needs-install'> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported'
  }
  if (isIos() && !isStandalone()) return 'needs-install'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const configResponse = await fetch('/api/push/subscribe')
  if (!configResponse.ok) return 'unconfigured'
  const config = (await configResponse.json()) as PushPublicConfig
  if (!config.publicKey) return 'unconfigured'
  const registration = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
  })
  const json = subscription.toJSON()
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(json),
  })
  if (!response.ok) return 'unconfigured'
  return 'on'
}
