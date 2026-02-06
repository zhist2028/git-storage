# git-storage

Git-based storage and sync library (Node.js). Provides Redis-style APIs over a Git-backed data store with record-level merge, auto sync, and history compaction.

## Features
- Key-based access for string/number/binary/object/array
- List operations (lpush/rpush/lpop/rpop/llen/lrange/lindex/lset)
- Record-level merge (LWW by updatedAt, id tie-break)
- List conflict merge: losers are inserted after winners with conflict markers
- 256-bucket storage to reduce conflicts
- Auto sync on change + manual sync + optional interval sync
- Auto history compaction (by write count/size)
- Scan/keys/list operations
- Sync status events

## Installation
```bash
npm install git-storage
```

## Quick start
```ts
import { GitStorage } from 'git-storage'

const store = new GitStorage({
  repoUrl: 'https://example.com/your/repo.git',
  branch: 'main',
  username: 'git',
  token: 'xxx',
  autoSync: true,
  syncOnChange: true,
  syncIntervalMinutes: 10
})

await store.set('user:1', { name: 'Alice' })
const user = await store.get('user:1')

const values = await store.mget(['user:1', 'user:2'])
const keys = await store.keys('user:*')

await store.lpush('todos', { title: 'buy milk' })
await store.rpush('todos', { title: 'ship order' })
const todoItems = await store.lrange('todos', 0, -1)

store.on('sync:start', (info) => console.log('sync start', info))
store.on('sync:finish', (info) => console.log('sync finish', info))
store.on('sync:error', (info) => console.log('sync error', info))
```

## API usage
### Basic KV
```ts
await store.set('profile:1', { name: 'Alice', age: 20 })
const profile = await store.get('profile:1')
const exists = await store.has('profile:1')
await store.del('profile:1')
```

### Batch and scan
```ts
await store.mset({ 'a:1': 1, 'a:2': 2 })
const values = await store.mget(['a:1', 'a:2', 'a:3'])
const keys = await store.keys('a:*')
const page = await store.scan(0, 'a:*', 2)
```

### Lists
```ts
await store.lpush('tasks', { title: 'draft' })
await store.rpush('tasks', { title: 'ship' })
const first = await store.lindex('tasks', 0)
const all = await store.lrange('tasks', 0, -1)
await store.lset('tasks', 0, { title: 'draft v2' })
const popped = await store.lpop('tasks')
```

### List debug helpers
```ts
const items = await store.litems('tasks')
const meta = await store.lmeta('tasks')
```

### Sync control
```ts
const result = await store.sync('manual')
if (!result.success) console.error(result.error)
```

## API reference

### Constructor
```ts
new GitStorage(config: GitStorageConfig)
```

### Core operations
```ts
get(key: string): Promise<any | null>
set(key: string, value: any): Promise<void>
has(key: string): Promise<boolean>
del(key: string): Promise<void>
```

### Batch operations
```ts
mget(keys: string[]): Promise<Array<any | null>>
mset(values: Record<string, any>): Promise<void>
```

### Metadata
```ts
type(key: string): Promise<ValueType | null>
meta(key: string): Promise<RecordEntry | null>
```

### Listing & scanning
```ts
keys(pattern?: string): Promise<string[]>
scan(cursor?: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }>
list(prefix?: string, limit?: number, offset?: number): Promise<string[]>
```

### List operations
```ts
lpush(key: string, ...values: any[]): Promise<number>
rpush(key: string, ...values: any[]): Promise<number>
lpop(key: string, count?: number): Promise<any | null | any[]>
rpop(key: string, count?: number): Promise<any | null | any[]>
llen(key: string): Promise<number>
lrange(key: string, start: number, stop: number): Promise<any[]>
lindex(key: string, index: number): Promise<any | null>
lset(key: string, index: number, value: any): Promise<void>
litems(key: string): Promise<Array<{ itemId: string; value: any; conflictLoser?: { winnerId: string } }>>
lmeta(key: string): Promise<{ order: string[]; createdAt: number | null; updatedAt: number | null } | null>
```

### Sync
```ts
sync(reason?: string): Promise<{ success: boolean; error?: string }>
```

### Events
```ts
on('sync:start', handler: (payload: SyncEventPayload) => void): Unsubscribe
on('sync:finish', handler: (payload: SyncEventPayload) => void): Unsubscribe
on('sync:error', handler: (payload: SyncEventPayload) => void): Unsubscribe
```

### Configuration
```ts
setConfig(config: Partial<GitStorageConfig>): Promise<void>
```

## Configuration options
```ts
interface GitStorageConfig {
  repoUrl?: string
  branch?: string
  username?: string
  token?: string
  dataDir?: string // default: process.cwd()/storage/.git-storage
  autoSync?: boolean
  syncOnChange?: boolean
  syncIntervalMinutes?: number
  history?: {
    enabled?: boolean
    writeCountThreshold?: number
    writeBytesThreshold?: number
  }
  logger?: (message: string, data?: unknown) => void
}
```

## Data model
Each key maps to a record stored in a bucket file:
```
{
  id: string,
  key: string,
  type: 'string'|'number'|'binary'|'object'|'array'|'list',
  createdAt: number,
  updatedAt: number,
  deletedAt?: number|null,
  conflictLoser?: { winnerId: string },
  value: any // binary values are base64 strings
}
```

### List data layout
- List meta record key: `list:<key>`
- List item record key: `list:<key>:item:<itemId>`
- List meta value: `{ order: string[] }`

## Merge rules
- Last-write-wins by `updatedAt`
- If `updatedAt` ties, compare `id` lexicographically
- `deletedAt` is a tombstone; deleted records are preserved for conflict resolution
- List item conflicts keep the winner and insert the loser after it
- Delete vs update conflicts keep the update even if delete has a newer timestamp

## Storage layout
- Data is sharded into 256 bucket files: `data/00.json` ~ `data/ff.json`
- Repo root is `dataDir`, containing `.git` and `data/`

## History compaction
- Auto compaction triggers when write count or write size crosses thresholds
- Compaction deletes the local `.git`, re-initializes a single commit, and force-pushes

## Notes
- Sync uses force push to keep history minimal
- Auto compaction is destructive to git history by design

## Status
Core storage and sync logic implemented. Tests and advanced safety controls are pending.
