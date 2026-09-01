// @ts-nocheck
import { useState, useCallback, useEffect } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import {
  createLinkToken,
  exchangePublicToken,
  plaidStatus,
  refreshPlaid,
  disconnectPlaid,
} from '../lib/plaidClient'
import { shortDate, money } from '../lib/format'

const LS_TOKEN = 'plaid.link_token'

export default function ConnectBankCard({ onChanged }) {
  const [linkToken, setLinkToken] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const { items } = await plaidStatus()
      setItems(items || [])
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // OAuth banks bounce out and back with ?oauth_state_id=... — resume with the
  // token we stashed before leaving.
  const isOAuthReturn =
    typeof window !== 'undefined' &&
    window.location.search.includes('oauth_state_id')

  useEffect(() => {
    if (isOAuthReturn) {
      const saved = localStorage.getItem(LS_TOKEN)
      if (saved) {
        setBusy(true)
        setLinkToken(saved)
      }
    }
  }, [isOAuthReturn])

  const start = async () => {
    setError(null)
    setBusy(true)
    try {
      const { link_token } = await createLinkToken()
      localStorage.setItem(LS_TOKEN, link_token)
      setLinkToken(link_token)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const onSuccess = useCallback(
    async (public_token) => {
      try {
        await exchangePublicToken(public_token)
        localStorage.removeItem(LS_TOKEN)
        window.history.replaceState({}, '', window.location.pathname)
        await loadStatus()
        onChanged?.()
      } catch (e) {
        setError(e.message)
      } finally {
        setBusy(false)
        setLinkToken(null)
      }
    },
    [loadStatus, onChanged]
  )

  const config = {
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      setBusy(false)
      setLinkToken(null)
      localStorage.removeItem(LS_TOKEN)
      if (err) setError(err.display_message || err.error_message || 'Connection cancelled')
    },
  }
  if (isOAuthReturn) config.receivedRedirectUri = window.location.href

  const { open, ready } = usePlaidLink(config)

  useEffect(() => {
    if (linkToken && ready) open()
  }, [linkToken, ready, open])

  const refresh = async () => {
    setError(null)
    setBusy(true)
    try {
      await refreshPlaid()
      await loadStatus()
      onChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (item_id) => {
    setError(null)
    setBusy(true)
    try {
      await disconnectPlaid(item_id)
      await loadStatus()
      onChanged?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl bg-white p-5 shadow space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800">Bank &amp; card connections</h2>
          <p className="text-sm text-slate-500">
            Linked accounts pull balances automatically.
          </p>
        </div>
        {items.length > 0 && (
          <button
            onClick={refresh}
            disabled={busy}
            className="text-sm font-semibold text-emerald-700 disabled:opacity-50"
          >
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {items.map((it) => (
        <div key={it.item_id} className="border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-800">{it.institution || 'Bank'}</p>
              <p className="text-xs text-slate-400">
                {it.updated_at ? `Synced ${shortDate(it.updated_at.slice(0, 10))}` : 'Connected'}
                {it.txnNote ? ` · ${it.txnNote}` : ''}
              </p>
            </div>
            <button
              onClick={() => disconnect(it.item_id)}
              disabled={busy}
              className="text-xs font-semibold text-red-600 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
          <ul className="space-y-1">
            {it.accounts.map((a, i) => (
              <li key={i} className="text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>
                    {a.name}
                    {a.mask ? ` ····${a.mask}` : ''}
                  </span>
                  <span className="text-slate-400">{a.subtype || a.type}</span>
                </div>
                <div className="text-xs text-slate-400">
                  current {a.current != null ? money(a.current) : '—'} · available{' '}
                  {a.available != null ? money(a.available) : '—'} · pending{' '}
                  {a.pending ? money(a.pending) : '—'}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <button
        onClick={start}
        disabled={busy}
        className="w-full rounded-lg bg-emerald-700 text-white font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        {busy ? 'Working…' : items.length ? '+ Connect another' : '+ Connect a bank or card'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
