import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ensureSchema } from '../lib/db.mjs'

test('a failed schema setup is retried on the next request, and a good one runs once', async () => {
  let calls = 0
  const db = { executeMultiple: async () => { if (++calls === 1) throw new Error('HTTP status 502') } }
  await assert.rejects(ensureSchema(db), /502/)
  await ensureSchema(db)
  await ensureSchema(db)
  assert.equal(calls, 2)
})
