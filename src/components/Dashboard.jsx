// @ts-nocheck
import { useCallback, useEffect, useState } from 'react'
import { fetchAll } from '../lib/api'
import { dedupeTransactions, setCategoryAliases } from '../lib/budget'
import { demoData } from '../lib/demoData'
import DwApp from './DwApp'

function loadCachedData() {
  try {
    return JSON.parse(localStorage.getItem('budget.cache') || 'null')
  } catch {
    return null
  }
}

export default function Dashboard({ session, demo = false }) {
  const [data, setData] = useState(() => {
    if (!demo) return loadCachedData()
    const d = demoData()
    const cleaned = dedupeTransactions(d.transactions)
    return { ...d, transactions: cleaned }
  })
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    const applyAliases = (arr) =>
      setCategoryAliases(Object.fromEntries((arr || []).map((a) => [a.from_name, a.to_name])))
    if (demo) {
      const d = await fetchAll()
      applyAliases(d.categoryAliases)
      const cleaned = dedupeTransactions(d.transactions)
      setData({ ...d, transactions: cleaned, fetchedAt: new Date().toISOString() })
      return
    }
    setSyncing(true)
    try {
      setError(null)
      const raw = await fetchAll()
      const cleaned = dedupeTransactions(raw.transactions)
      const d = { ...raw, transactions: cleaned, fetchedAt: new Date().toISOString() }
      applyAliases(raw.categoryAliases)
      setData(d)
      try {
        localStorage.setItem('budget.cache', JSON.stringify(d))
      } catch {
        /* ignore */
      }
    } catch (err) {
      let cached = null
      try {
        cached = JSON.parse(localStorage.getItem('budget.cache') || 'null')
      } catch {
        cached = null
      }
      if (cached) {
        applyAliases(cached.categoryAliases)
        setData(cached)
      } else setError(err.message)
    } finally {
      setSyncing(false)
    }
  }, [demo])

  useEffect(() => {
    load()
  }, [load])

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-500">{error}</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-500">Loading your budget…</p>
      </div>
    )
  }

  return <DwApp data={data} setData={setData} load={load} session={session} demo={demo} syncing={syncing} />
}
