# git-storage（中文）

基于 Git 的数据存储与同步库（Node.js）。提供类似 Redis 的 API，数据落盘为 Git 仓库，并支持自动同步与历史压缩。

## 特性
- Key 访问：支持 string / number / binary / object / array
- 记录级合并：LWW（按 updatedAt，id 作为 tie-break）
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

store.on('sync:start', (info) => console.log('sync start', info))
store.on('sync:finish', (info) => console.log('sync finish', info))
store.on('sync:error', (info) => console.log('sync error', info))
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
  type: 'string'|'number'|'binary'|'object'|'array',
  createdAt: number,
  updatedAt: number,
  deletedAt?: number|null,
  value: any // binary 保存为 base64 字符串
}
```

## 合并规则
- 以 updatedAt 为准（LWW）
- updatedAt 相同则按 id 字典序
- deletedAt 为 tombstone（删除标记），用于冲突合并

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
