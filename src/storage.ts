import { promises as fsp } from 'fs'
import fs from 'fs'
import { dirname, join } from 'path'
import crypto from 'crypto'
import * as git from 'isomorphic-git'
import http from 'isomorphic-git/http/node'
import { hashKeyToBucket, patternToRegex, toBase64, fromBase64 } from './util'
import type { GitStorageConfig, HistoryConfig, RecordEntry, SyncStatus, ValueType } from './types'
import { StorageEvents } from './events'

const DEFAULT_HISTORY: HistoryConfig = {
  enabled: true,
  writeCountThreshold: 200,
  writeBytesThreshold: 5 * 1024 * 1024
}

function now() {
  return Date.now()
}

function inferType(value: unknown): ValueType {
  if (value === null || value === undefined) return 'string'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return 'binary'
  if (value instanceof ArrayBuffer) return 'binary'
  if (value && typeof value === 'object') {
    const maybeBuffer = value as { type?: unknown; data?: unknown }
    if (maybeBuffer.type === 'Buffer' && Array.isArray(maybeBuffer.data)) return 'binary'
  }
  if (Array.isArray(value)) return 'array'
  return 'object'
}

function serializeValue(type: ValueType, value: any): any {
  if (type === 'binary') return toBase64(value)
  return value
}

function deserializeValue(type: ValueType, value: any): any {
  if (type === 'binary' && typeof value === 'string') return fromBase64(value)
  return value
}

export class GitStorage {
  private config: Required<GitStorageConfig>
  private history: HistoryConfig
  private events = new StorageEvents()
  private status: SyncStatus = { state: 'idle', inFlight: false, lastAt: null, lastError: null }
  private writeCount = 0
  private writeBytes = 0
  private syncTimer: NodeJS.Timeout | null = null
  private syncIntervalTimer: NodeJS.Timeout | null = null

  constructor(config: GitStorageConfig) {
    const history = { ...DEFAULT_HISTORY, ...(config.history ?? {}) }
    this.config = {
      repoUrl: config.repoUrl ?? '',
      branch: config.branch ?? 'main',
      username: config.username ?? 'git',
      token: config.token ?? '',
      dataDir: config.dataDir ?? join(process.cwd(), 'storage', '.git-storage'),
      autoSync: config.autoSync ?? true,
      syncOnChange: config.syncOnChange ?? true,
      syncIntervalMinutes: config.syncIntervalMinutes ?? 0,
      history,
      logger: config.logger ?? (() => {})
    }
    this.history = history
    this.setupSyncInterval()
  }

  on = this.events.on.bind(this.events)

  getStatus(): SyncStatus {
    return { ...this.status }
  }

  async setConfig(next: GitStorageConfig) {
    if (next.repoUrl !== undefined) this.config.repoUrl = next.repoUrl
    if (next.branch !== undefined) this.config.branch = next.branch
    if (next.username !== undefined) this.config.username = next.username
    if (next.token !== undefined) this.config.token = next.token
    if (next.dataDir !== undefined) this.config.dataDir = next.dataDir
    if (next.autoSync !== undefined) this.config.autoSync = next.autoSync
    if (next.syncOnChange !== undefined) this.config.syncOnChange = next.syncOnChange
    if (next.syncIntervalMinutes !== undefined) this.config.syncIntervalMinutes = next.syncIntervalMinutes
    if (next.history !== undefined) {
      this.config.history = { ...this.config.history, ...next.history }
      this.history = { ...this.history, ...next.history }
    }
    this.setupSyncInterval()
  }

  private dataPath(bucket: string) {
    return join(this.config.dataDir, 'data', `${bucket}.json`)
  }

  private getAuth() {
    if (!this.config.token) return undefined
    return { username: this.config.username, password: this.config.token }
  }

  private getAuthHandler() {
    const auth = this.getAuth()
    if (!auth) return undefined
    return () => auth
  }

  private async ensureDir(path: string) {
    await fsp.mkdir(path, { recursive: true })
  }

  private async pathExists(path: string) {
    try {
      await fsp.access(path)
      return true
    } catch {
      return false
    }
  }

