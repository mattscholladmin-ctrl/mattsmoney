// @ts-nocheck
import { useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { deleteTransaction, addBalanceEntry, incrementGoalCurrent } from '../lib/api'
import { cashReversal, cleanCategory } from '../lib/budget'
import { QuickAddModal } from './QuickAddFab'

export default function TransactionsCard({ transactions, categories, goals = [], income = [], accounts = [], balances = [], onOpenAll, onChanged }) {
  // Delete a transaction; if it was paid from a cash account, put the money back.
  async function removeTxn(t) {
    const rev = cashReversal(t, accounts, balances)
    if (rev) {
      const back = rev.amount >= 0 ? 'added back to' : 'taken back out of'
      if (!window.confirm(`Delete this? ${money(Math.abs(rev.amount))} will be ${back} ${rev.account.name}.`)) return
    }
    await deleteTransaction(t.id)
    if (rev) {
      await addBalanceEntry({
        account_id: rev.account.id,
        balance: rev.restoreTo,
        as_of: isoDate(),
        note: `Reversed: ${t.merchant}`,
      })
    }
    // If this deposit filled a goal bucket, take it back out of the goal too —
    // otherwise the goal's saved amount stays permanently inflated.
    if (t.bucket_goal_id) await incrementGoalCurrent(t.bucket_goal_id, Number(t.amount || 0))
    onChanged()
  }
  const [open, setOpen] = useState(false)
  const recent = transactions.slice(0, 10)

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Recent spending</h2>
        <button
          onClick={() => setOpen(true)}
          className="text-sm bg-emerald-700 text-white font-medium rounded-lg px-3 py-1.5"
        >
          + Add
        </button>
      </div>

      {recent.length === 0 ? (
        <p className="text-sm text-slate-400">
          No transactions yet. Tap “+ Add” to log a purchase.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {recent.map((t) => (
            <li
              key={t.id}
              onClick={onOpenAll}
              className={`flex justify-between items-center py-2 ${onOpenAll ? 'cursor-pointer rounded-lg -mx-2 px-2 hover:bg-slate-100/60' : ''}`}
              title={onOpenAll ? 'Tap to open Transactions' : undefined}
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2">
                  <span className="min-w-0 text-sm text-slate-800 truncate">{t.merchant}</span>
                  {t.pending && (
                    <span className="shrink-0 text-[0.65rem] font-medium text-amber-700 bg-amber-100 rounded px-1.5 py-px">
                      pending
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {shortDate(t.txn_date)} · {cleanCategory(t, transactions)}
                  {t.pending ? ' · date not final yet' : ''}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-700">{money(t.amount)}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTxn(t)
                  }}
                  className="text-xs text-slate-300 hover:text-red-600"
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <QuickAddModal
          categories={categories}
          goals={goals}
          income={income}
          accounts={accounts}
          balances={balances}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}
