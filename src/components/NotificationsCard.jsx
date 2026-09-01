// @ts-nocheck
import { useEffect, useState } from 'react'
import { saveNotificationPrefs } from '../lib/api'
import {
  pushSupported,
  isStandalone,
  isIOS,
  currentSubscription,
  enablePush,
  disablePush,
} from '../lib/push'

const ALERTS = [
  { key: 'notify_bill_due', label: 'Bill due soon', hint: 'A heads-up before a bill hits.' },
  { key: 'notify_low_balance', label: 'Safe-to-spend gets low', hint: 'When your spendable money drops near zero.' },
  { key: 'notify_phase_change', label: 'Phase change coming up', hint: 'When your plan moves to a new phase.' },
  { key: 'notify_paycheck', label: 'Paycheck expected', hint: 'A reminder the day your pay should land.' },
  { key: 'notify_budget_threshold', label: 'Budget running low', hint: 'When a category is ~80% spent with time left in the month.' },
  { key: 'notify_weekly_digest', label: 'Weekly money recap', hint: 'A Sunday summary: spent, income, and what’s coming this week.' },
]

export default function NotificationsCard({ settings, onChanged }) {
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const supported = pushSupported()
  const needsHomeScreen = isIOS() && !isStandalone()

  useEffect(() => {
    currentSubscription().then((sub) => setEnabled(!!sub))
  }, [])

  async function toggleDevice() {
    setBusy(true)
    setError(null)
    try {
      if (enabled) {
        await disablePush()
        setEnabled(false)
      } else {
        await enablePush()
        setEnabled(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleAlert(key, value) {
    try {
      await saveNotificationPrefs({ [key]: value })
      onChanged()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow">
      <h2 className="font-semibold text-slate-800 mb-3">Notifications</h2>

      {!supported ? (
        <p className="text-sm text-slate-400">
          This browser can't show notifications.
        </p>
      ) : needsHomeScreen ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-3 text-sm">
          To turn on notifications on iPhone, first add this app to your home
          screen (Share → Add to Home Screen), then open it from there.
        </div>
      ) : (
        <>
          <button
            onClick={toggleDevice}
            disabled={busy}
            className={`w-full font-semibold rounded-lg px-4 py-2.5 ${
              enabled
                ? 'border border-slate-300 text-slate-700'
                : 'bg-emerald-700 text-white'
            }`}
          >
            {busy
              ? 'Working…'
              : enabled
              ? 'Turn off notifications on this device'
              : 'Turn on notifications on this device'}
          </button>

          {enabled && (
            <ul className="mt-4 space-y-3">
              {ALERTS.map((a) => (
                <li key={a.key} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-700">{a.label}</p>
                    <p className="text-xs text-slate-400">{a.hint}</p>
                  </div>
                  <input
                    type="checkbox"
                    defaultChecked={settings?.[a.key] ?? false}
                    onChange={(e) => toggleAlert(a.key, e.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
    </section>
  )
}