  private async readBucket(bucket: string): Promise<Record<string, RecordEntry>> {
    const filePath = this.dataPath(bucket)
    try {
      const raw = await fsp.readFile(filePath, 'utf8')
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  private async writeBucket(bucket: string, data: Record<string, RecordEntry>) {
    const filePath = this.dataPath(bucket)
    await this.ensureDir(dirname(filePath))
    const snapshot = JSON.stringify(data, null, 2)
    await fsp.writeFile(filePath, snapshot, 'utf8')
    this.writeCount += 1
    this.writeBytes += Buffer.byteLength(snapshot, 'utf8')
  }

  private makeId(): string {
    return crypto.randomUUID()
  }

  private scheduleSync(reason: string) {
    if (!this.config.autoSync || !this.config.syncOnChange) return
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      void this.sync(reason)
    }, 10000)
  }

  private setupSyncInterval() {
    if (this.syncIntervalTimer) {
      clearInterval(this.syncIntervalTimer)
      this.syncIntervalTimer = null
    }
    if (!this.config.autoSync || this.config.syncIntervalMinutes <= 0) return
    this.syncIntervalTimer = setInterval(() => {
      void this.sync('interval')
    }, this.config.syncIntervalMinutes * 60 * 1000)
  }

  async get(key: string): Promise<any | null> {
    const bucket = hashKeyToBucket(key)
    const data = await this.readBucket(bucket)
    const record = data[key]
    if (!record || record.deletedAt) return null
    return deserializeValue(record.type, record.value)
  }

  async has(key: string): Promise<boolean> {
    const bucket = hashKeyToBucket(key)
    const data = await this.readBucket(bucket)
    const record = data[key]
    return Boolean(record && !record.deletedAt)
  }

  async meta(key: string): Promise<RecordEntry | null> {
    const bucket = hashKeyToBucket(key)
    const data = await this.readBucket(bucket)
    return data[key] ?? null
  }

  async type(key: string): Promise<ValueType | null> {
    const record = await this.meta(key)
    if (!record || record.deletedAt) return null
    return record.type
  }

  async set(key: string, value: any): Promise<void> {
    const bucket = hashKeyToBucket(key)
    const data = await this.readBucket(bucket)
    const existing = data[key]
    const type = inferType(value)
    const record: RecordEntry = {
      id: existing?.id ?? this.makeId(),
      key,
      type,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
      deletedAt: null,
      value: serializeValue(type, value)
    }
    data[key] = record
    await this.writeBucket(bucket, data)
    this.scheduleSync('set')
  }

  async del(key: string): Promise<void> {
    const bucket = hashKeyToBucket(key)
    const data = await this.readBucket(bucket)
    const existing = data[key]
    const ts = now()
    const record: RecordEntry = {
      id: existing?.id ?? this.makeId(),
      key,
      type: existing?.type ?? 'string',
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      deletedAt: ts,
      value: existing?.value ?? null
    }
    data[key] = record
    await this.writeBucket(bucket, data)
    this.scheduleSync('del')
  }

  async mget(keys: string[]): Promise<Array<any | null>> {
    const result: Array<any | null> = []
    for (const key of keys) {
      result.push(await this.get(key))
    }
    return result
  }

  async mset(values: Record<string, any>): Promise<void> {
    const entries = Object.entries(values)
    for (const [key, value] of entries) {
      await this.set(key, value)
    }
  }

  private async listAllKeys(): Promise<string[]> {
    const dataRoot = join(this.config.dataDir, 'data')
    let buckets: string[] = []
    try {
      buckets = (await fsp.readdir(dataRoot)).filter((name) => name.endsWith('.json'))
    } catch {
      return []
    }

    const keys: string[] = []
    for (const bucketFile of buckets) {
      const bucket = bucketFile.replace('.json', '')
      const data = await this.readBucket(bucket)
      for (const [key, record] of Object.entries(data)) {
        if (!record.deletedAt) keys.push(key)
      }
    }
    return keys.sort()
  }

  async keys(pattern?: string): Promise<string[]> {
    const regex = patternToRegex(pattern)
    const all = await this.listAllKeys()
    return all.filter((key) => regex.test(key))
  }

  async scan(cursor = 0, pattern = '*', count = 100): Promise<{ cursor: number; keys: string[] }> {
    const regex = patternToRegex(pattern)
    const all = (await this.listAllKeys()).filter((key) => regex.test(key))
    const next = all.slice(cursor, cursor + count)
    const nextCursor = cursor + next.length
    return {
      cursor: nextCursor >= all.length ? 0 : nextCursor,
      keys: next
    }
  }

