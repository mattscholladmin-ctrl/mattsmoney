// @ts-nocheck
import { useState } from 'react'
import { money } from '../lib/format'
import { upsertBudget, deleteBudget } from '../lib/api'
import Modal from './Modal'

export default function CategoryBudgets({ budgets, spendByCat, categories = [], onRenameCategory, onChanged, periodStartIso = null, ppy = 26 }) {
  const [open, setOpen] = useState(false)

  const rows = budgets.map((b) => ({
    ...b,
    // Case-insensitive match so a "food" budget lines up with "Food" spending.
    spent: spendByCat[(b.category || '').trim().toLowerCase()] || 0,
  }))
  const now = new Date()
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate()
  const windowLabel = periodStartIso ? 'this paycheck' : 'this month'

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">{periodStartIso ? 'This paycheck vs budget' : 'This month vs budget'}</h2>
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-emerald-700 font-medium"
        >
          Edit
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          No budgets yet. Add one (e.g. Groceries, Gas, Pet).
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const limit = periodStartIso
              ? ((Number(r.monthly_limit) || 0) * 12) / (ppy || 26)
              : Number(r.monthly_limit)
            const pct = limit > 0 ? Math.min((r.spent / limit) * 100, 100) : 0
            const pctUsed = limit > 0 ? Math.round((r.spent / limit) * 100) : 0
            const over = r.spent > limit
            const near = !over && limit > 0 && r.spent >= limit * 0.8
            return (
              <li key={r.id}>
                <div className="flex justify-between text-sm mb-1 gap-2 min-w-0">
                  <span className="text-slate-700 min-w-0 truncate">{r.category}</span>
                  <span
                    className={`shrink-0 ${over ? 'text-red-600 font-semibold' : near ? 'text-amber-700 font-medium' : 'text-slate-500'}`}
                  >
                    {money(r.spent)} / {money(limit)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ease-out ${over ? 'bg-red-500' : near ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {(over || near) && (
                  <p className={`text-xs mt-1 ${over ? 'text-red-600' : 'text-amber-700'}`}>
                    {over ? `Over by ${money(r.spent - limit)}` : `${pctUsed}% used`} · {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left {windowLabel}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {open && (
        <ManageBudgetsModal
          budgets={budgets}
          categories={categories}
          spendByCat={spendByCat}
          onRenameCategory={onRenameCategory}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}

function ManageBudgetsModal({ budgets, categories = [], spendByCat = {}, onRenameCategory, onClose, onChanged }) {
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Spending categories that don't have a budget yet — the whole point: budget the
  // categories your money actually goes to, matched by name so they line up.
  const budgetedLower = new Set(budgets.map((b) => (b.category || '').trim().toLowerCase()))
  const unbudgeted = categories.filter((c) => !budgetedLower.has(c.trim().toLowerCase()))

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await upsertBudget({
        category: category.trim(),
        monthly_limit: Number(limit),
      })
      setCategory('')
      setLimit('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    await deleteBudget(id)
    onChanged()
  }

  return (
    <Modal title="Monthly budgets" onClose={onClose}>
      <form onSubmit={add} className="space-y-3 text-slate-700">
        <div className="flex gap-2">
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category"
            list="budgetCatList"
            required
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <datalist id="budgetCatList">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="Limit"
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Add / update budget'}
        </button>
      </form>

      {unbudgeted.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-slate-500 mb-1.5">
            Categories from your spending with no budget yet — tap to budget one:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unbudgeted.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`text-xs rounded-full border px-2.5 py-1 ${
                  category === c
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                }`}
              >
                + {c}
                {spendByCat[c.trim().toLowerCase()] ? ` · ${money(spendByCat[c.trim().toLowerCase()])}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {budgets.length > 0 && (
        <>
          <p className="mt-4 text-xs text-slate-400">
            Rename a category or change its limit right here — tap away to save. To add
            a new one, pick a category above (it's your real spending categories, so the
            budget matches).
          </p>
          <ul className="mt-1 divide-y divide-slate-100">
            {budgets.map((b) => (
              <li key={b.id} className="flex justify-between items-center py-2 gap-2">
                <input
                  type="text"
                  defaultValue={b.category}
                  list="budgetCatList"
                  onBlur={async (e) => {
                    const name = e.target.value.trim()
                    if (name && name !== b.category && onRenameCategory) {
                      await onRenameCategory(b.category, name, b.id)
                    } else {
                      e.target.value = b.category
                    }
                  }}
                  className="text-sm text-slate-700 min-w-0 flex-1 rounded-lg border border-transparent hover:border-slate-300 focus:border-slate-400 px-2 py-1 outline-none"
                  aria-label={`Rename ${b.category} category`}
                />
                <span className="flex items-center gap-2 shrink-0">
                  <span className="flex items-center rounded-lg border border-slate-300 px-2 py-1 text-sm">
                    <span className="text-slate-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      defaultValue={b.monthly_limit}
                      onBlur={async (e) => {
                        const v = Number(e.target.value)
                        if (!Number.isNaN(v) && v !== Number(b.monthly_limit)) {
                          await upsertBudget({ category: b.category, monthly_limit: v })
                          onChanged()
                        }
                      }}
                      className="w-20 text-right outline-none"
                    />
                  </span>
                  <button onClick={() => remove(b.id)} className="text-xs text-red-600">
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
