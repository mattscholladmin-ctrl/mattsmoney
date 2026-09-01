// @ts-nocheck
// Browser-side calls to the Plaid serverless endpoints. Carries the user's
// Supabase session token, same as googleClient.
import { supabase } from './supabase'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// All Plaid actions go to the single /api/plaid function, routed by `action`.
async function call(action, extra = {}) {
  const headers = await authHeader()
  headers['Content-Type'] = 'application/json'
  const res = await fetch('/api/plaid', {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...extra }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `request failed (${res.status})`)
  return json
}

// Returns { link_token }
export function createLinkToken() {
  return call('link-token')
}

// Returns { ok, institution, depository, credit }
export function exchangePublicToken(public_token) {
  return call('exchange', { public_token })
}

// Returns { items: [{ item_id, institution, updated_at, accounts: [...] }] }
export function plaidStatus() {
  return call('status')
}

// Re-pull live balances for all connections. Returns { ok, items, synced }
export function refreshPlaid() {
  return call('refresh')
}

export function disconnectPlaid(item_id) {
  return call('disconnect', { item_id })
}
