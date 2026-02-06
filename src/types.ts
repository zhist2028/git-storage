export type ValueType = 'string' | 'number' | 'binary' | 'object' | 'array' | 'list'

export interface RecordMeta {
  id: string
  key: string
  type: ValueType
  createdAt: number
  updatedAt: number
  actorId?: string
  deletedAt?: number | null
  conflictLoser?: { winnerId: string }
}

export interface RecordEntry extends RecordMeta {
  value: any
}

export type SyncState = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  state: SyncState
  inFlight: boolean
  lastAt: number | null
  lastError: string | null
}

export interface HistoryConfig {
  enabled: boolean
  writeCountThreshold: number
  writeBytesThreshold: number
}

export interface GitStorageConfig {
  repoUrl?: string
  branch?: string
  username?: string
  token?: string
  dataDir?: string
  actorId?: string
  autoSync?: boolean
  syncOnChange?: boolean
  syncIntervalMinutes?: number
  history?: Partial<HistoryConfig>
  logger?: (message: string, data?: unknown) => void
}

export interface SyncEventPayload {
  at: number
  reason: string
  status: SyncStatus
}

