// @ts-nocheck
import { useState } from 'react'

const THEMES = [
  { id: 'clean', label: 'Clean', hint: 'Elegant light' },
  { id: 'midnight', label: 'Midnight', hint: 'Elegant dark' },
  { id: 'cyberpunk', label: 'Cyberpunk', hint: 'Neon dark' },
  { id: 'punk', label: 'Punk', hint: 'Bold & loud' },
  { id: 'aurora', label: 'Aurora', hint: 'Dawn sky' },
]

// Theme picker. Sets data-theme on <html> (CSS in index.css reacts) and
// remembers the choice in localStorage (index.html applies it on next load).
export default function ThemeCard() {
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'clean'
  )

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
