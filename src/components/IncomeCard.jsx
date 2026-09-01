// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { incomeReceivedBySource } from '../lib/budget'
import { addIncome, updateIncome, deleteIncome, addGoal, incrementGoalCurrent, addDebtPayment } from '../lib/api'
import Modal from './Modal'

function cadenceLabel(s) {
  if (s.cadence === 'biweekly') return 'every 2 weeks'
  if (s.cadence === 'weekly') return 'weekly'
  if (s.cadence === 'monthly') return `monthly (day ${s.due_day})`
  if (s.cadence === 'one_time') return 'one time'
  return s.cadence
}

// A "tag-only" source is just a name for labeling deposits (Mountain Dweller,
// CCP) — no amount, no schedule, never counted in forecasts.
export function isTagOnly(s) {
  return (
    Number(s.amount || 0) === 0 && s.cadence === 'one_time' && !s.anchor_date
  )
}

export default function IncomeCard({ income, upcomingIncome, shortfalls = [], goals = [], debts = [], transactions = [], onChanged }) {
  const [open, setOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [focusId, setFocusId] = useState(null)
  const expectedTotal = upcomingIncome.reduce((s, i) => s + i.amount, 0)
  const received = incomeReceivedBySource(transactions)
  const scheduled = income.filter((s) => !isTagOnly(s))
  const tagOnly = income.filter(isTagOnly)

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      {shortfalls.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
          {shortfalls.map((s) => (
            <p key={s.name}>
              <strong>{s.name}</strong> posted {money(s.received)} on {shortDate(s.date)} — less than the {money(s.expected)}/paycheck you have it set to. If your pay actually changed, update the amount below.
            </p>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Income</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setLogOpen(true)}
            className="text-sm text-emerald-700 font-medium"
          >
            Log received
          </button>
          <button
            onClick={() => setOpen(true)}
            className="text-sm text-slate-500 font-medium"
          >
            Manage
          </button>
        </div>
      </div>

      {income.length === 0 ? (
        <p className="text-sm text-slate-400">
          No income yet. Tap Manage to add your paycheck.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {scheduled.map((s) => (
              <li
                key={s.id}
                onClick={() => {
                  setFocusId(s.id)
                  setOpen(true)
                }}
                className="flex justify-between gap-2 py-2 text-sm cursor-pointer rounded-lg -mx-2 px-2 hover:bg-slate-100/60"
                title="Tap to edit"
              >
                <span className="flex-1 min-w-0 text-slate-700 truncate">
                  {s.name}{' '}
                  <span className="text-slate-400">({cadenceLabel(s)})</span>
                  {s.confirmed === false && (
                    <span className="ml-1 text-amber-600">· side income</span>
                  )}
                </span>
                <span className="shrink-0 text-emerald-700 font-medium">
                  {money(s.amount)}
                </span>
              </li>
            ))}
          </ul>
          {tagOnly.length > 0 && (
            <p className="text-xs text-slate-400 pt-2">
              Tags for deposits: {tagOnly.map((s) => s.name).join(' · ')}
            </p>
          )}
          {upcomingIncome.length > 0 && (
            <div className="flex justify-between pt-3 mt-1 border-t border-slate-200 text-sm">
              <span className="text-slate-500">
                Expected next 30 days
                <span className="block text-xs text-slate-400">
                  confirmed income only
                </span>
              </span>
              <span className="font-semibold text-emerald-700">
                {money(expectedTotal)}
              </span>
            </div>
          )}
          {received.rows.length > 0 && (
            <div className="pt-3 mt-1 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">
                Received this month
              </p>
              <ul className="space-y-1">
                {received.rows.map((r) => (
                  <li key={r.source} className="flex justify-between gap-2 text-sm">
                    <span className="min-w-0 text-slate-600 truncate">{r.source}</span>
                    <span className="shrink-0 text-emerald-700 font-medium">{money(r.total)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between text-sm pt-1.5 mt-1.5 border-t border-slate-100 font-semibold text-slate-700">
                <span>Total in</span>
                <span className="text-emerald-700">{money(received.total)}</span>
              </div>
            </div>
          )}
        </>
      )}

      {open && (
        <ManageIncomeModal
          income={income}
          focusId={focusId}
          onClose={() => {
            setOpen(false)
            setFocusId(null)
          }}
          onChanged={onChanged}
        />
      )}
      {logOpen && (
        <LogIncomeModal
          income={income}
          goals={goals}
          debts={debts}
          onClose={() => setLogOpen(false)}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}

// Log income you received and split it across your own rules (e.g. 25% Taxes,
// then Vehicle Fund, then the friend loan). The % per target are saved as your
// default rules and are fully editable. Money lands in each goal's Saved bar,
// pays down a debt, or builds your Taxes cushion. Reminder: also update your
// bank balance at check-in to reflect the deposit.
const ALLOC_KEY = 'budget.allocationRules'

function LogIncomeModal({ income, goals = [], debts = [], onClose, onChanged }) {
  const sourceNames = income.map((s) => s.name)

  // Targets you can split income into: active goals, debts (pay down), + Taxes.
  const targets = [
    ...goals
      // Exclude the dedicated Taxes bucket — it's handled by the Taxes target
      // below, so it must not appear twice (which would double-credit it).
      .filter((g) => g.status === 'active' && (g.name || '').trim().toLowerCase() !== 'taxes')
      .map((g) => ({ key: `goal:${g.id}`, name: g.name, kind: 'goal', id: g.id })),
    ...debts
      .filter((d) => d.active !== false)
      .map((d) => ({ key: `debt:${d.id}`, name: `${d.name} (pay down)`, kind: 'debt', id: d.id })),
    { key: 'taxes', name: 'Taxes (set aside)', kind: 'taxes' },
  ]

  const [amount, setAmount] = useState('')
  const [source, setSource] = useState(sourceNames[0] || 'Other')
  const [date, setDate] = useState(isoDate())
  const [percents, setPercents] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(ALLOC_KEY) || '{}')
    } catch {
      return {}
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const amt = Number(amount) || 0
  const totalPct = targets.reduce((s, t) => s + (Number(percents[t.key]) || 0), 0)
  const share = (key) => Math.round(amt * (Number(percents[key]) || 0)) / 100
  const allocated = targets.reduce((s, t) => s + share(t.key), 0)
  const leftover = Math.max(0, amt - allocated)

  function setPct(key, val) {
    setPercents((p) => ({ ...p, [key]: val === '' ? '' : Number(val) }))
  }
  const appendNote = (note, s) => {
    const entry = `+${money(s)} ${source} (${shortDate(date)})`
    return note ? `${note} · ${entry}` : entry
  }

  async function submit(e) {
    e.preventDefault()
    if (amt <= 0) return setError('Enter the amount you received.')
    if (totalPct > 100) return setError("Your splits add up to more than 100%.")
    setBusy(true)
    setError(null)
    try {
      for (const t of targets) {
        const s = share(t.key)
        if (s <= 0) continue
        // Live-read increments (never a stale client snapshot) so splitting one
        // paycheck across several buckets can't lose a share to a clobber.
        if (t.kind === 'goal') {
          await incrementGoalCurrent(t.id, s, appendNote('', s))
        } else if (t.kind === 'debt') {
          // Log it as a dated payment. For a bank-linked debt the bank owns the
          // balance, so addDebtPayment records the payment without touching it —
          // a raw decrement here would be silently reverted by the next sync.
          const d = debts.find((x) => x.id === t.id)
          const bankLinked = !!(d && (d.plaid_account_id || d.plaid_item_id))
          await addDebtPayment({ debt_id: t.id, amount: s, paid_on: date, note: appendNote('', s), bankLinked })
        } else if (t.kind === 'taxes') {
          // Exact "Taxes" bucket only — never a lookalike like "Tax refund".
          const tax = goals.find((g) => (g.name || '').trim().toLowerCase() === 'taxes')
          if (tax) {
            await incrementGoalCurrent(tax.id, s, appendNote('', s))
          } else {
            await addGoal({ name: 'Taxes', target: 0, current: s, note: appendNote('', s) })
          }
        }
      }
      try {
        localStorage.setItem(ALLOC_KEY, JSON.stringify(percents))
      } catch {
        /* private mode — splits just won't be remembered */
      }
      onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title="Allocate received income" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-slate-700">
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            autoFocus
            placeholder="Amount"
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <label className="block text-sm">
          <span className="text-slate-500">From</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
          >
            {sourceNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
            <option value="Other">Other</option>
          </select>
        </label>

        <div>
          <p className="text-sm text-slate-500 mb-1">
            Split into <span className="text-slate-400">(your rules — edit anytime)</span>
          </p>
          <ul className="space-y-1.5">
            {targets.map((t) => (
              <li key={t.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1 min-w-0 text-slate-700 truncate">{t.name}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={percents[t.key] ?? ''}
                  onChange={(e) => setPct(t.key, e.target.value)}
                  placeholder="0"
                  className="w-14 rounded-lg border border-slate-300 px-2 py-1.5 text-right"
                />
                <span className="text-slate-400 w-3">%</span>
                <span className="w-16 text-right text-slate-500">
                  {amt > 0 && share(t.key) > 0 ? money(share(t.key)) : ''}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-between text-xs mt-2 pt-2 border-t border-slate-200">
            <span className={totalPct > 100 ? 'text-red-600' : 'text-slate-500'}>
              {totalPct}% allocated{totalPct > 100 ? ' (over 100%)' : ''}
            </span>
            <span className="text-slate-500">Kept as cash: {money(leftover)}</span>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Set a % for each. Leftover stays as cash. Update your bank balance at check-in to reflect the deposit.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  )
}

function ManageIncomeModal({ income, focusId = null, onClose, onChanged }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState('biweekly')
  const [anchorDate, setAnchorDate] = useState('')
  const [dueDay, setDueDay] = useState('1')
  // Starts unconfirmed — Rule 2 is "the app never spends hoped-for money," so
  // a NEW source you add in a hurry shouldn't start counting toward Safe to
  // spend until you actively say it's steady/guaranteed. One extra tap for a
  // real paycheck beats a speculative one silently counting by default.
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const needsAnchor =
    cadence === 'biweekly' || cadence === 'weekly' || cadence === 'one_time'

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await addIncome({
        name: name.trim(),
        amount: Number(amount),
        cadence,
        anchor_date: needsAnchor ? anchorDate : null,
        due_day: cadence === 'monthly' ? Number(dueDay) : null,
        confirmed,
      })
      setName('')
      setAmount('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const [tagName, setTagName] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  async function addTagOnly(e) {
    e.preventDefault()
    if (!tagName.trim()) return
    setTagBusy(true)
    try {
      // Name only: no amount, no schedule, never counted in forecasts —
      // exists purely as a tag choice for deposits.
      await addIncome({
        name: tagName.trim(),
        amount: 0,
        cadence: 'one_time',
        anchor_date: null,
        due_day: null,
        confirmed: false,
      })
      setTagName('')
      onChanged()
    } finally {
      setTagBusy(false)
    }
  }

  return (
    <Modal title="Income" onClose={onClose}>
      <form onSubmit={addTagOnly} className="mb-4 pb-4 border-b border-slate-100">
        <p className="text-sm font-medium text-slate-700 mb-1">
          Add a source name (for tagging deposits)
        </p>
        <p className="text-xs text-slate-400 mb-2">
          Just a name — no amount or schedule. Use it to label money that comes
          in from a business or person (e.g. Mountain Dweller, CCP).
        </p>
        <div className="flex gap-2">
          <input
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            placeholder="Name (e.g. Mountain Dweller)"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <button
            type="submit"
            disabled={tagBusy || !tagName.trim()}
            className="shrink-0 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
          >
            {tagBusy ? '…' : 'Add'}
          </button>
        </div>
      </form>
      <p className="text-sm font-medium text-slate-700 mb-1">Add scheduled income</p>
      <form onSubmit={add} className="space-y-3 text-slate-700">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (e.g. Summit paycheck)"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          type="number"
          step="0.01"
          inputMode="decimal"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
        >
          <option value="biweekly">Every 2 weeks</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="one_time">One time</option>
        </select>

        {needsAnchor && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {cadence === 'one_time' ? 'Date received' : 'A recent or next payday'}
            </label>
            <input
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              type="date"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            {cadence !== 'one_time' && (
              <p className="text-xs text-slate-500 mt-1">
                Pick any one payday — we count {cadence === 'biweekly' ? 'every 2 weeks' : 'every week'} from it.
              </p>
            )}
          </div>
        )}

        {cadence === 'monthly' && (
          <select
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Day {d}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={!confirmed}
            onChange={(e) => setConfirmed(!e.target.checked)}
            className="mt-1"
          />
          <span>
            This is <strong>side income</strong> (uncertain). Keep it out of my
            forecast until I actually receive it.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Add income'}
        </button>
      </form>

      {income.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {income.map((s) => (
            <IncomeRow key={s.id} source={s} autoEdit={s.id === focusId} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function IncomeRow({ source, autoEdit = false, onChanged }) {
  const [editing, setEditing] = useState(!!autoEdit)
  const rowRef = useRef(null)
  useEffect(() => {
    if (autoEdit && rowRef.current) rowRef.current.scrollIntoView({ block: 'center' })
  }, [autoEdit])
  const [name, setName] = useState(source.name)
  const [amount, setAmount] = useState(String(source.amount))
  const [cadence, setCadence] = useState(source.cadence)
  const [anchorDate, setAnchorDate] = useState(source.anchor_date || '')
  const [dueDay, setDueDay] = useState(source.due_day != null ? String(source.due_day) : '1')
  const [confirmed, setConfirmed] = useState(source.confirmed !== false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const needsAnchor =
    cadence === 'biweekly' || cadence === 'weekly' || cadence === 'one_time'

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updateIncome(source.id, {
        name: name.trim(),
        amount: Number(amount),
        cadence,
        anchor_date: needsAnchor ? anchorDate : null,
        due_day: cadence === 'monthly' ? Number(dueDay) : null,
        confirmed,
      })
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await deleteIncome(source.id)
    onChanged()
  }

  if (!editing) {
    return (
      <li ref={rowRef} className="flex justify-between items-center py-2">
        <span className="text-sm text-slate-700">
          {source.name} — {money(source.amount)}{' '}
          <span className="text-slate-400">({cadenceLabel(source)})</span>
          {source.anchor_date && (
            <span className="text-slate-400">
              {' '}
              from {shortDate(source.anchor_date)}
            </span>
          )}
        </span>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-emerald-700 font-medium"
          >
            Edit
          </button>
          <button onClick={remove} className="text-xs text-red-600">
            Delete
          </button>
        </div>
      </li>
    )
  }

  return (
    <li ref={rowRef} className="py-3">
      <form onSubmit={save} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          type="number"
          step="0.01"
          inputMode="decimal"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
        >
          <option value="biweekly">Every 2 weeks</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="one_time">One time</option>
        </select>

        {needsAnchor && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {cadence === 'one_time' ? 'Date received' : 'A recent or next payday'}
            </label>
            <input
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              type="date"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        )}

        {cadence === 'monthly' && (
          <select
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
          >
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Day {d}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={!confirmed}
            onChange={(e) => setConfirmed(!e.target.checked)}
            className="mt-1"
          />
          <span>
            This is <strong>side income</strong> (uncertain). Keep it out of my
            forecast until I actually receive it.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="flex-1 border border-slate-300 text-slate-600 rounded-lg px-4 py-2"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  )
}
