// @ts-nocheck
import { useState } from 'react'

const THEMES = [
  { id: 'midnight', label: 'Dark', hint: 'Approved dark' },
  { id: 'clean', label: 'Clean', hint: 'Elegant light' },
  { id: 'cyberpunk', label: 'Cyberpunk', hint: 'Neon dark' },
  { id: 'punk', label: 'Punk', hint: 'Bold & loud' },
]

const OLD = ['aurora', 'dark', 'ivory', 'high-country', 'highcountry', 'high_country']

export default function ThemeCard() {
  const [theme, setTheme] = useState(() => {
    const t = document.documentElement.dataset.theme || 'midnight'
    return OLD.includes(t) ? 'midnight' : t
  })

  function pick(id) {
    document.documentElement.dataset.theme = id
    try {
      localStorage.setItem('budget.theme', id)
    } catch {
      /* ignore */
    }
    setTheme(id)
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <div>
        <h2 className="font-semibold text-slate-800">Theme</h2>
        <p className="text-sm text-slate-500">Pick the look — changes instantly.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            className={`rounded-xl border px-3 py-3 text-left transition ${
              theme === t.id
                ? 'border-emerald-500 ring-2 ring-emerald-500'
                : 'border-slate-300'
            }`}
          >
            <div className="font-semibold text-slate-800">{t.label}</div>
            <div className="text-xs text-slate-500">{t.hint}</div>
          </button>
        ))}
      </div>
    </section>
  )
}
