// @ts-nocheck
// Only preference keys travel through this store. Financial records never do.
export const PREFERENCE_DEFAULTS = {
  plan: { needs: 50, wants: 30, savings: 20 }, planOff: {}, spreadBills: true,
  fs: 'm', rejectedIdeas: {}, dismissed: [],
}
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key)
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function validPreference(key, value) {
  if (typeof key !== 'string' || key.length > 240 || !/^(plan:(needs|wants|savings)|planOff:[gd]-.+|rejectedIdeas:.+|spreadBills|fs|extraId|dismissed)$/.test(key)) return false
  if (value === null) return true
  if (key.startsWith('plan:')) return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000000
  if (/^(planOff:|rejectedIdeas:)/.test(key) || key === 'spreadBills') return typeof value === 'boolean'
  if (key === 'fs') return ['s', 'm', 'l', 'xl'].includes(value)
  if (key === 'extraId') return typeof value === 'string' && value.length <= 200
  return Array.isArray(value) && value.length <= 500 && value.every((v) => typeof v === 'string')
}
export function cleanPreferences(value = {}) {
  return Object.fromEntries(Object.entries(value || {}).filter(([k, v]) => validPreference(k, v)))
}
export function flattenPreferences(state = {}) {
  const flat = {}
  for (const group of ['plan', 'planOff', 'rejectedIdeas']) {
    for (const [key, value] of Object.entries(state[group] || {})) flat[`${group}:${key}`] = value
  }
  for (const key of ['spreadBills', 'fs', 'extraId', 'dismissed']) if (own(state, key)) flat[key] = state[key]
  return cleanPreferences(flat)
}
export function applyPreferences(state, values) {
  const next = { ...state, ...structuredClone(PREFERENCE_DEFAULTS) }
  delete next.extraId
  for (const [key, value] of Object.entries(cleanPreferences(values))) {
    if (value === null) continue
    const sep = key.indexOf(':')
    if (sep > 0) {
      const group = key.slice(0, sep), id = key.slice(sep + 1)
      // Do not permit special object keys to mutate prototypes.
      if (['__proto__', 'constructor', 'prototype'].includes(id)) continue
      next[group][id] = value
    } else next[key] = value
  }
  return next
}
export function preferenceDiff(before, after) {
  const a = flattenPreferences(before), b = flattenPreferences(after), patch = {}
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!equal(a[key], b[key])) patch[key] = own(b, key) ? b[key] : null
  }
  return patch
}

export function loadPreferenceCache(storage, userId) {
  const key = `mm.dw.v2:${userId}`
  try {
    const cached = JSON.parse(storage.getItem(key) || 'null')
    if (cached?.state) return { state: cached.state, pending: cleanPreferences(cached.pending), key }
    // Claim the old browser preferences once; a second account cannot inherit them.
    const owner = storage.getItem('mm.dw.legacy.owner')
    if (!owner || owner === userId) {
      const legacy = JSON.parse(storage.getItem('mm.dw.v1') || 'null')
      if (legacy) {
        storage.setItem('mm.dw.legacy.owner', userId)
        return { state: legacy, pending: {}, key }
      }
    }
  } catch { /* A storage failure must not prevent account loading. */ }
  return { state: {}, pending: {}, key }
}

// Independent of React so delayed saves, failures and multi-device merges can
// be tested with deterministic fake servers instead of real money records.
export class PreferenceStore {
  constructor({ initial = {}, pending = {}, read, write, persist = () => {}, change = () => {}, status = () => {} }) {
    this.state = { theme: 'dark', meta: {}, budgets: {}, ...initial }
    this.pending = cleanPreferences(pending)
    this.read = read; this.write = write; this.persist = persist
    this.change = change; this.status = status
    this.revision = -1; this.ready = false; this.closed = false
  }
  report(kind, error = '') { if (!this.closed) this.status({ kind, error }) }
  emit() {
    this.persist({ state: this.state, pending: this.pending })
    if (!this.closed) this.change(this.state)
  }
  merge(remote) {
    const revision = Number(remote.revision || 0)
    if (revision < this.revision) return
    this.revision = revision
    const next = applyPreferences(this.state, { ...remote.preferences, ...this.pending })
    const before = flattenPreferences(this.state), after = flattenPreferences(next)
    const changed = new Set([...Object.keys(before), ...Object.keys(after)])
    if ([...changed].some((key) => !equal(before[key], after[key]))) {
      this.state = next
      this.emit()
    } else this.persist({ state: this.state, pending: this.pending })
  }
  update = (updater) => {
    const next = typeof updater === 'function' ? updater(this.state) : updater
    this.pending = { ...this.pending, ...preferenceDiff(this.state, next) }
    this.state = next
    this.emit()
    if (Object.keys(this.pending).length) { this.report('saving'); this.schedule() }
  }
  schedule() {
    clearTimeout(this.timer)
    if (!this.closed) this.timer = setTimeout(() => this.flush(), 450)
  }
  async refresh() {
    if (this.closed || this.refreshing || this.saving) return
    this.refreshing = true
    if (!this.ready) this.report('loading')
    try {
      let remote = await this.read()
      if (this.closed) return
      if (!remote) remote = await this.write(flattenPreferences(this.state), true)
      if (this.closed) return
      this.ready = true
      this.merge(remote)
      if (Object.keys(this.pending).length) this.schedule()
      else this.report('saved')
    } catch (err) { this.report('error', err.message || 'Could not sync preferences') }
    finally { this.refreshing = false }
  }
  async flush() {
    clearTimeout(this.timer)
    if (this.closed || this.saving) return
    if (!this.ready) { await this.refresh(); return }
    const sent = { ...this.pending }
    if (!Object.keys(sent).length) return
    this.saving = true; this.report('saving')
    try {
      const remote = await this.write(sent, false)
      for (const key of Object.keys(sent)) if (equal(this.pending[key], sent[key])) delete this.pending[key]
      this.merge(remote)
      if (Object.keys(this.pending).length) this.schedule()
      else this.report('saved')
    } catch (err) { this.report('error', err.message || 'Could not save preferences') }
    finally { this.saving = false }
  }
  retry = async () => { await this.refresh(); await this.flush() }
  close() { this.closed = true; clearTimeout(this.timer) }
}
