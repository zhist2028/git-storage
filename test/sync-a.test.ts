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
  // const repoUrl = requireEnv('GIT_STORAGE_REPO_URL')
  // const username = requireEnv('GIT_STORAGE_USERNAME')
  // const token = requireEnv('GIT_STORAGE_TOKEN')
  // const session = requireEnv('GIT_STORAGE_SESSION')
    const repoUrl = 'https://gitee.com/hezitation/git-storage-database.git'
  const username = 'hezitation'
  const token = 'bfc219db3b6dd85d043724a0d2e97559'
  const session = 'sss'
  const branch = process.env.GIT_STORAGE_BRANCH ?? 'main'
  const dataDir = process.env.GIT_STORAGE_DATA_DIR
  const syncAt = process.env.GIT_STORAGE_SYNC_AT
  const expectConflict = (process.env.GIT_STORAGE_EXPECT_CONFLICT ?? '0') === '1'
  const testSameValue = (process.env.GIT_STORAGE_TEST_SAME_VALUE ?? '0') === '1'
  const testDeleteUpdate = (process.env.GIT_STORAGE_TEST_DELETE_UPDATE ?? '0') === '1'
  const deleteDelayMs = Number(process.env.GIT_STORAGE_DELETE_DELAY_MS ?? '50')
  const actorIdOverride = process.env.GIT_STORAGE_ACTOR_ID
  const machineId = machineIdSync(true)

  const store = new GitStorage({
    repoUrl,
    username,
    token,
    branch,
    ...(actorIdOverride ? { actorId: actorIdOverride } : {}),
    ...(dataDir ? { dataDir } : {}),
    autoSync: false,
    syncOnChange: false,
    syncIntervalMinutes: 0
  })

  const listKey = `sync:${session}:list`
  const baseKey = `sync:${session}:base`

  console.log('[A] machineId:', machineId)
  console.log('[A] actorIdOverride:', actorIdOverride ?? '(none)')
  console.log('[A] session:', session)
  console.log('[A] branch:', branch)
  console.log('[A] dataDir:', dataDir ?? '(default)')
  console.log('[A] syncAt:', syncAt ?? '(none)')
  console.log('[A] expectConflict:', expectConflict)
  console.log('[A] testSameValue:', testSameValue)
  console.log('[A] testDeleteUpdate:', testDeleteUpdate)
  console.log('[A] deleteDelayMs:', deleteDelayMs)

  const pull1 = await store.sync('pull')
  console.log('[A] initial sync:', pull1)
  const hasBase = await store.has(baseKey)
  if (!hasBase) {
    await store.lpush(listKey, { title: 'base', by: 'A' })
    await store.set(baseKey, 'ready')
    const initResult = await store.sync('init')
    assert.strictEqual(initResult.success, true)
    console.log('[A] base initialized and pushed')
  }

  const pull2 = await store.sync('pull')
  console.log('[A] second sync:', pull2)
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

  if (testSameValue) {
    const sameKey = `sync:${session}:samevalue`
    await store.sync('pull')
    const hasSameBase = await store.has(`${sameKey}:base`)
    if (!hasSameBase) {
      await store.lpush(sameKey, { title: 'same', value: 1 })
      await store.set(`${sameKey}:base`, 'ready')
      await store.sync('init-samevalue')
    }
    await store.sync('pull')
    await waitUntil(syncAt)
    await store.lset(sameKey, 0, { title: 'same', value: 1 })
    await store.sync('push-samevalue')
    await store.sync('pull')
    const sameItems = await store.litems(sameKey)
    console.log('[A] same-value items:', sameItems.map((item) => ({ value: item.value, conflict: item.conflictLoser })))
    assert.strictEqual(sameItems.length, 1, '[A] same-value should not create conflict item')
  }

  if (testDeleteUpdate) {
    const delKey = `sync:${session}:delete`
    await store.sync('pull')
    const hasDelBase = await store.has(`${delKey}:base`)
    if (!hasDelBase) {
      await store.lpush(delKey, { title: 'delete', value: 1 })
      await store.set(`${delKey}:base`, 'ready')
      await store.sync('init-delete')
    }
    await store.sync('pull')
    await waitUntil(syncAt)
    if (Number.isFinite(deleteDelayMs) && deleteDelayMs > 0) {
      await sleep(deleteDelayMs)
    }
    const deletedValue = await store.lpop(delKey)
    console.log('[A] delete-update deleted value:', deletedValue)
    await store.sync('push-delete')
    await store.sync('pull')
    const delItems = await store.litems(delKey)
    console.log('[A] delete-update items:', delItems.map((item) => ({ value: item.value, conflict: item.conflictLoser })))
    assert.ok(delItems.length >= 1, '[A] delete-update should retain conflict loser item')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
