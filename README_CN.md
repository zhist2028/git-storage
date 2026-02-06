# git-storage（中文）

基于 Git 的数据存储与同步库（Node.js）。提供类似 Redis 的 API，数据落盘为 Git 仓库，并支持自动同步与历史压缩。

## 特性
- Key 访问：支持 string / number / binary / object / array
- 列表操作：lpush / rpush / lpop / rpop / llen / lrange / lindex / lset
- 记录级合并：LWW（按 updatedAt，id 作为 tie-break）
- 列表冲突合并：败者插入胜者之后并打冲突标记
- 256 桶分片，减少冲突
- 自动同步（变更触发）+ 手动同步 + 可选定时同步
- 自动历史压缩（按写入次数/大小阈值）
- keys / scan / list 遍历
- 同步状态事件

## 安装
```bash
npm install git-storage
```

## 快速开始
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

await store.lpush('todos', { title: '买牛奶' })
await store.rpush('todos', { title: '发货' })
const todoItems = await store.lrange('todos', 0, -1)

store.on('sync:start', (info) => console.log('sync start', info))
store.on('sync:finish', (info) => console.log('sync finish', info))
store.on('sync:error', (info) => console.log('sync error', info))
```

## 接口使用
### 基础 KV
```ts
await store.set('profile:1', { name: 'Alice', age: 20 })
const profile = await store.get('profile:1')
const exists = await store.has('profile:1')
await store.del('profile:1')
```

### 批量与遍历
```ts
await store.mset({ 'a:1': 1, 'a:2': 2 })
const values = await store.mget(['a:1', 'a:2', 'a:3'])
const keys = await store.keys('a:*')
const page = await store.scan(0, 'a:*', 2)
```

### 列表
```ts
await store.lpush('tasks', { title: 'draft' })
await store.rpush('tasks', { title: 'ship' })
const first = await store.lindex('tasks', 0)
const all = await store.lrange('tasks', 0, -1)
await store.lset('tasks', 0, { title: 'draft v2' })
const popped = await store.lpop('tasks')
```

### 列表调试
```ts
const items = await store.litems('tasks')
const meta = await store.lmeta('tasks')
```

### 同步控制
```ts
const result = await store.sync('manual')
if (!result.success) console.error(result.error)
```

## API 参考

### 构造
```ts
new GitStorage(config: GitStorageConfig)
```

### 基础操作
```ts
get(key: string): Promise<any | null>
set(key: string, value: any): Promise<void>
has(key: string): Promise<boolean>
del(key: string): Promise<void>
```

### 批量操作
```ts
mget(keys: string[]): Promise<Array<any | null>>
mset(values: Record<string, any>): Promise<void>
```

### 元数据
```ts
type(key: string): Promise<ValueType | null>
meta(key: string): Promise<RecordEntry | null>
```

### 遍历与分页
```ts
keys(pattern?: string): Promise<string[]>
scan(cursor?: number, pattern?: string, count?: number): Promise<{ cursor: number; keys: string[] }>
list(prefix?: string, limit?: number, offset?: number): Promise<string[]>
```

### 列表操作
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

### 同步
```ts
sync(reason?: string): Promise<{ success: boolean; error?: string }>
```

### 事件
```ts
on('sync:start', handler: (payload: SyncEventPayload) => void): Unsubscribe
on('sync:finish', handler: (payload: SyncEventPayload) => void): Unsubscribe
on('sync:error', handler: (payload: SyncEventPayload) => void): Unsubscribe
```

### 配置更新
```ts
setConfig(config: Partial<GitStorageConfig>): Promise<void>
```

## 配置项
```ts
interface GitStorageConfig {
  repoUrl?: string
  branch?: string
  username?: string
  token?: string
  dataDir?: string // 默认: process.cwd()/storage/.git-storage
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

## 数据模型
每个 key 对应一条记录，存放在桶文件内：
```
{
  id: string,
  key: string,
  type: 'string'|'number'|'binary'|'object'|'array'|'list',
  createdAt: number,
  updatedAt: number,
  deletedAt?: number|null,
  conflictLoser?: { winnerId: string },
  value: any // binary 保存为 base64 字符串
}
```

### 列表存储结构
- 列表元数据 key：`list:<key>`
- 列表项 key：`list:<key>:item:<itemId>`
- 列表元数据 value：`{ order: string[] }`

## 合并规则
- 以 updatedAt 为准（LWW）
- updatedAt 相同则按 id 字典序
- deletedAt 为 tombstone（删除标记），用于冲突合并
- 列表冲突保留胜者，败者插入胜者之后并标记冲突
- 删除与更新冲突：保留更新（即便删除时间更大）

## 存储结构
- 数据分成 256 个桶：`data/00.json` ~ `data/ff.json`
- 仓库根目录为 `dataDir`，包含 `.git` 和 `data/`

## 历史压缩
- 当写入次数或写入大小超过阈值时触发
- 压缩过程会删除本地 `.git` 并重新初始化，再 force push

## 备注
- 同步默认 force push（为减少历史）
- 历史压缩是破坏性操作（按设计）

## 状态
核心存储与同步逻辑已实现，测试覆盖仍可扩展。
