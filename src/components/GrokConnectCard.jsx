// @ts-nocheck
import { money } from '../lib/format'

export default function GrokConnectCard({ data }) {
  const accounts = (data?.accounts || []).filter((a) => !a.hidden)
  const cards = (data?.debts || []).filter((d) => d.kind === 'card' && d.active !== false)
  const bills = (data?.bills || []).filter((b) => b.active !== false)
  const goals = (data?.goals || []).filter((g) => g.status === 'active')
  const cash = (data?.balances || []).reduce((s, b) => s + Number(b.balance || 0), 0)

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold text-slate-800">Grok</h2>
        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-1">
          Connector
        </span>
      </div>
      <p className="text-sm text-slate-600">
        In a Grok chat, use the <strong>Matt’s Money</strong> connector. It reads this
        app live. It only changes something after you say yes.
      </p>
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
        Add or reconnect it at grok.com/connectors if a new chat doesn’t see the
        tools. That is a Grok setting, not a switch in this app.
      </p>
    </section>
  )
}
