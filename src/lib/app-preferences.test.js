// @ts-nocheck
import test from 'node:test'
import assert from 'node:assert/strict'
import { PreferenceStore, flattenPreferences, applyPreferences, loadPreferenceCache, cleanPreferences } from './app-preferences.js'
const pause = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
function server(initial = null) {
  let row = initial
  return {
    read: async () => structuredClone(row),
    write: async (patch, initialize) => {
      if (initialize && row) return structuredClone(row)
      row = { preferences: { ...(row?.preferences || {}), ...patch }, revision: Number(row?.revision || 0) + 1 }
      return structuredClone(row)
    },
  }
}
function store(t, options) { const s = new PreferenceStore(options); t.after(() => s.close()); return s }

test('only explicit preference keys can be sent; monetary records are excluded', () => {
  assert.deepEqual(cleanPreferences({ balance: 9000, buffer_floor: 0, paidBills: {}, fs: 'l', 'plan:wants': 23, 'planOff:g-trip': true }), { fs: 'l', 'plan:wants': 23, 'planOff:g-trip': true })
  assert.equal(flattenPreferences({ meta: { bank: {} }, paidBills: { bill: true }, spreadBills: false }).spreadBills, false)
  assert.equal(applyPreferences({}, { 'rejectedIdeas:__proto__': true }).rejectedIdeas.__proto__, Object.prototype)
})
test('saved account choices replace stale device choices and preserve local-only state', async (t) => {
  const backend = server({ preferences: { fs: 'l', 'plan:wants': 12 }, revision: 4 })
  const s = store(t, { ...backend, initial: { fs: 's', plan: { wants: 30 }, meta: { a: { category: 'Other' } } } })
  await s.refresh()
  assert.equal(s.state.fs, 'l'); assert.equal(s.state.plan.wants, 12)
  assert.equal(s.state.meta.a.category, 'Other')
})
test('simultaneous first imports keep the first device plan', async (t) => {
  const backend = server()
  const a = store(t, { ...backend, initial: { fs: 'l' } }), b = store(t, { ...backend, initial: { fs: 's' } })
  await Promise.all([a.refresh(), b.refresh()])
  assert.equal(a.state.fs, 'l'); assert.equal(b.state.fs, 'l')
})
test('different devices merge individual choices without replacing other switches', async (t) => {
  const backend = server({ preferences: {}, revision: 1 })
  const a = store(t, backend), b = store(t, backend)
  await Promise.all([a.refresh(), b.refresh()])
  a.update((s) => ({ ...s, planOff: { 'g-trip': true } }))
  b.update((s) => ({ ...s, spreadBills: false }))
  await Promise.all([a.flush(), b.flush()]); await a.refresh(); await b.refresh()
  assert.equal(a.state.planOff['g-trip'], true); assert.equal(a.state.spreadBills, false)
  assert.equal(b.state.planOff['g-trip'], true); assert.equal(b.state.spreadBills, false)
})
test('an edit made during a slow save remains pending and wins over its older response', async (t) => {
  const backend = server({ preferences: {}, revision: 1 }), gate = pause()
  let waiting = true
  const s = store(t, { ...backend, write: async (...args) => { if (waiting) await gate.promise; return backend.write(...args) } })
  await s.refresh(); s.update((v) => ({ ...v, fs: 'l' }))
  const saving = s.flush()
  s.update((v) => ({ ...v, fs: 'xl' }))
  waiting = false; gate.resolve(); await saving
  assert.equal(s.state.fs, 'xl'); assert.equal(s.pending.fs, 'xl')
  await s.flush()
  assert.equal((await backend.read()).preferences.fs, 'xl'); assert.deepEqual(s.pending, {})
})
test('failed saves retain pending changes, show failure, and survive reopening', async (t) => {
  const backend = server({ preferences: {}, revision: 1 })
  let cache, status, offline = true
  const options = { ...backend, write: (...args) => offline ? Promise.reject(new Error('Offline')) : backend.write(...args), persist: (value) => { cache = structuredClone(value) }, status: (value) => { status = value } }
  const s = store(t, options)
  await s.refresh(); s.update((v) => ({ ...v, fs: 'xl' })); await s.flush()
  assert.equal(status.kind, 'error'); assert.equal(cache.pending.fs, 'xl')
  offline = false
  const reopened = store(t, { ...options, initial: cache.state, pending: cache.pending })
  await reopened.retry()
  assert.equal((await backend.read()).preferences.fs, 'xl')
  assert.equal(status.kind, 'saved')
})
test('a failed initial read never uploads defaults over an existing account plan', async (t) => {
  const backend = server({ preferences: { fs: 'l' }, revision: 9 }); let offline = true, writes = 0
  const s = store(t, { read: () => offline ? Promise.reject(new Error('Offline')) : backend.read(), write: (...args) => { writes++; return backend.write(...args) }, initial: { fs: 's' } })
  await s.refresh(); await s.flush(); assert.equal(writes, 0)
  offline = false; await s.retry(); assert.equal(s.state.fs, 'l'); assert.equal(writes, 0)
})
test('an explicit reset removes a switch without leaving a stale device value', async (t) => {
  const backend = server({ preferences: { 'planOff:g-trip': true }, revision: 1 })
  const s = store(t, backend); await s.refresh()
  s.update((v) => ({ ...v, planOff: {} })); await s.flush()
  assert.deepEqual(s.state.planOff, {})
  assert.equal((await backend.read()).preferences['planOff:g-trip'], null)
})
test('legacy browser preferences are claimed by only one account', () => {
  const map = new Map([['mm.dw.v1', JSON.stringify({ fs: 'xl' })]])
  const storage = { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v) }
  assert.equal(loadPreferenceCache(storage, 'first').state.fs, 'xl')
  assert.deepEqual(loadPreferenceCache(storage, 'second').state, {})
})


test('unchanged background refreshes preserve the current component state', async (t) => {
  const backend = server({ preferences: { fs: 'm' }, revision: 1 })
  let renders = 0
  const s = store(t, { ...backend, change: () => renders++ })
  await s.refresh()
  const afterStart = renders
  const state = s.state
  await s.refresh()
  assert.equal(s.state, state)
  assert.equal(renders, afterStart)
})
