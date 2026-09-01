// @ts-nocheck
// First-run path. A brand-new account otherwise lands on a page of empty tiles
// with no indication of what to do first — and because Safe to spend needs a
// balance, an income source AND bills before it means anything, the order
// genuinely matters. This card lays out that order, tracks progress, and jumps
// you to the right place for each step. It renders ONLY while setup is
// incomplete, so it never touches the layout of an established account.
function Check({ done }) {
  return done ? (
    <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  ) : (
    <span className="shrink-0 w-6 h-6 rounded-full border-2 border-slate-300" />
  )
}

// Scroll a dashboard tile into view and flash it, so "Add your paycheck" lands
// you on the actual control instead of just naming it.
function focusTile(id) {
  const el = document.querySelector(`[data-tile="${id}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('tile-flash')
  setTimeout(() => el.classList.remove('tile-flash'), 2000)
}

export default function SetupGuide({ hasAccounts, hasIncome, hasBills, onGoToBills }) {
  const steps = [
    {
      done: hasAccounts,
      title: 'Add where your money is',
      body: 'Your checking account, savings, cash — whatever holds your money. This is the starting balance everything else works from.',
      action: () => focusTile('accounts'),
      cta: 'Add an account',
    },
    {
      done: hasIncome,
      title: 'Add your paycheck',
      body: "How much you get paid and how often. The app uses this to know when money next comes in, so it can tell you what's safe to spend until then.",
      action: () => focusTile('income'),
      cta: 'Add income',
    },
    {
      done: hasBills,
      title: 'Add your regular bills',
      body: 'Rent, phone, insurance, subscriptions — anything that comes out on a schedule. These get held back so you never spend money that\'s already promised.',
      action: onGoToBills,
      cta: 'Add bills',
    },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const next = steps.find((s) => !s.done)

  return (
    <section className="rounded-2xl bg-white p-5 shadow border-l-4 border-emerald-600">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-slate-800">Let's get you set up</h2>
        <span className="text-xs text-slate-400 shrink-0">{doneCount} of 3 done</span>
      </div>
      <p className="text-sm text-slate-500 mt-1">
        Three things, then your “safe to spend” number starts working. It takes a
        few minutes.
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((s) => {
          const isNext = s === next
          return (
            <li key={s.title} className="flex gap-3">
              <Check done={s.done} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${s.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {s.title}
                </p>
                {isNext && (
                  <>
                    <p className="text-xs text-slate-500 mt-0.5">{s.body}</p>
                    <button
                      type="button"
                      onClick={s.action}
                      className="mt-2 bg-emerald-700 text-white text-sm font-semibold rounded-lg px-3 py-1.5"
                    >
                      {s.cta}
                    </button>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
