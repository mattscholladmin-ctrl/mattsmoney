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
import AccountOrderCard from './AccountOrderCard'

function accountTitle(name, mask) {
  let n = String(name || 'Account').replace(/\s+/g, ' ').trim()
  n = n.replace(/\b(\S+)(?:\s+\1\b)+/gi, '$1')
  n = n.replace(/\bdepository\b/gi, '').replace(/\s+/g, ' ').trim()
  const m = String(mask || '').trim()
  if (m && n.includes(m)) n = n.replaceAll(m, '').replace(/\s+/g, ' ').trim()
  return m ? `${n} ··${m}` : n
}

const LS_TOKEN = 'plaid.link_token'

export default function ConnectBankCard({ onChanged, accounts = [], plain = false, onToggle }) {
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
    <section className={plain ? 'dw-flat' : 'rounded-2xl bg-white p-5 shadow space-y-3'}>
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
        <div key={it.item_id} className="dw-bank">
          <div className="dw-bank-h">
            <div>
              <b>{it.institution || 'Bank'}</b>
              <span>{it.updated_at ? `Synced ${shortDate(it.updated_at.slice(0, 10))}` : 'Connected'}</span>
            </div>
            <button type="button" onClick={() => disconnect(it.item_id)} disabled={busy}>Disconnect</button>
          </div>
          {it.accounts.map((a, i) => {
            const mask = String(a.mask || '').trim()
            const app = accounts.find((x) => mask && (String(x.mask || '') === mask || String(x.name || '').includes(mask)))
            const included = app ? (app.include_in_spendable === true || (app.include_in_spendable == null && app.kind !== 'savings')) && !app.hidden : false
            return (
              <div key={i} className="dw-plan-toggle">
                {app && (
                  <button
                    type="button"
                    className={`dw-switch${included ? ' on' : ''}`}
                    aria-pressed={included}
                    onClick={() => onToggle?.(app.id, !included)}
                  />
                )}
                <span className="grow">
                  <b>{accountTitle(a.name, a.mask)}</b>
                  <em>{app ? (included ? 'In safe to spend' : 'Left out') : (a.subtype || a.type || '')}</em>
                </span>
                <span className="dw-amt">{a.available != null ? money(a.available) : 'No available balance'}</span>
              </div>
            )
          })}
        </div>
      ))}

      {accounts.filter((x) => !items.some((it) => it.accounts.some((a) => {
        const mask = String(a.mask || '').trim()
        return mask && (String(x.mask || '') === mask || String(x.name || '').includes(mask))
      }))).map((a) => {
        const included = (a.include_in_spendable === true || (a.include_in_spendable == null && a.kind !== 'savings')) && !a.hidden
        return (
          <div key={a.id} className="dw-plan-toggle">
            <button
              type="button"
              className={`dw-switch${included ? ' on' : ''}`}
              aria-pressed={included}
              onClick={() => onToggle?.(a.id, !included)}
            />
            <span className="grow">
              <b>{a.name}</b>
              <em>{included ? 'In safe to spend' : 'Left out'}</em>
            </span>
          </div>
        )
      })}

      <button
        onClick={start}
        disabled={busy}
        className="w-full rounded-lg bg-emerald-700 text-white font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        {busy ? 'Working…' : items.length ? '+ Connect another' : '+ Connect a bank or card'}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!plain && <AccountOrderCard accounts={accounts} onChanged={onChanged} embedded />}
    </section>
  )
}
