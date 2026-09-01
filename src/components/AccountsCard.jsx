// @ts-nocheck
import { useEffect, useRef, useState } from 'react'
import { money, shortDate, isoDate } from '../lib/format'
import { accountSummaries, moneyTotals, countsAsSpendable, accountBuckets, bucketReconcile } from '../lib/budget'
import {
  addBalanceEntry,
  addAccount,
  updateAccount,
  deleteAccount,
} from '../lib/api'
import Modal from './Modal'

export default function AccountsCard({ accounts = [], balances = [], debts = [], goals = [], transactions = [], onRefresh, refreshing = false, onChanged }) {
  const [manage, setManage] = useState(false)
  const [focusId, setFocusId] = useState(null)
  // Hidden accounts drop off the tile and out of every total.
  const visible = accounts.filter((a) => !a.hidden)
  const summaries = accountSummaries(visible, balances)
  // All accounts (incl. hidden) with their current balance — the Manage modal
  // edits balances here now that the per-row "Update" button is gone.
  const allSummaries = accountSummaries(accounts, balances)
  const totals = moneyTotals(visible, balances, debts)

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-5 shadow">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-slate-800">Accounts</h2>
          <button
            onClick={() => setManage(true)}
            className="text-sm text-emerald-700 font-medium"
          >
            Add account
          </button>
        </div>
        <p className="text-sm text-slate-500">
          No accounts yet. Add the account(s) you keep money in to start tracking.
        </p>
        {manage && (
          <ManageAccountsModal
            accounts={allSummaries}
            onClose={() => setManage(false)}
            onChanged={onChanged}
          />
        )}
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Accounts</h2>
        <div className="flex items-center gap-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh balances from your banks"
              title="Refresh from your banks"
              className="text-emerald-700 disabled:opacity-50"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={refreshing ? 'animate-spin' : ''}
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <polyline points="21 4 21 10 15 10" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setManage(true)}
            className="text-sm text-emerald-700 font-medium"
          >
            Manage
          </button>
        </div>
      </div>

      <ul className="space-y-2">
        {summaries.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            goals={goals}
            transactions={transactions}
            onOpen={() => {
              setFocusId(a.id)
              setManage(true)
            }}
          />
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-slate-100 space-y-1.5 text-sm">
        <Row label="Total spendable" value={money(totals.spendableCash)} strong />
        {totals.savingsCash > 0 && (
          <Row label="Savings" value={money(totals.savingsCash)} />
        )}
        <Row label="Total cash" value={money(totals.totalCash)} />
        {totals.totalDebt > 0 && (
          <Row label="Total debt" value={`− ${money(totals.totalDebt)}`} muted />
        )}
        <div className="flex justify-between pt-1.5 border-t border-slate-100">
          <span className="text-slate-700 font-medium">Net worth</span>
          <span
            className={`font-bold ${
              totals.netWorth < 0 ? 'text-red-600' : 'text-slate-800'
            }`}
          >
            {money(totals.netWorth)}
          </span>
        </div>
      </div>

      {manage && (
        <ManageAccountsModal
          accounts={allSummaries}
          focusId={focusId}
          onClose={() => {
            setManage(false)
            setFocusId(null)
          }}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}

function Row({ label, value, strong, muted }) {
  return (
    <div className="flex justify-between">
      <span className={muted ? 'text-slate-400' : 'text-slate-600'}>{label}</span>
      <span className={strong ? 'font-semibold text-slate-800' : 'text-slate-700'}>
        {value}
      </span>
    </div>
  )
}

function AccountRow({ account, goals = [], transactions = [], onOpen }) {
  const { tied, allocated } = accountBuckets(account, goals)
  const unassigned = Number(account.balance || 0) - allocated
  // bucketReconcile is the single source of truth for the over-assigned state:
  // it rounds to cents and returns null when the balance covers every bucket, so
  // a sub-cent float mismatch can't render a bogus "$0.00 pending". When buckets
  // hold more than the bank has synced it's Pending (a transfer in flight),
  // Failed (a logged transfer that never showed up), or Over (a data mismatch
  // with no logged transfer).
  const reconcile = bucketReconcile(account, goals, transactions)
  return (
    <li className="-mx-2 px-2 py-0.5">
      <div
        onClick={onOpen}
        className="flex items-center justify-between gap-2 cursor-pointer rounded-lg hover:bg-slate-100/60"
        title="Tap to edit in Manage"
      >
        <div className="min-w-0">
          <p className="text-slate-700">
            {account.name}
            {!countsAsSpendable(account) && (
              <span className="text-xs text-slate-300"> · not spendable</span>
            )}
          </p>
          {account.asOf && (
            <p className="text-xs text-slate-400">
              as of {shortDate(account.asOf)}
              {account.balanceDetail ? ` · ${account.balanceDetail}` : ''}
            </p>
          )}
        </div>
        <span className="font-semibold text-slate-800 shrink-0 pl-2">
          {money(account.balance)}
        </span>
      </div>
      {tied.length > 0 && (
        <div className="mt-1 mb-1 pl-3 border-l-2 border-slate-100 space-y-0.5">
          {tied.map((g) => (
            <div key={g.id} className="flex justify-between text-xs text-slate-500">
              <span className="min-w-0 truncate pr-2">{g.name}</span>
              <span className="shrink-0">{money(Math.max(0, Number(g.current || 0)))}</span>
            </div>
          ))}
          {!reconcile ? (
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Unassigned</span>
              <span className="shrink-0 text-slate-400">{money(Math.max(0, unassigned))}</span>
            </div>
          ) : reconcile.status === 'failed' ? (
            <div className="flex justify-between items-start text-xs gap-2">
              <span className="min-w-0 text-red-600">
                🔴 {money(reconcile.amount)} never arrived
                <span className="block text-red-500/80">
                  {reconcile.days}+ days — check the transfer went through
                </span>
              </span>
              <span className="shrink-0 font-medium text-white bg-red-600 rounded-full px-2 py-0.5 self-start">Failed</span>
            </div>
          ) : reconcile.status === 'unfunded' ? (
            <div className="flex justify-between items-start text-xs gap-2">
              <span className="min-w-0 text-amber-700">
                🟡 {money(reconcile.amount)} over-assigned
                <span className="block text-amber-600/80">
                  saved amount is more than the bank shows
                </span>
              </span>
              <span className="shrink-0 font-medium text-amber-800 bg-amber-100 rounded-full px-2 py-0.5 self-start">Over</span>
            </div>
          ) : (
            <div className="flex justify-between items-start text-xs gap-2">
              <span className="min-w-0 text-amber-700">
                🟡 {money(reconcile.amount)} pending
                <span className="block text-amber-600/80">
                  {account.institution || 'the bank'} catching up{reconcile.since ? ` · moved ${shortDate(reconcile.since)}` : ''}
                </span>
              </span>
              <span className="shrink-0 font-medium text-amber-800 bg-amber-100 rounded-full px-2 py-0.5 self-start">Pending</span>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function ManageAccountsModal({ accounts, focusId = null, onClose, onChanged }) {
  const [busy, setBusy] = useState(false)
  // Physical cash gets its own manual account so wallet money counts in your
  // balances like everything else. One tap creates it; edit the balance here.
  const hasCash = accounts.some((a) => /cash/i.test(a.name || ''))
  async function addCash() {
    setBusy(true)
    try {
      await addAccount({
        name: 'Cash on hand',
        kind: 'spending',
        include_in_spendable: true,
        sort_order: accounts.length + 1,
      })
      await onChanged()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Manage accounts" onClose={onClose}>
      <div className="space-y-3 text-slate-700">
        {accounts.map((a) => (
          <EditAccountForm key={a.id} account={a} autoFocusScroll={a.id === focusId} onChanged={onChanged} />
        ))}
        {!hasCash && (
          <button
            onClick={addCash}
            disabled={busy}
            className="w-full border border-emerald-500 text-emerald-700 font-semibold rounded-lg px-4 py-2.5"
          >
            {busy ? 'Adding…' : '+ Track cash on hand'}
          </button>
        )}
        <div className="pt-3 border-t border-slate-100">
          <AddAccountForm onChanged={onChanged} count={accounts.length} />
        </div>
      </div>
    </Modal>
  )
}

function EditAccountForm({ account, autoFocusScroll = false, onChanged }) {
  const [flash, setFlash] = useState(false)
  const boxRef = useRef(null)
  useEffect(() => {
    if (autoFocusScroll && boxRef.current) boxRef.current.scrollIntoView({ block: 'center' })
  }, [autoFocusScroll])
  const [name, setName] = useState(account.name)
  const [balance, setBalance] = useState(String(account.balance ?? ''))
  const [spendable, setSpendable] = useState(
    account.include_in_spendable ?? account.kind === 'spending'
  )
  const [hidden, setHidden] = useState(!!account.hidden)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      // Only change whether it COUNTS toward spendable — never the account's
      // type. A checking account you exclude is still a checking account;
      // conflating the two used to silently relabel it "savings".
      await updateAccount(account.id, {
        name,
        include_in_spendable: spendable,
        hidden,
      })
      // Record a new balance only if it actually changed.
      if (balance !== '' && Number(balance) !== Number(account.balance ?? 0)) {
        await addBalanceEntry({
          account_id: account.id,
          balance: Number(balance),
          as_of: isoDate(),
          note: 'Balance update',
        })
      }
      await onChanged()
      setFlash(true)
      setTimeout(() => setFlash(false), 1800)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${account.name}"? Its balance history goes too.`))
      return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount(account.id)
      await onChanged()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div
      ref={boxRef}
      className={`rounded-lg border p-3 space-y-2 ${
        autoFocusScroll ? 'border-emerald-400' : 'border-slate-200'
      }`}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <label className="block text-sm text-slate-600">
        Current balance
        <input
          type="number"
          step="0.01"
          inputMode="decimal"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base text-right"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={spendable}
          onChange={(e) => setSpendable(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        Include in spendable balance
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={hidden}
          onChange={(e) => setHidden(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        Hide from accounts list &amp; totals
      </label>
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex-1 text-sm bg-emerald-700 text-white rounded-lg px-3 py-2"
        >
          {busy ? 'Saving…' : flash ? '✓ Saved' : 'Save'}
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="text-sm text-red-600 px-2"
        >
          Delete
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

function AddAccountForm({ onChanged, count }) {
  const [name, setName] = useState('')
  const [spendable, setSpendable] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Decouple type from the spendable toggle (same fix as the edit form):
      // unticking "spendable" must NOT relabel the account "savings".
      await addAccount({
        name,
        kind: 'spending',
        include_in_spendable: spendable,
        sort_order: count + 1,
      })
      await onChanged()
      setName('')
      setSpendable(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <p className="text-sm font-medium">Add an account</p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        placeholder="Account name (e.g. Ally Savings)"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base"
      />
      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={spendable}
          onChange={(e) => setSpendable(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600"
        />
        Include in spendable balance
      </label>
      <button
        type="submit"
        disabled={busy}
        className="w-full text-sm bg-emerald-700 text-white rounded-lg px-4 py-2"
      >
        {busy ? '…' : 'Add account'}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </form>
  )
}
