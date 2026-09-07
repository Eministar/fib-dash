'use client'

export const LIVE_UPDATE_EVENT = 'fib:live-update'
export const LIVE_UPDATE_CHANNEL = 'fib-live-updates'
export const LIVE_REFRESH_INTERVAL_MS = 5_000

export function notifyLiveUpdate(): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(LIVE_UPDATE_EVENT))

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(LIVE_UPDATE_CHANNEL)
    channel.postMessage({ type: LIVE_UPDATE_EVENT })
    channel.close()
  }
}
