// @ts-nocheck
import { useMemo, useState } from 'react'
import { money } from '../lib/format'
import { unusualCharges } from '../lib/budget'

// Quiet, collapsed-by-default review of charges worth a second look (likely
// duplicates or amounts well above normal for a merchant). Lives in Insights —
// never a prominent item on the home screen.
export default function UnusualChargesCard({ transactions = [] }) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState([])
  const alerts = useMemo(
    () => unusualCharges(transactions).filter((a) => !dismissed.includes(a.id)),
    [transactions, dismissed]
  )
  if (!alerts.length) return null

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2"
        aria-expanded={open}
      >
        <span className="font-semibold text-slate-800">
          Charges worth a second look{' '}
          <span className="text-slate-400 font-normal">({alerts.length})</span>
        </span>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>

      {open && (
        <ul className="mt-3 divide-y divide-slate-100">
          {alerts.map((a) => (
            <li key={a.id} className="flex justify-between items-center gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-slate-700 truncate">
                  {a.merchant} — {money(a.amount)}
                </p>
                <p className="text-xs text-slate-500">
                  {a.kind === 'duplicate'
                    ? `Possible duplicate — same amount ${
                        a.days === 0 ? 'same day' : `${a.days} day${a.days > 1 ? 's' : ''} apart`
                      }`
                    : `Bigger than usual — normally about ${money(a.median)} here`}
                </p>
              </div>
              <button
                onClick={() => setDismissed((x) => [...x, a.id])}
                className="text-xs text-slate-400 px-1 shrink-0"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
