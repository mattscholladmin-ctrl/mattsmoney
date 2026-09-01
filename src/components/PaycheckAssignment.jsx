// @ts-nocheck
import { money, shortDate } from '../lib/format'

export default function PaycheckAssignment({ assignment }) {
  if (!assignment || !(assignment.amount > 0)) return null
  const short = assignment.free < 0
  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h2 className="font-semibold text-slate-800">This paycheck</h2>
        <span className="text-sm font-medium text-slate-500">{money(assignment.amount)}</span>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        {assignment.name}
        {assignment.date ? ` · ${shortDate(assignment.date)}` : ''}
        {' — each line is this paycheck\'s share'}
      </p>
      {assignment.lines.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing assigned yet. All of it is free.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {assignment.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2">
              <span className="text-slate-600 min-w-0 truncate">{l.name}</span>
              <span className="text-slate-800 shrink-0">−{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between pt-3 mt-3 border-t border-slate-200">
        <span className="font-semibold text-slate-800">Left free</span>
        <span className={`font-semibold ${short ? 'text-red-600' : 'text-emerald-700'}`}>
          {money(assignment.free)}
        </span>
      </div>
    </section>
  )
}
