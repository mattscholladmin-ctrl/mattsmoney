// @ts-nocheck
import { useMemo, useState } from 'react'
import { money } from '../lib/format'
import { unusualCharges } from '../lib/budget'

export default function UnusualChargesCard({ transactions = [] }) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('budget.hiddenInsights') || '[]') } catch { return [] }
  })
  const [hiddenKind, setHiddenKind] = useState(() => {
    try { return JSON.parse(localStorage.getItem('budget.hideInsightKinds') || '[]') } catch { return [] }
  })
  const alerts = useMemo(
    () => unusualCharges(transactions).filter((a) => !dismissed.includes(a.id) && !hiddenKind.includes(a.kind)),
    [transactions, dismissed, hiddenKind]
  )
  if (!alerts.length) return null

  function persist(next) {
    setDismissed(next)
    localStorage.setItem('budget.hiddenInsights', JSON.stringify(next))
  }
  function hideKind(kind) {
    const next = [...hiddenKind, kind]
    setHiddenKind(next)
    localStorage.setItem('budget.hideInsightKinds', JSON.stringify(next))
  }

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
            <li key={a.id} className="py-2 text-sm">
              <div className="flex justify-between items-center gap-2">
                <div className="min-w-0">
                  <p className="text-slate-700 truncate">
                    {a.merchant} — {money(a.amount)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.kind === 'duplicate'
                      ? `Possible duplicate — same amount ${
                          a.days === 0 ? 'same day' : `${a.days} day${a.days > 1 ? 's' : ''} apart`
                        }`
                      : `Bigger than usual — typical here is ${money(a.median)}`}
                  </p>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={() => persist([...dismissed, a.id])} className="text-xs text-emerald-700">
                  Yep, looks right
                </button>
                <button type="button" onClick={() => persist([...dismissed, a.id])} className="text-xs text-slate-500">
                  Something&apos;s off
                </button>
                <button type="button" onClick={() => hideKind(a.kind)} className="text-xs text-slate-400">
                  Hide insights like this
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