  async list(prefix = '', limit = 100, offset = 0): Promise<string[]> {
    const all = await this.listAllKeys()
    const filtered = prefix ? all.filter((key) => key.startsWith(prefix)) : all
    return filtered.slice(offset, offset + limit)
  }

  async sync(reason = 'manual'): Promise<{ success: boolean; error?: string }> {
    if (this.status.inFlight) {
      return { success: false, error: 'sync already in flight' }
    }

    this.status = { ...this.status, state: 'syncing', inFlight: true, lastError: null }
    this.events.emit('sync:start', { at: now(), reason, status: this.getStatus() })

    try {
      await this.syncWithGit(reason)
      this.status = { state: 'idle', inFlight: false, lastAt: now(), lastError: null }
      this.events.emit('sync:finish', { at: now(), reason, status: this.getStatus() })
      await this.maybeCompactHistory()
      return { success: true }
    } catch (error) {
      const message = String(error)
      this.status = { state: 'error', inFlight: false, lastAt: this.status.lastAt, lastError: message }
      this.events.emit('sync:error', { at: now(), reason, status: this.getStatus() })
      return { success: false, error: message }
    }
  }

  private async maybeCompactHistory() {
    if (!this.config.history.enabled) return
    if (this.writeCount < this.history.writeCountThreshold &&
        this.writeBytes < this.history.writeBytesThreshold) {
      return
    }

    await this.compactHistory()
    this.writeCount = 0
    this.writeBytes = 0
  }

  private async ensureRepoInitialized() {
    await this.ensureDir(this.config.dataDir)
    const gitDir = join(this.config.dataDir, '.git')
    const hasGitDir = await this.pathExists(gitDir)

    if (!hasGitDir) {
      await git.init({ fs, dir: this.config.dataDir, defaultBranch: this.config.branch })
    }

    if (this.config.repoUrl) {
      const remotes = await git.listRemotes({ fs, dir: this.config.dataDir })
      const hasOrigin = remotes.some((remote) => remote.remote === 'origin')
      if (!hasOrigin) {
        await git.addRemote({ fs, dir: this.config.dataDir, remote: 'origin', url: this.config.repoUrl })
      }
    }
  }

  private async ensureBranchCheckedOut() {
    const localBranches = await git.listBranches({ fs, dir: this.config.dataDir })
    if (localBranches.includes(this.config.branch)) {
      await git.checkout({ fs, dir: this.config.dataDir, ref: this.config.branch })
      return
    }

    const remotes = await git.listRemotes({ fs, dir: this.config.dataDir })
    const hasOrigin = remotes.some((remote) => remote.remote === 'origin')
    let remoteBranches: string[] = []
    if (hasOrigin) {
      try {
        remoteBranches = await git.listBranches({ fs, dir: this.config.dataDir, remote: 'origin' })
      } catch (error) {
        const message = String(error)
        if (!message.includes('NotFoundError')) {
          throw error
        }
      }
    }

    if (remoteBranches.includes(this.config.branch)) {
      await git.checkout({ fs, dir: this.config.dataDir, ref: this.config.branch, remote: 'origin' })
      return
    }

    await git.branch({ fs, dir: this.config.dataDir, ref: this.config.branch })
    await git.checkout({ fs, dir: this.config.dataDir, ref: this.config.branch })
  }

