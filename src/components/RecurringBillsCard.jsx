// @ts-nocheck
import { useMemo, useState } from 'react'
import { money } from '../lib/format'
import { addBill, updateBill, deleteBill, setBillSmooth } from '../lib/api'
import { detectRecurring } from '../lib/budget'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const scheduleLabel = (b) =>
  b.cadence === 'weekly' ? `weekly · ${WEEKDAYS[Number(b.due_day)] || '—'}` : `monthly · day ${b.due_day}`

// The full recurring-bills hub (lives on Insights): every tracked bill, editable
// in place, plus charges the app has spotted that you can confirm or dismiss.
// `embedded` drops the card chrome + duplicate heading when this is rendered
// inside a modal (the Dashboard's bills tile opens it that way), so it doesn't
// read as a card floating inside another card.
export default function RecurringBillsCard({ bills = [], transactions = [], ppy = 26, onChanged, embedded = false }) {
  const [showAdd, setShowAdd] = useState(false)
  const [addingKey, setAddingKey] = useState(null)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('budget.dismissedRecurring') || '[]')
    } catch {
      return []
    }
  })

  const detected = useMemo(
    () =>
      detectRecurring(transactions, bills).filter(
        (d) => !(dismissed.includes(d.key) || dismissed.includes(d.merchant))
      ),
    [transactions, bills, dismissed]
  )
  const sorted = useMemo(
    () => [...bills].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)),
    [bills]
  )

  function dismissDetected(key) {
    setDismissed((x) => {
      const next = [...x, key]
      try {
        localStorage.setItem('budget.dismissedRecurring', JSON.stringify(next))
      } catch {
        /* private mode — session only */
      }
      return next
    })
  }
  async function addDetectedAsBill(d) {
    setAddingKey(d.merchant)
    try {
      await addBill({ name: d.merchant, amount: d.amount, category: d.category || 'Bills', cadence: d.cadence, due_day: d.due_day })
      onChanged()
    } finally {
      setAddingKey(null)
    }
  }

  return (
    <section className={embedded ? '' : 'rounded-2xl bg-white p-5 shadow'}>
      <div className="flex items-center justify-between mb-1">
        {embedded ? <span /> : <h2 className="font-semibold text-slate-800">Recurring bills</h2>}
        <button onClick={() => setShowAdd((s) => !s)} className="text-sm text-emerald-700 font-medium">
          {showAdd ? 'Close' : '+ Add'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Every bill you track — edit the amount, change the schedule, or delete. These are what reduce
        your Safe to spend.
      </p>

      {showAdd && <AddBillForm onChanged={onChanged} onDone={() => setShowAdd(false)} />}

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400">No bills yet — tap + Add to track one.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sorted.map((b) => (
            <BillRow key={b.id} bill={b} ppy={ppy} onChanged={onChanged} />
          ))}
        </ul>
      )}

      {detected.length > 0 && (
        <>
          <p className="mt-5 mb-1 text-[0.7rem] font-semibold tracking-wide text-slate-500">
            SPOTTED — NOT TRACKED YET
          </p>
          <p className="text-xs text-slate-400 mb-2">
            Charges the app noticed repeating. Confirm the real ones, dismiss the rest.
          </p>
          <ul className="rounded-xl bg-amber-50 border border-amber-200 divide-y divide-amber-100">
            {detected.map((d) => (
              <li key={d.merchant} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-slate-700 truncate">{d.merchant}</p>
                  <p className="text-xs text-slate-400">
                    {money(d.amount)} · {d.cadence === 'weekly' ? 'weekly' : 'monthly'} · seen {d.count}×
                  </p>
                </div>
                <span className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => addDetectedAsBill(d)}
                    disabled={addingKey === d.merchant}
                    className="text-xs bg-emerald-700 text-white font-medium rounded-md px-2.5 py-1 disabled:opacity-50"
                  >
                    {addingKey === d.merchant ? 'Adding…' : 'Add as bill'}
                  </button>
                  <button
                    onClick={() => dismissDetected(d.key || d.merchant)}
                    className="text-slate-400 hover:text-red-500 px-1"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

// Shared field styles — every flex child gets min-w-0 so nothing overflows.
const inputCls = 'min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base'

function ScheduleFields({ cadence, setCadence, dueDay, setDueDay }) {
  return (
    <div className="flex gap-2">
      <select
        value={cadence}
        onChange={(e) => {
          setCadence(e.target.value)
          setDueDay(e.target.value === 'weekly' ? '4' : '1')
        }}
        className={`${inputCls} bg-white`}
      >
        <option value="monthly">Monthly</option>
        <option value="weekly">Weekly</option>
      </select>
      {cadence === 'monthly' ? (
        <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={`${inputCls} bg-white`}>
          {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </select>
      ) : (
        <select value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={`${inputCls} bg-white`}>
          {WEEKDAYS.map((d, i) => (
            <option key={i} value={i}>{d}</option>
          ))}
        </select>
      )}
    </div>
  )
}

function AddBillForm({ onChanged, onDone }) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState('Bills')
  const [cadence, setCadence] = useState('monthly')
  const [dueDay, setDueDay] = useState('1')
  const [startDate, setStartDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await addBill({ name: name.trim(), amount: Number(amount), category: category.trim() || 'Bills', cadence, due_day: Number(dueDay), start_date: startDate || null })
      onChanged()
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={add} className="space-y-2 mb-4 rounded-xl bg-slate-50 border border-slate-200 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Bill name (e.g. Verizon)"
        required
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <div className="flex gap-2">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" type="number" step="0.01" inputMode="decimal" required className={inputCls} />
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className={inputCls} />
      </div>
      <ScheduleFields cadence={cadence} setCadence={setCadence} dueDay={dueDay} setDueDay={setDueDay} />
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} title="First due date" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2">
        {busy ? 'Saving…' : 'Add bill'}
      </button>
    </form>
  )
}

function BillRow({ bill, ppy = 26, onChanged }) {
  const [editing, setEditing] = useState(false)
  const perPaycheck = ((Number(bill.amount) || 0) * (bill.cadence === 'weekly' ? 52 : 12)) / ppy
  async function toggleSmooth() {
    await setBillSmooth(bill.id, !bill.smooth)
    onChanged()
  }
  const [name, setName] = useState(bill.name)
  const [category, setCategory] = useState(bill.category || 'Bills')
  const [cadence, setCadence] = useState(bill.cadence)
  const [dueDay, setDueDay] = useState(String(bill.due_day))
  const [startDate, setStartDate] = useState(bill.start_date || '')
  const [busy, setBusy] = useState(false)

  // Inline amount edit — tap the box, tap away to save (like budgets). Sends the
  // full row so nothing else gets blanked.
  async function saveAmount(v) {
    const n = Number(v)
    if (Number.isNaN(n) || n === Number(bill.amount)) return
    await updateBill(bill.id, { name: bill.name, amount: n, category: bill.category || 'Bills', cadence: bill.cadence, due_day: bill.due_day, start_date: bill.start_date || null })
    onChanged()
  }
  async function saveEdit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await updateBill(bill.id, { name: name.trim(), amount: Number(bill.amount), category: category.trim() || 'Bills', cadence, due_day: Number(dueDay), start_date: startDate || null })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    await deleteBill(bill.id)
    onChanged()
  }

  if (editing) {
    return (
      <li className="py-3">
        <form onSubmit={saveEdit} className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bill name" required className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" />
          <ScheduleFields cadence={cadence} setCadence={setCadence} dueDay={dueDay} setDueDay={setDueDay} />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base" title="First due date" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="flex-1 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="flex-1 border border-slate-300 text-slate-600 rounded-lg px-4 py-2">
              Cancel
            </button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm text-slate-700 truncate">{bill.name}</span>
          <span className="block text-xs text-slate-400">{scheduleLabel(bill)}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="flex items-center rounded-lg border border-slate-300 px-2 py-1 text-sm">
            <span className="text-slate-400">$</span>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              defaultValue={bill.amount}
              onBlur={(e) => saveAmount(e.target.value)}
              className="w-16 text-right outline-none"
              title="Change the amount — tap away to save"
            />
          </span>
          <button onClick={() => setEditing(true)} className="text-xs text-emerald-700 font-medium">Edit</button>
          <button onClick={remove} className="text-xs text-red-600">Delete</button>
        </span>
      </div>
      <button
        type="button"
        onClick={toggleSmooth}
        className={`mt-1 text-xs font-medium ${bill.smooth ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600'}`}
        title="Set aside a share of this out of every paycheck instead of it hitting all at once"
      >
        {bill.smooth ? `● Saving ${money(perPaycheck)}/paycheck` : '○ Save each paycheck'}
      </button>
    </li>
  )
}
