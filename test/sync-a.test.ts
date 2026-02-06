import assert from 'assert'
import { machineIdSync } from 'node-machine-id'
import { GitStorage } from '../src'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitUntil(targetIso?: string) {
  if (!targetIso) return
  const target = new Date(targetIso).getTime()
  if (Number.isNaN(target)) {
    throw new Error(`Invalid ISO time in GIT_STORAGE_SYNC_AT: ${targetIso}`)
  }
  const now = Date.now()
  if (target > now) {
    await sleep(target - now)
  }
}

async function run() {
  const repoUrl = requireEnv('GIT_STORAGE_REPO_URL')
  const username = requireEnv('GIT_STORAGE_USERNAME')
  const token = requireEnv('GIT_STORAGE_TOKEN')
  const session = requireEnv('GIT_STORAGE_SESSION')
  const branch = process.env.GIT_STORAGE_BRANCH ?? 'main'
  const dataDir = process.env.GIT_STORAGE_DATA_DIR
  const syncAt = process.env.GIT_STORAGE_SYNC_AT
  const expectConflict = (process.env.GIT_STORAGE_EXPECT_CONFLICT ?? '0') === '1'
  const machineId = machineIdSync({ original: true })

  const store = new GitStorage({
    repoUrl,
    username,
    token,
    branch,
    ...(dataDir ? { dataDir } : {}),
    autoSync: false,
    syncOnChange: false,
    syncIntervalMinutes: 0
  })

  const listKey = `sync:${session}:list`
  const baseKey = `sync:${session}:base`

  console.log('[A] machineId:', machineId)
  console.log('[A] session:', session)
  console.log('[A] branch:', branch)
  console.log('[A] dataDir:', dataDir ?? '(default)')
  console.log('[A] syncAt:', syncAt ?? '(none)')
  console.log('[A] expectConflict:', expectConflict)

  await store.sync('pull')
  const hasBase = await store.has(baseKey)
  if (!hasBase) {
    await store.lpush(listKey, { title: 'base', by: 'A' })
    await store.set(baseKey, 'ready')
    const initResult = await store.sync('init')
    assert.strictEqual(initResult.success, true)
    console.log('[A] base initialized and pushed')
  }

  await store.sync('pull')
  const beforeItems = await store.litems(listKey)
  console.log('[A] before items:', beforeItems.map((item) => item.value))

  await waitUntil(syncAt)

  const updateAt = Date.now()
  await store.lset(listKey, 0, { title: 'update', by: 'A', at: updateAt })
  const syncResult = await store.sync('push')
  assert.strictEqual(syncResult.success, true)

  await store.sync('pull')
  const items = await store.litems(listKey)
  console.log('[A] updateAt:', updateAt)
  console.log('[A] list size after merge:', items.length)
  console.log('[A] list items:', items.map((item) => ({ value: item.value, conflict: item.conflictLoser })))

  if (expectConflict) {
    assert.ok(items.length > 1, '[A] expected conflict but only 1 item')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
