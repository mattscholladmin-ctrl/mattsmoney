// @ts-nocheck
import { useState } from 'react'
import { money, shortDate } from '../lib/format'
import { totalSetAside } from '../lib/budget'
import { addSetAside, removeSetAside } from '../lib/api'

// "Money set aside" — cash you already have but need to hold out of your
// "safe to spend" for a known near-term expense (a vet visit, registration).
// It's not a savings goal and not a debt: just a labeled hold. Each active hold
// lowers safe-to-spend by its amount until you tap Done.
export default function SetAsideCard({ setAsides = [], onChanged }) {
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const total = totalSetAside(setAsides)

  async function save() {
    if (!amount || Number(amount) <= 0 || !name.trim()) {
      setError('Add an amount and what it’s for.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addSetAside({ name: name.trim(), amount: Number(amount), due_date: date || null })
      setAmount('')
      setName('')
      setDate('')
      setAdding(false)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    setBusy(true)
    setError(null)
    try {
      await removeSetAside(id)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Held for known expenses</h2>
        {total > 0 && (
          <span className="text-sm font-medium text-slate-500">{money(total)} held</span>
        )}
      </div>
      <p className="text-sm text-slate-500">
        Cash you already have but need to keep for something specific — held out of
        your “safe to spend” until you clear it. Not a savings goal.
      </p>

      {setAsides.length === 0 ? (
        <p className="text-sm text-slate-400">Nothing held right now.</p>
      ) : (
        <ul className="space-y-2">
          {setAsides.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5"
            >
              <div>
                <div className="font-medium text-slate-800">🔒 {s.name}</div>
                <div className="text-xs text-slate-500">
                  {money(s.amount)} held{s.due_date ? ` · until ${shortDate(s.due_date)}` : ''}
                </div>
              </div>
              <button
                onClick={() => remove(s.id)}
                disabled={busy}
                className="text-sm text-slate-600 border border-slate-300 rounded-lg px-3 py-1.5 disabled:opacity-60"
                title="Spent it, or no longer need to hold it — frees it back into safe to spend"
              >
                Done
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">$</span>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What for? (e.g. Vet visit)"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <label className="block text-sm text-slate-600">
            Until (optional)
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={busy}
              className="bg-slate-800 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Hold it'}
            </button>
            <button
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
              className="text-slate-400 px-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <button
            onClick={() => setAdding(true)}
            className="text-sm font-medium text-emerald-700"
          >
            + Hold money for something
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </>
      )}
    </section>
  )
}
