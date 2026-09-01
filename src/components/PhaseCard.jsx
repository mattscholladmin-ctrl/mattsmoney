// @ts-nocheck
import { useState } from 'react'
import { shortDate } from '../lib/format'
import { addPhase, updatePhase, deletePhase } from '../lib/api'
import Modal from './Modal'

export default function PhaseCard({ phaseInfo, phases, onChanged }) {
  const [open, setOpen] = useState(false)
  const current = phaseInfo?.current
  const next = phaseInfo?.next
  const transitionSoon = phaseInfo?.transitionSoon

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-slate-800">Current phase</h2>
        <button
          onClick={() => setOpen(true)}
          className="text-sm text-emerald-700 font-medium"
        >
          Manage
        </button>
      </div>

      {!current && phases.length === 0 ? (
        <p className="text-sm text-slate-400">
          No phases set. Tap Manage to add your plan.
        </p>
      ) : current ? (
        <>
          <p className="text-xl font-bold text-emerald-800">{current.name}</p>
          {current.allocations && (
            <p className="text-sm text-slate-600 mt-1">{current.allocations}</p>
          )}
          {current.ends_on && (
            <p className="text-xs text-slate-400 mt-1">
              Through {shortDate(current.ends_on)}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          No active phase for today's date.
        </p>
      )}

      {transitionSoon && next && (
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-3 text-sm">
          <strong>Phase change in {phaseInfo.daysToNext} day
          {phaseInfo.daysToNext === 1 ? '' : 's'}:</strong> {next.name} starts{' '}
          {shortDate(next.starts_on)}.
          {next.allocations ? ` ${next.allocations}` : ''}
        </div>
      )}

      {open && (
        <ManagePhasesModal
          phases={phases}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </section>
  )
}

function ManagePhasesModal({ phases, onClose, onChanged }) {
  const [name, setName] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [allocations, setAllocations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function add(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await addPhase({
        name: name.trim(),
        starts_on: startsOn,
        ends_on: endsOn || null,
        allocations: allocations.trim() || null,
        sort_order: phases.length,
      })
      setName('')
      setStartsOn('')
      setEndsOn('')
      setAllocations('')
      onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Phases" onClose={onClose}>
      <form onSubmit={add} className="space-y-3 text-slate-700">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Phase name (e.g. 1 — Survival)"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Starts</label>
            <input
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              type="date"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">
              Ends (optional)
            </label>
            <input
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <textarea
          value={allocations}
          onChange={(e) => setAllocations(e.target.value)}
          placeholder="What's active this phase (e.g. EF $500/mo · Loan $800/mo)"
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2"
        >
          {busy ? 'Saving…' : 'Add phase'}
        </button>
      </form>

      {phases.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {phases.map((p) => (
            <PhaseRow key={p.id} phase={p} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </Modal>
  )
}

function PhaseRow({ phase, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(phase.name)
  const [startsOn, setStartsOn] = useState(phase.starts_on || '')
  const [endsOn, setEndsOn] = useState(phase.ends_on || '')
  const [allocations, setAllocations] = useState(phase.allocations || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await updatePhase(phase.id, {
        name: name.trim(),
        starts_on: startsOn,
        ends_on: endsOn || null,
        allocations: allocations.trim() || null,
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
    await deletePhase(phase.id)
    onChanged()
  }

  if (!editing) {
    return (
      <li className="flex justify-between items-start py-2">
        <span className="text-sm text-slate-700">
          {phase.name}
          <span className="block text-xs text-slate-400">
            {shortDate(phase.starts_on)}
            {phase.ends_on ? ` → ${shortDate(phase.ends_on)}` : ' →'}
          </span>
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
    <li className="py-3">
      <form onSubmit={save} className="space-y-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Phase name"
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Starts</label>
            <input
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              type="date"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">
              Ends (optional)
            </label>
            <input
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              type="date"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <textarea
          value={allocations}
          onChange={(e) => setAllocations(e.target.value)}
          placeholder="What's active this phase"
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
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
