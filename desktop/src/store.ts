import type { SessionContext, SettingsView } from './backend'

export type Route = 'home' | 'bodycam' | 'duty' | 'investigations' | 'killclips' | 'tweaks'

/** Gemeinsamer Zustand der Seiten; gesetzt vom App-Gerüst (app.ts). */
export const state: { context: SessionContext | null; settings: SettingsView | null } = {
  context: null,
  settings: null,
}

type Listener = () => void
const listeners = new Set<Listener>()

export function onStateChange(listener: Listener) {
  listeners.add(listener)
}

export function notifyStateChange() {
  for (const listener of listeners) listener()
}

/** Wird von app.ts gesetzt, damit Seiten navigieren können, ohne app.ts zu importieren. */
export const navigation: { go: (route: Route) => void; signOut: () => void } = {
  go: () => {},
  signOut: () => {},
}

/** Hat das angemeldete Konto dieses Recht? (Spiegel der Dashboard-Rechte.) */
export function can(permission: string) {
  return !!state.context?.permissions?.includes(permission)
}
