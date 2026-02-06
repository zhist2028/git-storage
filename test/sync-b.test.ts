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
  const updateDelayMs = Number(process.env.GIT_STORAGE_UPDATE_DELAY_MS ?? '0')
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

  console.log('[B] machineId:', machineId)
  console.log('[B] actorIdOverride:', actorIdOverride ?? '(none)')
  console.log('[B] session:', session)
  console.log('[B] branch:', branch)
  console.log('[B] dataDir:', dataDir ?? '(default)')
  console.log('[B] syncAt:', syncAt ?? '(none)')
  console.log('[B] expectConflict:', expectConflict)
  console.log('[B] testSameValue:', testSameValue)
  console.log('[B] testDeleteUpdate:', testDeleteUpdate)
  console.log('[B] updateDelayMs:', updateDelayMs)

  const pull1 = await store.sync('pull')
  console.log('[B] initial sync:', pull1)
  const hasBase = await store.has(baseKey)
  if (!hasBase) {
    const keys = await store.keys(`sync:${session}:*`)
    console.log('[B] available keys:', keys)
    const baseMeta = await store.meta(baseKey)
    console.log('[B] base meta:', baseMeta)
    throw new Error('[B] base not initialized. Run sync-a first.')
  }

  const pull2 = await store.sync('pull')
  console.log('[B] second sync:', pull2)
  const beforeItems = await store.litems(listKey)
  console.log('[B] before items:', beforeItems.map((item) => item.value))

  await waitUntil(syncAt)

  const updateAt = Date.now()
  await store.lset(listKey, 0, { title: 'update', by: 'B', at: updateAt })
  const syncResult = await store.sync('push')
  assert.strictEqual(syncResult.success, true)

  await store.sync('pull')
  const items = await store.litems(listKey)
  console.log('[B] updateAt:', updateAt)
  console.log('[B] list size after merge:', items.length)
  console.log('[B] list items:', items.map((item) => ({ value: item.value, conflict: item.conflictLoser })))

  if (expectConflict) {
    assert.ok(items.length > 1, '[B] expected conflict but only 1 item')
  }

  if (testSameValue) {
    const sameKey = `sync:${session}:samevalue`
    await store.sync('pull')
    const hasSameBase = await store.has(`${sameKey}:base`)
    if (!hasSameBase) {
      throw new Error('[B] same-value base not initialized. Run sync-a first.')
    }
    await store.sync('pull')
    await waitUntil(syncAt)
    await store.lset(sameKey, 0, { title: 'same', value: 1 })
    await store.sync('push-samevalue')
    await store.sync('pull')
    const sameItems = await store.litems(sameKey)
    console.log('[B] same-value items:', sameItems.map((item) => ({ value: item.value, conflict: item.conflictLoser })))
    assert.strictEqual(sameItems.length, 1, '[B] same-value should not create conflict item')
  }

  if (testDeleteUpdate) {
    const delKey = `sync:${session}:delete`
    await store.sync('pull')
    const hasDelBase = await store.has(`${delKey}:base`)
    if (!hasDelBase) {
      throw new Error('[B] delete-update base not initialized. Run sync-a first.')
    }
    await store.sync('pull')
    await waitUntil(syncAt)
    if (Number.isFinite(updateDelayMs) && updateDelayMs > 0) {
      await sleep(updateDelayMs)
    }
    await store.lset(delKey, 0, { title: 'delete', value: 2 })
    await store.sync('push-delete')
    await store.sync('pull')
    const delItems = await store.litems(delKey)
    console.log('[B] delete-update items:', delItems.map((item) => ({ value: item.value, conflict: item.conflictLoser })))
    assert.ok(delItems.length >= 1, '[B] delete-update should retain conflict loser item')
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
