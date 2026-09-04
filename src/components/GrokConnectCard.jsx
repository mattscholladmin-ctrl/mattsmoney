// @ts-nocheck
import { useState } from 'react'
import { money } from '../lib/format'

const LS = 'budget.grokMock'

export default function GrokConnectCard({ data }) {
  const [on, setOn] = useState(() => {
    try {
      return !!JSON.parse(localStorage.getItem(LS) || 'null')?.on
    } catch {
      return false
    }
  })

  function save(next) {
    setOn(next)
    try {
      localStorage.setItem(LS, JSON.stringify({ on: next }))
    } catch {
      /* ignore */
    }
  }

  const accounts = (data?.accounts || []).filter((a) => a.active !== false)
  const cards = (data?.debts || []).filter((d) => d.kind === 'card' && d.active !== false)
  const bills = (data?.bills || []).filter((b) => b.active !== false)
  const goals = (data?.goals || []).filter((g) => g.status === 'active')
  const cash = (data?.balances || []).reduce((s, b) => s + Number(b.balance || 0), 0)

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Grok</h2>
        {on ? (
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-1">
            On
          </span>
        ) : (
          <span className="text-xs font-medium text-slate-500 bg-slate-100 rounded-full px-2 py-1">
            Off
          </span>
        )}
      </div>

      <p className="text-sm text-slate-600">
        Grok in chat can read this app and change it only when you say yes.
      </p>

      {!on ? (
        <button
          type="button"
          onClick={() => save(true)}
          className="w-full bg-slate-900 text-white font-semibold rounded-lg px-4 py-2.5"
        >
          Turn on
        </button>
      ) : (
        <>
          <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Grok can see
            </p>
            <p className="text-slate-700">
              {accounts.length} accounts · {money(cash)} cash
            </p>
            <p className="text-slate-700">
              {cards.length} cards · {bills.length} bills · {goals.length} goals
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Changes happen in chat: you ask, Grok proposes, you say yes or no.
          </p>
          <button
            type="button"
            onClick={() => save(false)}
            className="w-full border border-slate-300 text-slate-700 font-semibold rounded-lg px-4 py-2.5"
          >
            Turn off
          </button>
        </>
      )}
    </section>
  )
}