  private async listLocalBuckets(): Promise<string[]> {
    const dataRoot = join(this.config.dataDir, 'data')
    try {
      return (await fsp.readdir(dataRoot))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.replace('.json', ''))
    } catch {
      return []
    }
  }

  private async listRemoteBuckets(): Promise<string[]> {
    if (!this.config.repoUrl) return []
    try {
      const files = await git.listFiles({ fs, dir: this.config.dataDir, ref: this.config.branch })
      return files
        .filter((file) => file.startsWith('data/') && file.endsWith('.json'))
        .map((file) => file.replace('data/', '').replace('.json', ''))
    } catch {
      return []
    }
  }

  private async readRemoteBucket(bucket: string): Promise<Record<string, RecordEntry>> {
    if (!this.config.repoUrl) return {}
    try {
      const oid = await git.resolveRef({ fs, dir: this.config.dataDir, ref: this.config.branch })
      const result = await git.readBlob({
        fs,
        dir: this.config.dataDir,
        oid,
        filepath: join('data', `${bucket}.json`)
      })
      const text = new TextDecoder().decode(result.blob)
      return JSON.parse(text)
    } catch {
      return {}
    }
  }

  private mergeRecord(local?: RecordEntry, remote?: RecordEntry): RecordEntry | null {
    if (!local && !remote) return null
    if (!local) return remote ?? null
    if (!remote) return local

    const localUpdated = Number.isFinite(local.updatedAt) ? local.updatedAt : 0
    const remoteUpdated = Number.isFinite(remote.updatedAt) ? remote.updatedAt : 0

    if (localUpdated > remoteUpdated) return local
    if (remoteUpdated > localUpdated) return remote

    return local.id >= remote.id ? local : remote
  }

  private async mergeBuckets(buckets: string[]) {
    for (const bucket of buckets) {
      const local = await this.readBucket(bucket)
      const remote = await this.readRemoteBucket(bucket)
      const merged: Record<string, RecordEntry> = {}
      const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
      for (const key of keys) {
        const mergedEntry = this.mergeRecord(local[key], remote[key])
        if (mergedEntry) merged[key] = mergedEntry
      }
      await this.writeBucket(bucket, merged)
    }
  }

  private async stageAllChanges(): Promise<boolean> {
    const status = await git.statusMatrix({ fs, dir: this.config.dataDir })
    let hasChanges = false
    for (const [filepath, head, workdir, stage] of status) {
      if (head === workdir && workdir === stage) continue
      hasChanges = true
      if (head === 1 && workdir === 0) {
        await git.remove({ fs, dir: this.config.dataDir, filepath })
      } else {
        await git.add({ fs, dir: this.config.dataDir, filepath })
      }
    }
    return hasChanges
  }

  private async syncWithGit(reason: string) {
    try {
      await this.ensureRepoInitialized()
      await this.ensureBranchCheckedOut()

      if (this.config.repoUrl) {
        try {
          await git.fetch({
            fs,
            http,
            dir: this.config.dataDir,
            remote: 'origin',
            ref: this.config.branch,
            ...(this.getAuthHandler() ? { onAuth: this.getAuthHandler() } : {})
          })
        } catch (error) {
          const message = String(error)
          if (!message.includes('NotFoundError')) {
            throw error
          }
        }
      }

      const localBuckets = await this.listLocalBuckets()
      const remoteBuckets = await this.listRemoteBuckets()
      const buckets = Array.from(new Set([...localBuckets, ...remoteBuckets]))

      await this.mergeBuckets(buckets)

      await this.bootstrapCommitAndPush(reason)
    } catch (error) {
      const message = String(error)
      if (message.includes('NotFoundError') && message.includes('origin/')) {
        await this.bootstrapCommitAndPush(reason)
        return
      }
      throw error
    }
  }

  private async bootstrapCommitAndPush(reason: string) {
    const hasChanges = await this.stageAllChanges()
    if (hasChanges) {
      await git.commit({
        fs,
        dir: this.config.dataDir,
        message: `sync: ${reason}`,
        author: { name: 'git-storage', email: 'sync@git-storage.local' }
      })
    }

    if (this.config.repoUrl) {
      await git.push({
        fs,
        http,
        dir: this.config.dataDir,
        remote: 'origin',
        ref: this.config.branch,
        force: true,
        ...(this.getAuthHandler() ? { onAuth: this.getAuthHandler() } : {})
      })
    }
  }

  private async compactHistory() {
    if (!this.config.repoUrl) return
    const gitDir = join(this.config.dataDir, '.git')
    const hasGitDir = await this.pathExists(gitDir)
    if (hasGitDir) {
      await fsp.rm(gitDir, { recursive: true, force: true })
    }
    await git.init({ fs, dir: this.config.dataDir, defaultBranch: this.config.branch })
    await git.addRemote({ fs, dir: this.config.dataDir, remote: 'origin', url: this.config.repoUrl })
    await this.stageAllChanges()
    await git.commit({
      fs,
      dir: this.config.dataDir,
      message: 'compact history',
      author: { name: 'git-storage', email: 'sync@git-storage.local' }
    })
    await git.push({
      fs,
      http,
      dir: this.config.dataDir,
      remote: 'origin',
      ref: this.config.branch,
      force: true,
      ...(this.getAuthHandler() ? { onAuth: this.getAuthHandler() } : {})
    })
  }
}
