// @ts-nocheck
import { useState } from 'react'
import { isoDate } from '../lib/format'
import { addTransaction, adjustAccountBalance, incrementGoalCurrent } from '../lib/api'
import { accountSummaries } from '../lib/budget'
import Modal from './Modal'

// Floating "+" button for logging money in or out in as few taps as possible.
export default function QuickAddFab({ categories = [], goals = [], income = [], accounts = [], balances = [], onChanged }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Quick add transaction"
        className="fixed bottom-20 lg:bottom-5 right-5 z-30 w-14 h-14 rounded-full bg-emerald-700 text-white text-3xl leading-none shadow-lg flex items-center justify-center active:scale-95"
      >
        +
      </button>
      {open && (
        <QuickAddModal
          categories={categories}
          goals={goals}
          income={income}
          accounts={accounts}
          balances={balances}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            onChanged()
          }}
        />
      )}
    </>
  )
}

export function QuickAddModal({ categories, goals = [], income = [], accounts = [], balances = [], onClose, onSaved }) {
  const [merchant, setMerchant] = useState('')
  const [amount, setAmount] = useState('')
  const [txnDate, setTxnDate] = useState(isoDate())
  const [category, setCategory] = useState('')
  const [goalId, setGoalId] = useState('')
  const [moneyIn, setMoneyIn] = useState(false)
  const [incomeSource, setIncomeSource] = useState('')
  const [goalBucketId, setGoalBucketId] = useState('')
  // Every account you can attribute money to — banks AND manual (cash) accounts.
  // A manual account has no bank sync, so we adjust its balance ourselves; a bank
  // account already tracks itself, so we just record which one it was.
  const allAccounts = accountSummaries(accounts, balances).filter((a) => !a.hidden)
  const firstManual = allAccounts.find((a) => !a.plaid_account_id)
  const [accountId, setAccountId] = useState(() => {
    try {
      const saved = localStorage.getItem('budget.quickAddAccount')
      if (saved && allAccounts.some((a) => a.id === saved)) return saved
    } catch {
      // ignore storage failures
    }
    // Default to a cash/manual account (the usual reason to add by hand).
    return (firstManual || allAccounts[0] || {}).id || ''
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const sourceOptions = [...new Set([...income.map((s) => s.name).filter(Boolean), 'Other income'])]

  const chosenAccount = allAccounts.find((a) => a.id === accountId) || null
  const chosenIsManual = !!chosenAccount && !chosenAccount.plaid_account_id
  // Money in can fill a goal's "bucket": if goals are assigned to the account you
  // deposited into, offer those; otherwise any savings goal. Debt-payment
  // installments ("X payment 2 of 4") aren't buckets, so leave them out.
  const isSeries = (g) => /\s(?:payment|installment)\s+\d+\s+of\s+\d+$/i.test(String(g.name || ''))
  const fundable = (g) => g.status !== 'done' && !isSeries(g)
  // Only offer goals that live in the chosen account, or aren't tied anywhere —
  // never a goal tied to a DIFFERENT account (its money isn't landing here).
  const bucketGoals = goals.filter((g) => fundable(g) && (!g.account_id || g.account_id === chosenAccount?.id))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    // Plain positive number typed; the in/out toggle sets the sign.
    const magnitude = Math.abs(Number(amount))
    const name = merchant.trim()
    // Step 1 — the transaction itself. If THIS fails, nothing was written, so we
    // leave the form open for a safe retry.
    try {
      await addTransaction({
        txn_date: txnDate,
        merchant: name,
        amount: moneyIn ? -magnitude : magnitude,
        category: moneyIn ? 'Income' : category.trim() || 'Uncategorized',
        note: chosenAccount ? `${moneyIn ? 'Deposited to' : 'Paid with'} ${chosenAccount.name}` : null,
        goal_id: moneyIn ? null : goalId || null,
        income_source: moneyIn ? incomeSource || null : undefined,
        // Real links (not just the note) so a later delete reverses the right
        // account balance and un-fills the right goal bucket.
        account_id: chosenAccount?.id,
        bucket_goal_id: moneyIn && goalBucketId ? goalBucketId : undefined,
      })
    } catch (err) {
      setError(err.message)
      setBusy(false)
      return
    }
    // Step 2 — side effects (balance adjust, bucket fill). The transaction is
    // already saved, so a failure here must NOT re-run step 1 (that would
    // duplicate the transaction). Best-effort; close the form either way.
    try {
      if (chosenIsManual) {
        // Live-read adjust (not chosenAccount.balance, a stale snapshot) so two
        // quick entries in a row can't clobber each other's balance change.
        await adjustAccountBalance(chosenAccount.id, moneyIn ? magnitude : -magnitude, {
          as_of: isoDate(),
          note: `${moneyIn ? 'Received' : 'Spent'}: ${name}`,
        })
      }
      if (moneyIn && goalBucketId) {
        const g = bucketGoals.find((x) => x.id === goalBucketId)
        if (g) await incrementGoalCurrent(g.id, magnitude)
      }
      if (chosenAccount) localStorage.setItem('budget.quickAddAccount', chosenAccount.id)
    } catch (err) {
      // The transaction is saved; a follow-up step didn't land. Don't block.
      console.error('Quick add: a follow-up step failed after saving the transaction', err)
    }
    onSaved()
  }

  return (
    <Modal title="Quick add" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-slate-700">
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
        <div className="flex gap-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            autoFocus
            placeholder="0.00"
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            required
            placeholder={moneyIn ? 'From (e.g. client, refund)' : 'Merchant'}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base"
          />
        </div>
        <input
          type="date"
          value={txnDate}
          onChange={(e) => setTxnDate(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
        />
        {allAccounts.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">
              {moneyIn ? 'Deposited to' : 'Paid with'}
            </label>
            <select
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value)
                setGoalBucketId('')
              }}
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              {allAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              {chosenIsManual
                ? `${chosenAccount.name}'s balance updates automatically.`
                : `${chosenAccount?.name || 'Bank accounts'} tracks itself from your bank — recorded here so nothing goes untracked.`}
            </p>
          </div>
        )}
        {moneyIn ? (
          <>
            <select
              value={incomeSource}
              onChange={(e) => setIncomeSource(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
            >
              <option value="">Income source (optional)</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {bucketGoals.length > 0 && (
              <select
                value={goalBucketId}
                onChange={(e) => setGoalBucketId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
              >
                <option value="">Fill a goal's bucket? (optional)</option>
                {bucketGoals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : (
          <>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              list="quickadd-category-options"
              placeholder="Category (optional)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
            />
            <datalist id="quickadd-category-options">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            {goals.length > 0 && (
              <select
                value={goalId}
                onChange={(e) => setGoalId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base bg-white"
              >
                <option value="">Counts toward a goal? (optional)</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <p className="text-xs text-slate-400">Edit later in Transactions if needed.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2.5"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
    </Modal>
  )
}
