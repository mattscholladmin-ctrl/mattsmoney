// @ts-nocheck
import { useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { LineChart } from './Charts'
import Modal from './Modal'
import {
  addCreditScore,
  deleteCreditScore,
  toggleMilestone,
  toggleCreditTask,
  updateDebtCredit,
} from '../lib/api'
import { TileColumns } from './TileFrame'
import { useTileLayout } from '../lib/tileLayout'

const CREDIT_TILE_NAMES = {
  scores: 'Credit scores',
  utilization: 'Card utilization',
  cards: 'Credit cards',
  collections: 'Collections',
  projection: 'Score projection',
  plan: 'Action plan',
}
const CREDIT_TILE_IDS = Object.keys(CREDIT_TILE_NAMES)
const DEFAULT_CREDIT_LAYOUT = {
  left: ['scores', 'utilization', 'cards'],
  right: ['collections', 'projection', 'plan'],
}

// Score bands (FICO-style) for color + label.
function band(score) {
  if (score >= 740) return { label: 'Very good', cls: 'text-emerald-700', bg: 'bg-emerald-500' }
  if (score >= 670) return { label: 'Good', cls: 'text-emerald-600', bg: 'bg-emerald-500' }
  if (score >= 580) return { label: 'Fair', cls: 'text-amber-600', bg: 'bg-amber-500' }
  return { label: 'Poor', cls: 'text-red-600', bg: 'bg-red-500' }
}

// Latest reading per "Bureau · Model".
function latestPerKey(scores) {
  const map = {}
  for (const s of scores) {
    const key = `${s.bureau} · ${s.model || ''}`.trim()
    if (!map[key] || (s.checked_on || '') >= (map[key].checked_on || '')) map[key] = s
  }
  return Object.values(map).sort((a, b) => b.score - a.score)
}

export default function CreditView({
  scores = [],
  milestones = [],
  tasks = [],
  debts = [],
  arranging = false,
  onChanged,
}) {
  const [logging, setLogging] = useState(false)
  const tilesState = useTileLayout('credit', CREDIT_TILE_IDS, DEFAULT_CREDIT_LAYOUT)

  const cards = debts.filter((d) => !d.is_collection && d.kind === 'card' && d.active !== false)
  const collections = debts.filter((d) => d.is_collection)

  const latest = latestPerKey(scores)
  // Primary score = most recent Experian FICO 8 if present, else highest current.
  const primary =
    latest.find((s) => s.bureau === 'Experian' && (s.model || '').includes('FICO')) || latest[0]

  // Utilization across cards that have a limit set.
  const withLimit = cards.filter((c) => Number(c.credit_limit) > 0)
  const totalBal = cards.reduce((s, c) => s + Number(c.balance || 0), 0)
  const totalLimit = withLimit.reduce((s, c) => s + Number(c.credit_limit || 0), 0)
  const utilPct = totalLimit > 0 ? Math.round((totalBal / totalLimit) * 100) : null

  // Projection line from milestones (target score over time).
  const projPoints = milestones
    .filter((m) => m.target_date)
    .sort((a, b) => (a.target_date < b.target_date ? -1 : 1))
    .map((m) => ({ label: shortDate(m.target_date), value: m.target_score }))

  const phases = [...new Set(tasks.map((t) => t.phase))]

  const tiles = {
    scores: (
      <section className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Credit scores</h2>
          <button onClick={() => setLogging(true)} className="text-sm text-emerald-700 font-medium">
            Log scores
          </button>
        </div>

        {primary ? (
          <div className="mb-4">
            <p className="text-xs text-slate-400">
              {primary.bureau} · {primary.model}
            </p>
            <div className="flex items-end gap-3">
              <span className="text-5xl font-bold text-slate-800">{primary.score}</span>
              <span className={`text-sm font-medium mb-1 ${band(primary.score).cls}`}>
                {band(primary.score).label}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Updated {shortDate(primary.checked_on)} · range 300–850
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400 mb-2">No scores logged yet. Tap "Log scores" to start.</p>
        )}

        {latest.length > 0 && (
          <ul className="space-y-2">
            {latest.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">
                  {s.bureau} <span className="text-slate-400">· {s.model}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`font-semibold ${band(s.score).cls}`}>{s.score}</span>
                  <span className="text-xs text-slate-400">{shortDate(s.checked_on)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    ),

    utilization: (
      <section className="rounded-2xl bg-white p-5 shadow">
        <h2 className="font-semibold text-slate-800 mb-1">Card utilization</h2>
        <p className="text-xs text-slate-400 mb-3">Keep this under 30%. Lower is better.</p>

        {utilPct === null ? (
          <p className="text-sm text-slate-500">
            Add a credit limit to your cards below to see your utilization.
          </p>
        ) : (
          <>
            <div className="flex justify-between items-end mb-1">
              <span className={`text-3xl font-bold ${utilPct > 30 ? 'text-red-600' : 'text-emerald-700'}`}>
                {utilPct}%
              </span>
              <span className="text-sm text-slate-500">
                {money(totalBal)} of {money(totalLimit)}
              </span>
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden relative">
              <div
                className={`h-full rounded-full ${utilPct > 30 ? 'bg-red-500' : 'bg-emerald-600'}`}
                style={{ width: `${Math.min(100, utilPct)}%` }}
              />
              {/* 30% target marker */}
              <div className="absolute top-0 bottom-0 w-px bg-slate-400" style={{ left: '30%' }} />
            </div>
            <p className="text-[0.75rem] text-slate-400 mt-1">The line marks the 30% target.</p>
          </>
        )}
      </section>
    ),

    cards:
      cards.length === 0 ? null : (
        <section className="rounded-2xl bg-white p-5 shadow">
          <h2 className="font-semibold text-slate-800 mb-3">Credit cards</h2>
          <ul className="space-y-4">
            {cards.map((c) => (
              <CardRow key={c.id} card={c} onChanged={onChanged} />
            ))}
          </ul>
        </section>
      ),

    collections:
      collections.length === 0 ? null : (
        <section className="rounded-2xl bg-white p-5 shadow">
          <h2 className="font-semibold text-slate-800 mb-3">Collections</h2>
          <ul className="divide-y divide-slate-100">
            {collections.map((c) => {
              const cleared = c.active === false || Number(c.balance || 0) <= 0
              return (
                <li key={c.id} className="py-2.5">
                  <div className="flex justify-between items-center gap-2">
                    <span className="min-w-0 text-sm text-slate-700 truncate">
                      {c.name}
                      {c.original_creditor && (
                        <span className="block text-xs text-slate-400 truncate">
                          orig. {c.original_creditor}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`text-sm font-medium ${cleared ? 'text-emerald-700' : 'text-slate-700'}`}>
                        {cleared ? 'Cleared' : money(c.balance)}
                      </span>
                      {!cleared && c.plan_end_date && (
                        <span className="block text-xs text-slate-400">by {shortDate(c.plan_end_date)}</span>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-[0.75rem] text-slate-400 mt-2">
            Settlement payments are tracked as planned items on your dashboard.
          </p>
        </section>
      ),

    projection:
      milestones.length === 0 ? null : (
        <section className="rounded-2xl bg-white p-5 shadow">
          <h2 className="font-semibold text-slate-800 mb-1">Score projection</h2>
          <p className="text-xs text-slate-400 mb-3">Estimated path if you stay on plan.</p>
          {projPoints.length >= 2 && (
            <div className="mb-3">
              <LineChart points={projPoints} color="#34d399" format={(v) => String(Math.round(v))} />
            </div>
          )}
          <ul className="space-y-2">
            {milestones.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-slate-600">
                  <input
                    type="checkbox"
                    checked={!!m.achieved}
                    onChange={(e) => toggleMilestone(m.id, e.target.checked).then(onChanged)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                  />
                  <span className={m.achieved ? 'line-through text-slate-400' : ''}>
                    {m.name}
                    {m.target_date && <span className="text-slate-400"> · {shortDate(m.target_date)}</span>}
                  </span>
                </label>
                <span className="font-semibold text-slate-700">{m.target_score}</span>
              </li>
            ))}
          </ul>
        </section>
      ),

    plan:
      phases.length === 0 ? null : (
        <div className="space-y-4">
          {phases.map((phase) => (
        <section key={phase} className="rounded-2xl bg-white p-5 shadow">
          <h2 className="font-semibold text-slate-800 mb-3">{phase}</h2>
          <ul className="space-y-2.5">
            {tasks
              .filter((t) => t.phase === phase)
              .map((t) => (
                <li key={t.id}>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={!!t.done}
                      onChange={(e) => toggleCreditTask(t.id, e.target.checked).then(onChanged)}
                      className="h-4 w-4 mt-0.5 rounded border-slate-300 text-emerald-600 shrink-0"
                    />
                    <span className={t.done ? 'line-through text-slate-400' : 'text-slate-700'}>
                      {t.label}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        </section>
          ))}
        </div>
      ),
  }

  return (
    <div className="space-y-4">
      <TileColumns
        names={CREDIT_TILE_NAMES}
        tiles={tiles}
        tilesState={tilesState}
        arranging={arranging}
      />

      {logging && <LogScoreModal onClose={() => setLogging(false)} onChanged={onChanged} />}
    </div>
  )
}

function CardRow({ card, onChanged }) {
  const [flash, setFlash] = useState(false)
  const limit = Number(card.credit_limit || 0)
  const bal = Number(card.balance || 0)
  const pct = limit > 0 ? Math.round((bal / limit) * 100) : null

  async function saveLimit(value) {
    await updateDebtCredit(card.id, { credit_limit: value === '' ? '' : Number(value) })
    setFlash(true)
    setTimeout(() => setFlash(false), 1800)
    onChanged()
  }
  async function saveAutopay(checked) {
    await updateDebtCredit(card.id, { autopay: checked })
    onChanged()
  }

  return (
    <li>
      <div className="flex justify-between text-sm mb-1 gap-2">
        <span className="min-w-0 text-slate-700 truncate">{card.name}</span>
        <span className={`shrink-0 ${pct !== null && pct > 30 ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
          {money(bal)}
          {limit > 0 && <span className="text-slate-400"> / {money(limit)}</span>}
          {pct !== null && <span className="text-slate-400"> · {pct}%</span>}
        </span>
      </div>
      {limit > 0 && (
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-2">
          <div
            className={`h-full rounded-full ${pct > 30 ? 'bg-red-500' : 'bg-emerald-600'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <label className="flex items-center gap-1.5">
          <span>Limit $</span>
          <input
            type="number"
            inputMode="decimal"
            defaultValue={card.credit_limit ?? ''}
            onBlur={(e) => saveLimit(e.target.value)}
            placeholder="—"
            className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          {flash && <span className="text-emerald-700 font-medium">✓ saved</span>}
        </label>
        {card.plan_payment > 0 && (
          <span>
            Plan {money(card.plan_payment)}/mo
            {card.plan_end_date && ` · ends ${shortDate(card.plan_end_date)}`}
          </span>
        )}
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={!!card.autopay}
            onChange={(e) => saveAutopay(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600"
          />
          <span>Autopay full</span>
        </label>
        {card.activity_charge && <span>Charge: {card.activity_charge}</span>}
      </div>
    </li>
  )
}

// Each bureau's usual model + where you typically check it (editable per row).
const BUREAU_DEFAULTS = {
  Experian: { model: 'FICO 8', source: 'Experian.com' },
  TransUnion: { model: 'VantageScore 3.0', source: 'Credit Karma' },
  Equifax: { model: 'VantageScore 3.0', source: 'Credit Karma' },
}
const SOURCE_OPTIONS = [
  'Experian.com',
  'Credit Karma',
  'Equifax.com',
  'TransUnion.com',
  'myFICO',
  'Bank / card app',
]

function LogScoreModal({ onClose, onChanged }) {
  // Local date, not UTC — evening entries were getting stamped tomorrow.
  const [date, setDate] = useState(isoDate())
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      Object.entries(BUREAU_DEFAULTS).map(([b, d]) => [b, { score: '', model: d.model, source: d.source }])
    )
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  function setField(bureau, field, value) {
    setRows((r) => ({ ...r, [bureau]: { ...r[bureau], [field]: value } }))
  }

  async function save(e) {
    e.preventDefault()
    const toSave = Object.entries(rows).filter(([, v]) => String(v.score).trim() !== '')
    if (toSave.length === 0) {
      setError('Enter at least one score.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const [bureau, v] of toSave) {
        await addCreditScore({
          bureau,
          model: v.model,
          score: Number(v.score),
          source: v.source.trim() || null,
          checked_on: date,
        })
      }
      onChanged()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Log credit scores" onClose={onClose}>
      <form onSubmit={save} className="space-y-4 text-slate-700">
        <label className="block">
          <span className="text-sm text-slate-500">Date checked</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </label>

        <p className="text-xs text-slate-400">
          Fill in the scores you have — leave the rest blank. Pick where you checked each one so you
          know your source.
        </p>

        {Object.keys(BUREAU_DEFAULTS).map((bureau) => (
          <div key={bureau} className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="font-medium text-slate-700">{bureau}</p>
            <div className="flex gap-2">
              <input
                value={rows[bureau].score}
                onChange={(e) => setField(bureau, 'score', e.target.value)}
                placeholder="Score"
                type="number"
                inputMode="numeric"
                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-base"
              />
              <select
                value={rows[bureau].model}
                onChange={(e) => setField(bureau, 'model', e.target.value)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
              >
                <option>FICO 8</option>
                <option>VantageScore 3.0</option>
              </select>
            </div>
            <label className="block">
              <span className="text-xs text-slate-400">Checked at</span>
              <select
                value={rows[bureau].source}
                onChange={(e) => setField(bureau, 'source', e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
              >
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Save scores'}
        </button>
      </form>
    </Modal>
  )
}
