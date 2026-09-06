// @ts-nocheck
import { lazy, Suspense, useMemo, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { suggestBillPayment } from '../lib/budget'
import { addTransaction, updateTransaction } from '../lib/api'
import Modal from './Modal'

const RecurringBillsCard = lazy(() => import('./RecurringBillsCard'))

export default function UpcomingBillsCard({ upcoming = [], bills = [], transactions = [], ppy = 26, onChanged }) {
  const [manage, setManage] = useState(false)
  const [dismissed, setDismissed] = useState({})
  const total = upcoming.reduce((s, b) => s + b.amount, 0)
  const canManage = typeof onChanged === 'function'
  const today = isoDate()

  const suggested = useMemo(() => {
    const map = {}
    const used = new Set()
    for (const b of upcoming) {
      const overdue = b.overdue || (b.date < today && !b.preStart)
      if (!overdue) continue
      const t = suggestBillPayment(b, transactions, today)
      if (t && !used.has(t.id)) {
        map[`${b.billId || b.name}-${b.date}`] = t
        used.add(t.id)
      }
    }
    return map
  }, [upcoming, transactions, today])

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="font-semibold text-slate-800 min-w-0 truncate">Next 30 days of bills</h2>
        {canManage && (
          <button
            onClick={() => setManage(true)}
            className="shrink-0 text-sm text-emerald-700 font-medium"
          >
            Manage
          </button>
        )}
      </div>

      {upcoming.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing due in the next 30 days.</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {upcoming.map((b) => {
              const key = `${b.billId || b.name}-${b.date}`
              const overdue = !b.preStart && (b.overdue || b.date < today)
              const match = !dismissed[key] ? suggested[key] : null
              return (
              <li key={key} className="py-2 text-sm">
                <div className="flex justify-between gap-2">
                <span className="min-w-0 flex items-center text-slate-700">
                  <span className="shrink-0 text-slate-400 w-12 inline-block">
                    {shortDate(b.originalDate || b.date)}
                  </span>
                  <span className="min-w-0 truncate">{b.name}</span>
                  {b.preStart && (
                    <span className="ml-1.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-1.5 py-0.5">
                      Starts {shortDate(b.originalDate)}
                    </span>
                  )}
                </span>
                <span className="text-slate-700 shrink-0">{money(b.amount)}</span>
                </div>
                {overdue && (
                  <div className="mt-1.5 ml-12 text-xs">
                    {match ? (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2">
                        <p className="text-amber-800">
                          Looks like {match.merchant} {money(match.amount)} on {shortDate(match.txn_date)}.
                        </p>
                        {typeof onChanged === 'function' && (
                          <div className="mt-1.5 flex gap-2">
                            <button
                              type="button"
                              className="font-semibold text-white bg-emerald-700 rounded-full px-3 min-h-11"
                              onClick={async (e) => {
                                e.stopPropagation()
                                const name = String(match.merchant || '')
                                const tagged = name.toLowerCase().includes(String(b.name).toLowerCase())
                                  ? name
                                  : `${name} · ${b.name}`
                                await updateTransaction(match.id, { merchant: tagged })
                                onChanged()
                              }}
                            >
                              Yes, that’s it
                            </button>
                            <button
                              type="button"
                              className="font-medium text-slate-600 bg-white border border-slate-200 rounded-full px-3 min-h-11"
                              onClick={(e) => {
                                e.stopPropagation()
                                setDismissed((d) => ({ ...d, [key]: true }))
                              }}
                            >
                              No
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-amber-800">Still holding — no payment matched yet.</p>
                        {typeof onChanged === 'function' && (
                          <button
                            type="button"
                            className="shrink-0 font-semibold text-emerald-700 border border-emerald-200 rounded-full px-3 min-h-11"
                            onClick={async (e) => {
                              e.stopPropagation()
                              await addTransaction({ txn_date: isoDate(), merchant: b.name, amount: b.amount, category: 'Bills', note: 'Marked paid' })
                              onChanged()
                            }}
                          >
                            I paid this
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )})}
          </ul>
          <div className="flex justify-between pt-3 mt-1 border-t border-slate-200 font-semibold text-slate-800">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </>
      )}

      <p className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
        Includes your recurring bills and any arranged debt payments. Tap
        <strong className="text-slate-500"> Manage</strong> to add, edit, or remove a bill.
      </p>

      {manage && (
        <Modal title="Recurring bills" onClose={() => setManage(false)}>
          <Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
            <RecurringBillsCard
              bills={bills}
              transactions={transactions}
              ppy={ppy}
              onChanged={onChanged}
              embedded
            />
          </Suspense>
        </Modal>
      )}
    </section>
  )
}
