# git-storage

Git-based storage and sync library (Node.js). Provides Redis-style APIs over a Git-backed data store with record-level merge, auto sync, and history compaction.

## Features
- Key-based access for string/number/binary/object/array
- Record-level merge (LWW by updatedAt, id tie-break)
- 256-bucket storage to reduce conflicts
- Auto sync on change + manual sync + optional interval sync
- Auto history compaction (by write count/size)
- Scan/keys/list operations
- Sync status events

## Installation
```bash
npm install git-storage
```

## Usage
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

store.on('sync:start', (info) => console.log('sync start', info))
store.on('sync:finish', (info) => console.log('sync finish', info))
store.on('sync:error', (info) => console.log('sync error', info))
```

## API overview
- `get(key)`, `set(key, value)`, `del(key)`, `has(key)`
- `mget(keys[])`, `mset({ [key]: value })`
- `keys(pattern?)`, `scan(cursor?, pattern?, count?)`, `list(prefix?, limit?, offset?)`
- `meta(key)`, `type(key)`
- `sync(reason?)`
- `on('sync:start'|'sync:finish'|'sync:error', handler)`

## Configuration
```ts
new GitStorage({
  repoUrl?: string,
  branch?: string,
  username?: string,
  token?: string,
  dataDir?: string, // defaults to process.cwd()/storage/.git-storage
  autoSync?: boolean,
  syncOnChange?: boolean,
  syncIntervalMinutes?: number,
  history?: {
    enabled?: boolean,
    writeCountThreshold?: number,
    writeBytesThreshold?: number
  }
})
```

## Data model
Each key maps to a record:
```
{
  id: string,
  key: string,
  type: 'string'|'number'|'binary'|'object'|'array',
  createdAt: number,
  updatedAt: number,
  deletedAt?: number|null,
  value: any // binary values are base64 strings
}
```

## Notes
- Sync uses force push to keep history minimal.
- Auto compaction deletes `.git` locally and re-initializes a single-commit history before force pushing.

## Status
Core storage and sync logic implemented. Tests and advanced safety controls are pending.
