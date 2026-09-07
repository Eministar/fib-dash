import { AsyncLocalStorage } from 'node:async_hooks'

export interface ChangeTrackingContext {
  changeSetId: string
  userId: string
}

const storage = new AsyncLocalStorage<ChangeTrackingContext>()

export function activateChangeTracking(context: ChangeTrackingContext): void {
  storage.enterWith(context)
}

export function currentChangeTracking(): ChangeTrackingContext | undefined {
  return storage.getStore()
}
