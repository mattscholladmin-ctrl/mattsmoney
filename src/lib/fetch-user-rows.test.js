// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchUserRows } from './fetch-user-rows.js'
function fake(pages, errorAt = -1) {
  const calls = []
  const db = { from: (table) => {
    const query = { table }
    const chain = { select: () => chain, eq: (column, value) => { query[column] = value; return chain }, order: () => chain, range: async (from, to) => { calls.push({ ...query, from, to }); return calls.length - 1 === errorAt ? { error: new Error('read failed') } : { data: pages[calls.length - 1] || [], error: null } } }
    return chain
  } }
  return { db, calls }
}
test('snapshot history includes every page and scopes every query to its owner', async () => {
  const f = fake([[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]])
  const result = await fetchUserRows(f.db, 'transactions', 'owner', 'txn_date', 2)
  assert.equal(result.data.length, 5)
  assert.deepEqual(f.calls.map((c) => [c.user_id, c.from, c.to]), [['owner', 0, 1], ['owner', 2, 3], ['owner', 4, 5]])
})
test('a later failed page cannot become a successful partial budget history', async () => {
  const f = fake([[{ id: 1 }, { id: 2 }]], 1)
  const result = await fetchUserRows(f.db, 'transactions', 'owner', 'txn_date', 2)
  assert.match(result.error.message, /read failed/)
  assert.deepEqual(result.data, [])
})
