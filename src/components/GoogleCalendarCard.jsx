// @ts-nocheck
import { useEffect, useState } from 'react'
import {
  googleStatus,
  connectGoogle,
  setGoogleToggles,
  disconnectGoogle,
  syncGoogle,
} from '../lib/googleClient'
import { shortDate } from '../lib/format'

function Toggle({ label, hint, on, busy, onChange }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <p className="text-slate-800 font-medium">{label}</p>
        {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => onChange(!on)}
        aria-pressed={on}
        className={`shrink-0 rounded-full px-1 w-14 h-8 flex items-center transition-colors ${
          on ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'
        } ${busy ? 'opacity-50' : ''}`}
      >
        <span className="block w-6 h-6 rounded-full bg-white shadow" />
      </button>
    </div>
  )
}

export default function GoogleCalendarCard() {
  const [status, setStatus] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function refresh() {
    try {
      setStatus(await googleStatus())
    } catch {
      setStatus({ connected: false, error: true })
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function onConnect() {
    setBusy(true)
    setMsg(null)
    try {
      await connectGoogle() // navigates away to Google
    } catch (e) {
      setMsg(e.message)
      setBusy(false)
    }
  }

  async function onToggle(field, value) {
    setBusy(true)
    setMsg(null)
    // Optimistic update so the switch feels instant.
    setStatus((s) => ({ ...s, [field]: value }))
    try {
      await setGoogleToggles({ [field]: value })
    } catch (e) {
      setMsg(e.message)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function onSync() {
    setBusy(true)
    setMsg(null)
    try {
      const r = await syncGoogle()
      const parts = []
      if (r.push_enabled) parts.push(`${r.pushed} event${r.pushed === 1 ? '' : 's'} sent to Google`)
      if (r.pull_enabled) parts.push(`${r.pulled?.length || 0} found on your calendar`)
      setMsg(parts.length ? parts.join(' · ') : 'Both directions are off — nothing to sync.')
    } catch (e) {
      if (e.code === 'reconnect_required') {
        setMsg('Connection expired — please reconnect.')
        await refresh()
      } else {
        setMsg(e.message)
      }
    } finally {
      setBusy(false)
    }
  }

  async function onDisconnect() {
    setBusy(true)
    setMsg(null)
    try {
      await disconnectGoogle()
      setStatus({ connected: false })
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <h2 className="font-semibold text-slate-800">Google Calendar</h2>

      {status === null ? (
        <p className="text-sm text-slate-500">Checking…</p>
      ) : !status.connected ? (
        <>
          <p className="text-sm text-slate-500">
            Connect your Google Calendar to put bills, paydays, and phase
            changes on your calendar — and to see your calendar events here.
          </p>
          <button
            onClick={onConnect}
            disabled={busy}
            className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            Connect Google Calendar
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-500">
            Connected as <span className="text-slate-700">{status.email || 'your Google account'}</span>
          </p>

          <div className="divide-y divide-slate-100 border-y border-slate-100">
            <Toggle
              label="Push to Google Calendar"
              hint="Add your bills, paydays, and phase changes as calendar events."
              on={!!status.push_enabled}
              busy={busy}
              onChange={(v) => onToggle('push_enabled', v)}
            />
            <Toggle
              label="Pull from Google Calendar"
              hint="Show your upcoming calendar events inside the app."
              on={!!status.pull_enabled}
              busy={busy}
              onChange={(v) => onToggle('pull_enabled', v)}
            />
          </div>

          <button
            onClick={onSync}
            disabled={busy}
            className="w-full bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sync now'}
          </button>
          <button
            onClick={onDisconnect}
            disabled={busy}
            className="w-full border border-slate-300 text-slate-700 font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
          >
            Disconnect
          </button>
        </>
      )}

      {msg && <p className="text-sm text-emerald-700 pt-1">{msg}</p>}
    </section>
  )
}
