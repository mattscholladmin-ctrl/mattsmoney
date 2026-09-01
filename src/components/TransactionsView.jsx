// @ts-nocheck
import { useMemo, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { addTransaction, updateTransaction, deleteTransaction, addBalanceEntry, setTransactionCategories, setIncomeSources, incrementGoalCurrent } from '../lib/api'
import { categorySuggestions, sameDepositorUntagged, cashReversal, cleanCategory, cleanCategoriesFor, needsCategory } from '../lib/budget'
import { downloadCSV, printTransactionsPDF } from '../lib/export'
import Modal from './Modal'

// Full, searchable/filterable transaction history with edit + export.
export default function TransactionsView({ transactions = [], categories = [], goals = [], income = [], accounts = [], balances = [], dedupedCount = 0, onChanged }) {
  // Delete a transaction; if it came from a cash account, restore that balance.
  async function removeTxn(t) {
    const rev = cashReversal(t, accounts, balances)
    if (rev) {
      const back = rev.amount >= 0 ? 'added back to' : 'taken back out of'
      if (!window.confirm(`Delete this? ${money(Math.abs(rev.amount))} will be ${back} ${rev.account.name}.`)) return
    }
    await deleteTransaction(t.id)
    if (rev) {
      await addBalanceEntry({
        account_id: rev.account.id,
        balance: rev.restoreTo,
        as_of: isoDate(),
        note: `Reversed: ${t.merchant}`,
      })
    }
    // If this deposit filled a goal bucket, take it back out of the goal too.
    if (t.bucket_goal_id) await incrementGoalCurrent(t.bucket_goal_id, Number(t.amount || 0))
    onChanged()
  }
  // Income-source tags come straight from your income sources (add/edit them in
  // the Income card and they show up here automatically), plus a catch-all.
  const sourceOptions = useMemo(() => {
    const names = income.map((s) => s.name).filter(Boolean)
    return [...new Set([...names, 'Other income'])]
  }, [income])
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('')
  const [editing, setEditing] = useState(null) // transaction row or 'new'
  const [suggesting, setSuggesting] = useState(false) // auto-categorize preview open
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState(null)

  // Confident category guesses for transactions still sitting in "Other".
  const suggestions = useMemo(() => categorySuggestions(transactions), [transactions])

  async function applySuggestions() {
    setApplying(true)
    setApplyError(null)
    try {
      await setTransactionCategories(suggestions)
      setSuggesting(false)
      onChanged()
    } catch (err) {
      setApplyError(err.message || 'Could not apply — try again.')
    } finally {
      setApplying(false)
    }
  }

  // Cleaned category per transaction (raw bank codes → real names), computed once
  // so the list stays fast. Rows/filters/dropdowns all read from this.
  const cleanCat = useMemo(() => cleanCategoriesFor(transactions), [transactions])
  const catOf = (t) => cleanCat[t.id] || cleanCategory(t, transactions)

  // Every category that actually appears (cleaned), plus any real budget
  // categories — drop the bank's raw codes so the dropdown only offers clean names.
  const allCats = useMemo(() => {
    const set = new Set(categories.filter((c) => !needsCategory(c)))
    for (const t of transactions) set.add(catOf(t))
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [transactions, categories, cleanCat])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return transactions.filter((t) => {
      if (cat && catOf(t) !== cat) return false
      if (!q) return true
      const hay = `${t.merchant || ''} ${t.note || ''} ${catOf(t)}`.toLowerCase()
      return hay.includes(q)
    })
  }, [transactions, query, cat, cleanCat])

  const total = useMemo(() => filtered.reduce((s, t) => s + Number(t.amount || 0), 0), [filtered])

  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-5 shadow space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-800">Transactions</h2>
          <div className="flex items-center gap-2 shrink-0">
            {suggestions.length > 0 && (
              <button
                onClick={() => setSuggesting(true)}
                className="text-sm border border-emerald-500 text-emerald-700 font-medium rounded-lg px-3 py-1.5"
              >
                Auto-categorize ({suggestions.length})
              </button>
            )}
            <button
              onClick={() => setEditing('new')}
              className="text-sm bg-emerald-700 text-white font-medium rounded-lg px-3 py-1.5"
            >
              + Add
            </button>
          </div>
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchant, note, or category"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />

        <div className="flex gap-2">
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
          >
            <option value="">All categories</option>
            {allCats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {(query || cat) && (
            <button
              onClick={() => {
                setQuery('')
                setCat('')
              }}
              className="text-sm text-slate-500 px-3"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex justify-between items-center text-sm text-slate-500">
          <span>
            {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
          </span>
          <span className="font-medium text-slate-700">{money(total)}</span>
        </div>
        {dedupedCount > 0 && (
          <p className="text-xs text-slate-400">
            {dedupedCount} likely-duplicate {dedupedCount === 1 ? 'transaction was' : 'transactions were'} auto-merged out of this list — see the guide if one looks wrong.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => downloadCSV(filtered)}
            disabled={filtered.length === 0}
            className="flex-1 border border-slate-300 text-slate-700 font-medium rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            onClick={() => printTransactionsPDF(filtered)}
            disabled={filtered.length === 0}
            className="flex-1 border border-slate-300 text-slate-700 font-medium rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          >
            Export PDF
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-5 shadow">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400">No matching transactions.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((t) => (
              <li key={t.id} className="flex justify-between items-center py-2.5 gap-2">
                <div className="min-w-0 flex-1">
                  <button onClick={() => setEditing(t)} className="text-left w-full block">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 text-sm text-slate-800 truncate">{t.merchant}</span>
                      {t.pending && (
                        <span className="shrink-0 text-[0.65rem] font-medium text-amber-700 bg-amber-100 rounded px-1.5 py-px">
                          pending
                        </span>
                      )}
                    </span>
                    <p className="text-xs text-slate-400">
                      {shortDate(t.txn_date)}
                      {t.pending ? ' · not final yet' : ''}
                    </p>
                  </button>
                  {/* Change category inline without opening the editor */}
                  <select
                    value={catOf(t)}
                    onChange={async (e) => {
                      await updateTransaction(t.id, { category: e.target.value })
                      onChanged()
                    }}
                    className="mt-1 text-xs rounded border border-slate-200 bg-white text-slate-600 px-1.5 py-0.5 max-w-[11rem]"
                  >
                    {!allCats.includes(catOf(t)) && (
                      <option value={catOf(t)}>{catOf(t)}</option>
                    )}
                    {allCats.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {/* Money in: tag which income source it came from. */}
                  {Number(t.amount) < 0 && (
                    <select
                      value={t.income_source || ''}
                      onChange={async (e) => {
                        const source = e.target.value
                        await updateTransaction(t.id, { income_source: source })
                        // Same depositor, still untagged → tag them all the same
                        // way, past and (via sync learning) future.
                        if (source) {
                          await setIncomeSources(
                            sameDepositorUntagged(transactions, t.merchant, t.id),
                            source
                          )
                        }
                        onChanged()
                      }}
                      className="mt-1 ml-1 text-xs rounded border border-emerald-200 bg-white text-emerald-700 px-1.5 py-0.5 max-w-[11rem]"
                    >
                      <option value="">+ income source</option>
                      {t.income_source && !sourceOptions.includes(t.income_source) && (
                        <option value={t.income_source}>{t.income_source}</option>
                      )}
                      {sourceOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex items-center gap-3 pl-1 shrink-0">
                  <span className="text-sm text-slate-700">{money(t.amount)}</span>
                  <button
                    onClick={() => removeTxn(t)}
                    className="text-xs text-slate-300 hover:text-red-600"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <EditTransactionModal
          txn={editing === 'new' ? null : editing}
          categories={allCats}
          goals={goals}
          sourceOptions={sourceOptions}
          transactions={transactions}
          accounts={accounts}
          balances={balances}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}

      {suggesting && (
        <Modal title="Auto-categorize" onClose={() => !applying && setSuggesting(false)}>
          <p className="text-sm text-slate-600 mb-3">
            Found <span className="font-medium text-slate-800">{suggestions.length}</span>{' '}
            {suggestions.length === 1 ? 'transaction' : 'transactions'} I can categorize from
            your history and the merchant names. Review and apply:
          </p>
          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 mb-4">
            {suggestions.map((s) => (
              <li key={s.id} className="flex justify-between items-center gap-2 py-2 text-sm">
                <span className="min-w-0 text-slate-700 truncate">{s.merchant || 'Transaction'}</span>
                <span className="text-slate-400 shrink-0">
                  {s.from || 'Other'} <span className="text-emerald-700">→ {s.to}</span>
                </span>
              </li>
            ))}
          </ul>
          {applyError && <p className="text-sm text-red-600 mb-3">{applyError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => setSuggesting(false)}
              disabled={applying}
              className="flex-1 border border-slate-300 text-slate-700 font-medium rounded-lg px-4 py-2.5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={applySuggestions}
              disabled={applying}
              className="flex-1 bg-emerald-700 text-white font-semibold rounded-lg px-4 py-2.5 disabled:opacity-50"
            >
              {applying ? 'Applying…' : `Apply all (${suggestions.length})`}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function EditTransactionModal({ txn, categories, goals = [], sourceOptions = [], transactions = [], accounts = [], balances = [], onClose, onSaved }) {
  const isNew = !txn
  // If this was a cash purchase (paid from a manual account), keep that account's
  // balance in sync when the amount changes here — the note carries which one.
  const cashLink = txn ? cashReversal(txn, accounts, balances) : null
  const [txnDate, setTxnDate] = useState(txn?.txn_date || isoDate())
  const [merchant, setMerchant] = useState(txn?.merchant || '')
  const [amount, setAmount] = useState(txn ? String(Math.abs(Number(txn.amount))) : '')
  const [category, setCategory] = useState(txn ? cleanCategory(txn) : '')
  const [note, setNote] = useState(txn?.note || '')
  const [goalId, setGoalId] = useState(txn?.goal_id || '')
  // Money in (a deposit, amount < 0) or money out? Drives the amount's sign so
  // Matt never has to type a negative number.
  const [moneyIn, setMoneyIn] = useState(txn ? Number(txn.amount) < 0 : false)
  const [incomeSource, setIncomeSource] = useState(txn?.income_source || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // amount is entered as a plain positive number; sign comes from moneyIn.
      const magnitude = Math.abs(Number(amount))
      const newSigned = moneyIn ? -magnitude : magnitude
      // A cash transaction keeps its "Paid with / Deposited to" tag (regenerated
      // in case the in/out direction flipped) so the link survives the edit.
      const note0 = cashLink
        ? `${moneyIn ? 'Deposited to' : 'Paid with'} ${cashLink.account.name}`
        : note.trim() || null
      const fields = {
        txn_date: txnDate,
        merchant: merchant.trim(),
        amount: newSigned,
        category: category.trim() || 'Uncategorized',
        note: note0,
        goal_id: goalId || null,
        income_source: moneyIn ? incomeSource || null : null,
      }
      if (isNew) await addTransaction(fields)
      else await updateTransaction(txn.id, fields)
      // Move the cash account by however much the amount changed.
      if (cashLink) {
        const delta = cashLink.amount - newSigned
        if (delta !== 0) {
          await addBalanceEntry({
            account_id: cashLink.account.id,
            balance: Number((cashLink.account.balance + delta).toFixed(2)),
            as_of: isoDate(),
            note: `Adjusted: ${fields.merchant}`,
          })
        }
      }
      if (moneyIn && incomeSource) {
        await setIncomeSources(
          sameDepositorUntagged(transactions, fields.merchant, txn?.id || null),
          incomeSource
        )
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={isNew ? 'Add transaction' : 'Edit transaction'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-slate-700">
        <div>
          <label className="block text-sm font-medium mb-1">Merchant</label>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            required
            autoFocus
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            placeholder="e.g. King Soopers"
          />
        </div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
              placeholder="0.00"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              required
              value={txnDate}
              onChange={(e) => setTxnDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">This is</label>
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            <button
              type="button"
              onClick={() => setMoneyIn(false)}
              className={`flex-1 px-3 py-2 text-sm font-medium ${
                !moneyIn ? 'bg-slate-800 text-white' : 'bg-white text-slate-600'
              }`}
            >
              Money out
            </button>
            <button
              type="button"
              onClick={() => setMoneyIn(true)}
              className={`flex-1 px-3 py-2 text-sm font-medium ${
                moneyIn ? 'bg-emerald-700 text-white' : 'bg-white text-slate-600'
              }`}
            >
              Money in
            </button>
          </div>
        </div>
        {moneyIn && (
          <div>
            <label className="block text-sm font-medium mb-1">Income source</label>
            <select
              value={incomeSource}
              onChange={(e) => setIncomeSource(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="">— pick a source —</option>
              {incomeSource && !sourceOptions.includes(incomeSource) && (
                <option value={incomeSource}>{incomeSource}</option>
              )}
              {sourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">
              Add or rename sources in the Income card — they show up here automatically.
            </p>
          </div>
        )}
        {!moneyIn && (
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="txn-category-options"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
              placeholder="e.g. Groceries"
            />
            <datalist id="txn-category-options">
              {categories.filter((c) => !needsCategory(c)).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
        )}
        {!moneyIn && goals.length > 0 && (
          <div>
            <label className="block text-sm font-medium mb-1">Counts toward goal (optional)</label>
            <select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="">— none —</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {cashLink ? (
          <div className="rounded-lg bg-slate-100 border border-slate-200 p-3 text-sm">
            <span className="text-slate-600">
              Paid from <span className="font-medium text-slate-800">{cashLink.account.name}</span>.
              Change the amount above and that balance stays in sync. To unlink it,
              delete this and re-add it.
            </span>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2.5"
        >
          {busy ? 'Saving…' : isNew ? 'Save transaction' : 'Save changes'}
        </button>
      </form>
    </Modal>
  )
}
