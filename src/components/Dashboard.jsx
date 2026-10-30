// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAll } from '../lib/api'
import { dedupeTransactions, setCategoryAliases } from '../lib/budget'
import { demoData } from '../lib/demoData'
import DwApp from './DwApp'
import { refreshPlaid } from '../lib/plaidClient.js'
import { createReload } from '../lib/live-refresh.js'

function loadCachedData(cacheKey) {
  try {
    return JSON.parse(localStorage.getItem(cacheKey) || 'null')
  } catch {
    return null
  }
}

export default function Dashboard({ session, demo = false }) {
  const cacheKey = `budget.cache:${session?.user?.id || 'demo'}`
  const [data, setData] = useState(() => {
    if (!demo) return loadCachedData(cacheKey)
    const d = demoData()
    const cleaned = dedupeTransactions(d.transactions)
    return { ...d, transactions: cleaned }
  })
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)

  const bankAttempt = useRef(0)
  const bankChecked = useRef(null)
  const bankFailure = useRef('')
  const read = useCallback(async ({bank=false,force=false}={}) => {
    setSyncing(true)
    if (!demo && bank && (force || Date.now()-bankAttempt.current >= 300000)) {
      bankAttempt.current=Date.now()
      try {
        const result=await refreshPlaid()
        if (result.ok) { bankChecked.current=new Date().toISOString(); bankFailure.current='' }
        else bankFailure.current='Some bank connections could not refresh. These figures may use older balances. Check Settings.'
      } catch (err) { bankFailure.current=`Bank refresh failed. Saved balances may be out of date. ${err.message}` }
    }
    const raw=await fetchAll()
    return {...raw,transactions:dedupeTransactions(raw.transactions),fetchedAt:new Date().toISOString(),bankCheckedAt:bankChecked.current,bankRefreshError:bankFailure.current}
  },[demo,cacheKey])
  const refreshRecords = useMemo(()=>createReload(read, d=>{
    setCategoryAliases(Object.fromEntries((d.categoryAliases || []).map(a=>[a.from_name,a.to_name])))
    setData(d);setError(null);setSyncing(false)
    if (!demo) try {localStorage.setItem(cacheKey,JSON.stringify(d))}catch{/* Keep in-memory data when storage is unavailable. */}
  },err=>{setError(err.message || 'Budget refresh failed');setSyncing(false)}),[read,demo,cacheKey])
  const load = useCallback((options)=> options?.bank !== undefined ? refreshRecords(options) : refreshRecords.afterCurrent(options),[refreshRecords])
  useEffect(() => {
    refreshRecords.open()
    bankAttempt.current=0; bankChecked.current=null;bankFailure.current=''
    load({bank:true})
    const refresh=()=>{if(!document.hidden)load({bank:true})}
    window.addEventListener('focus',refresh)
    window.addEventListener('online',refresh)
    window.addEventListener('pageshow',refresh)
    document.addEventListener('visibilitychange',refresh)
    const timer=setInterval(refresh,30000)
    return()=>{
      refreshRecords.close()
      clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh)
      window.removeEventListener('pageshow',refresh);document.removeEventListener('visibilitychange',refresh)
    }
  },[load,refreshRecords])

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

  return <DwApp key={session?.user?.id || 'demo'} data={data} setData={setData} load={load} session={session} demo={demo} syncing={syncing} refreshError={error || data.bankRefreshError} />
}
