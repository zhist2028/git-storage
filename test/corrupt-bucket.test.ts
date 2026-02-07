import assert from 'assert'
import { promises as fsp } from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { GitStorage } from '../src'

function hashKeyToBucket(key: string): string {
  const hash = crypto.createHash('sha1').update(key).digest('hex')
  return hash.slice(0, 2)
}

async function run() {
  const logs: Array<{ message: string; data?: unknown }> = []
  const dataDir = join(process.cwd(), 'storage', '.git-storage-test-corrupt')
  const store = new GitStorage({
    dataDir,
    autoSync: false,
    syncOnChange: false,
    syncIntervalMinutes: 0,
    logger: (message, data) => {
      logs.push({ message, data })
    }
  })

  const key = 'corrupt:test:key'
  const bucket = hashKeyToBucket(key)
  const bucketPath = join(dataDir, 'data', `${bucket}.json`)
  await fsp.mkdir(join(dataDir, 'data'), { recursive: true })
  await fsp.writeFile(bucketPath, '{ invalid json', 'utf8')

  const value = await store.get(key)
  assert.strictEqual(value, null)
  assert.ok(logs.some((entry) => entry.message === 'readBucket failed'), 'expected readBucket failed log')

  console.log('corrupt bucket test passed')
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
