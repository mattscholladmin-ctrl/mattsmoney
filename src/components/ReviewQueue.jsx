// @ts-nocheck
import { useMemo, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import {
  needsCategory,
  suggestBillPayment,
  detectRecurring,
  pairTransfers,
  rejectKey,
} from '../lib/budget'
import { updateTransaction, addBill } from '../lib/api'

export default function ReviewQueue({
  transactions = [],
  bills = [],
  upcoming = [],
  accounts = [],
  onChanged,
}) {
  const today = isoDate()
  const [idx, setIdx] = useState(0)
  const [undo, setUndo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [hiddenSpot, setHiddenSpot] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('budget.hiddenSpotted') || '[]')
    } catch {
      return []
    }
  })

  const items = useMemo(() => {
    const out = []
    const pairs = pairTransfers(transactions, accounts)
    for (const p of pairs) {
      out.push({
        kind: 'transfer',
        id: `xfer-${p.outId}-${p.inId}`,
        title: p.label,
        detail: `${shortDate(p.date)} · pair as Transfer`,
        amount: p.amount,
        outId: p.outId,
        inId: p.inId,
      })
    }
    const rejected = (() => {
      try {
        return JSON.parse(localStorage.getItem('budget.rejectedBillMatches') || '[]')
      } catch {
        return []
      }
    })()
    for (const b of upcoming || []) {
      const overdue = b.overdue || (b.date < today && !b.preStart)
      if (!overdue) continue
      const t = suggestBillPayment(b, transactions, today, rejected)
      if (!t) continue
      out.push({
        kind: 'match',
        id: `match-${b.billId || b.id}-${t.id}`,
        title: `${b.name}`,
        detail: `Looks like ${t.merchant} ${money(t.amount)} on ${shortDate(t.txn_date)}`,
        amount: b.amount,
        billId: b.billId || b.id,
        txnId: t.id,
        occKey: `${b.billId || b.id}-${b.date}`,
      })
    }
    for (const t of transactions) {
      if (!needsCategory(t.category)) continue
      if (Number(t.amount || 0) <= 0) continue
      if (t.txn_date && t.txn_date < isoDate(new Date(Date.now() - 21 * 86400000))) continue
      out.push({
        kind: 'uncat',
        id: `uncat-${t.id}`,
        title: t.merchant || 'Charge',
        detail: `${shortDate(t.txn_date)} · pick a category later, or skip`,
        amount: t.amount,
        txnId: t.id,
      })
    }
    for (const s of detectRecurring(transactions, bills)) {
      if (hiddenSpot.includes(s.key)) continue
      out.push({
        kind: 'spot',
        id: `spot-${s.key}`,
        title: s.merchant,
        detail: `SPOTTED · ${s.cadence} · last ${shortDate(s.lastDate)}`,
        amount: s.amount,
        spot: s,
      })
    }
    return out.slice(0, 40)
  }, [transactions, bills, upcoming, accounts, hiddenSpot, today])

  if (!items.length) return null
  const item = items[Math.min(idx, items.length - 1)]
  if (!item) return null

  async function act(yes) {
    setBusy(true)
    const prev = item
    try {
      if (item.kind === 'transfer' && yes) {
        await updateTransaction(item.outId, { category: 'Transfer' })
        await updateTransaction(item.inId, { category: 'Transfer' })
      }
      if (item.kind === 'match' && yes && item.txnId && item.billId) {
        const row = transactions.find((t) => t.id === item.txnId)
        const note = String(row?.note || '')
        const tag = `paid:${item.billId}`
        if (!note.includes(tag)) await updateTransaction(item.txnId, { note: note ? `${note} ${tag}` : tag })
      }
      if (item.kind === 'match' && !yes && item.txnId && item.billId) {
        const key = rejectKey(item.billId, item.txnId)
        const list = JSON.parse(localStorage.getItem('budget.rejectedBillMatches') || '[]')
        if (key && !list.includes(key)) {
          localStorage.setItem('budget.rejectedBillMatches', JSON.stringify([...list, key]))
        }
        const row = transactions.find((t) => t.id === item.txnId)
        const note = String(row?.note || '')
        const tag = `reject:${item.billId}`
        if (!note.includes(tag)) await updateTransaction(item.txnId, { note: note ? `${note} ${tag}` : tag })
      }
      if (item.kind === 'spot' && yes) {
        await addBill({
          name: item.spot.merchant,
          amount: item.spot.amount,
          cadence: item.spot.cadence,
          due_day: item.spot.due_day,
          category: item.spot.category || 'Subscriptions',
          active: true,
        })
      }
      if (item.kind === 'spot' && !yes) {
        const next = [...hiddenSpot, item.spot.key]
        setHiddenSpot(next)
        localStorage.setItem('budget.hiddenSpotted', JSON.stringify(next))
      }
      if (item.kind === 'uncat' && !yes) {
        await updateTransaction(item.txnId, { category: 'Other' })
      }
      setUndo(prev)
      setIdx((n) => n + 1)
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Review</h2>
        <p className="text-xs text-slate-400">{Math.min(idx + 1, items.length)} of {items.length}</p>
      </div>
      <p className="text-sm font-medium text-slate-800">{item.title}</p>
      <p className="text-sm text-slate-500">{item.detail}</p>
      <p className="text-lg font-semibold text-slate-800">{money(item.amount)}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => act(true)}
          className="flex-1 bg-emerald-700 text-white font-semibold rounded-lg px-3 py-2.5 min-h-11 disabled:opacity-60"
        >
          {item.kind === 'match' ? 'Yes, paid' : item.kind === 'spot' ? 'Add bill' : item.kind === 'transfer' ? 'Mark transfer' : 'Keep'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act(false)}
          className="flex-1 border border-slate-300 text-slate-700 font-medium rounded-lg px-3 py-2.5 min-h-11 disabled:opacity-60"
        >
          {item.kind === 'match' ? 'No' : item.kind === 'spot' ? 'Dismiss' : 'Skip'}
        </button>
      </div>
      {undo && (
        <button type="button" onClick={() => { setUndo(null); setIdx((n) => Math.max(0, n - 1)) }} className="text-xs text-slate-500">
          Undo last
        </button>
      )}
      <p className="text-xs text-slate-400">Safe to spend does not wait on this list.</p>
    </section>
  )
}
