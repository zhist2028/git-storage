import assert from 'assert'
import { GitStorage } from '../src'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

async function run() {
  // const repoUrl = requireEnv('GIT_STORAGE_REPO_URL')
  // const username = requireEnv('GIT_STORAGE_USERNAME')
  // const token = requireEnv('GIT_STORAGE_TOKEN')
  const repoUrl = 'https://gitee.com/hezitation/git-storage-database.git'
  const username = 'hezitation'
  const token = 'bfc219db3b6dd85d043724a0d2e97559'

  const store = new GitStorage({
    repoUrl,
    username,
    token,
    branch: 'main',
    // dataDir: 'D:/Projects/ztimer/2622/git-storage/.tmp-test',
    autoSync: false,
    syncOnChange: false,
    syncIntervalMinutes: 0
  })

  await store.set('user:1', { name: 'Alice', age: 20 })
  await store.set('count', 42)
  await store.set('text', 'hello')
  await store.set('bin', Buffer.from('abc'))

  assert.deepStrictEqual(await store.get('user:1'), { name: 'Alice', age: 20 })
  assert.strictEqual(await store.get('count'), 42)
  assert.strictEqual(await store.get('text'), 'hello')
  const binValue = await store.get('bin')
  assert.ok(binValue instanceof Uint8Array)
  assert.strictEqual(Buffer.from(binValue).toString('utf8'), 'abc')

  const values = await store.mget(['user:1', 'missing', 'count'])
  assert.deepStrictEqual(values[0], { name: 'Alice', age: 20 })
  assert.strictEqual(values[1], null)
  assert.strictEqual(values[2], 42)

  const keys = await store.keys('user:*')
  assert.deepStrictEqual(keys, ['user:1'])

  const scan1 = await store.scan(0, '*', 2)
  assert.ok(scan1.keys.length > 0)

  await store.del('count')
  assert.strictEqual(await store.get('count'), null)

  const syncResult = await store.sync('test')
  assert.strictEqual(syncResult.success, true)

  console.log('git-storage basic test passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
