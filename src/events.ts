import { EventEmitter } from 'events'
import type { SyncEventPayload } from './types'

type EventMap = {
  'sync:start': SyncEventPayload
  'sync:finish': SyncEventPayload
  'sync:error': SyncEventPayload
}

export class StorageEvents {
  private emitter = new EventEmitter()

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void) {
    this.emitter.on(event, handler)
    return () => this.emitter.off(event, handler)
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
    this.emitter.emit(event, payload)
  }
}
