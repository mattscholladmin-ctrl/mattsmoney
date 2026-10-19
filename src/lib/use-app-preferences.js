// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { PreferenceStore, PREFERENCE_DEFAULTS, loadPreferenceCache } from './app-preferences.js'
import { fetchAppPreferences, patchAppPreferences } from './preferences-api.js'

export function useAppPreferences(userId = 'demo') {
  const [syncStatus, setSyncStatus] = useState({ kind: 'loading', error: '' })
  const [state, setState] = useState(null)
  const storeRef = useRef(null)
  if (!storeRef.current) {
    let storage
    try { storage = window.localStorage } catch { storage = { getItem: () => null, setItem: () => {} } }
    const cache = loadPreferenceCache(storage, userId)
    storeRef.current = new PreferenceStore({
      initial: { ...structuredClone(PREFERENCE_DEFAULTS), theme: 'dark', meta: {}, budgets: {}, ...cache.state },
      pending: cache.pending,
      read: () => fetchAppPreferences(userId),
      write: (patch, initialize) => patchAppPreferences(userId, patch, initialize),
      persist: (value) => { try { storage.setItem(cache.key, JSON.stringify(value)) } catch { /* Server saving still works if storage is unavailable. */ } },
      change: setState, status: (next) => setSyncStatus((prev) => prev.kind === next.kind && prev.error === next.error ? prev : next),
    })
  }
  const store = storeRef.current
  useEffect(() => {
    store.closed = false
    store.refresh()
    const refresh = () => { if (!document.hidden) store.retry() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, 30000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
      store.close()
    }
  }, [store])
  return [state || store.state, store.update, syncStatus, store.retry]
}
