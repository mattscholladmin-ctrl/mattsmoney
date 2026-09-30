// @ts-nocheck
// Single Plaid client for Matt's Money.
//
// Backend is chosen once at load:
//   - Supabase configured (production) -> live /api/plaid serverless
//     endpoints, carrying the Supabase session token.
//   - otherwise -> in-memory preview mock with sample connected banks
//     (SoFi + Capital One), local dev only.
import { isSupabaseConfigured, supabase } from './supabase.js'

const useLive = isSupabaseConfigured

// ---- live backend ----
async function liveAuthHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// All Plaid actions go to the single /api/plaid function, routed by `action`.
async function liveCall(action, extra = {}) {
  const headers = await liveAuthHeader()
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

// ---- demo backend (in-memory) ----
const DEMO_ITEMS = [
  {
    item_id: "item_sofi",
    institution: "SoFi",
    updated_at: new Date().toISOString(),
    accounts: [
      { name: "SoFi Checking", mask: "2418", type: "depository", current: 1284.56, available: 1284.56, pending: 0 },
      { name: "SoFi Savings", mask: "4495", type: "depository", current: 850, available: 850, pending: 0 },
    ],
  },
  {
    item_id: "item_c1",
    institution: "Capital One",
    updated_at: new Date().toISOString(),
    accounts: [
      { name: "depository Account 8756", mask: "8756", type: "depository", current: 312.4, available: 280.1, pending: 32.3 },
    ],
  },
];

const DEMO_KEY = "budget.demoPlaidItems";

function demoGetItems() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return DEMO_ITEMS.map((it) => ({ ...it }));
}

function demoSetItems(items) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

async function demoCreateLinkToken() {
  throw new Error(
    "This preview already has SoFi and Capital One connected. Live bank linking stays on your deployed app."
  );
}

async function demoExchangePublicToken() {
  return { ok: true, institution: "Demo Bank", depository: 1, credit: 0 };
}

async function demoPlaidStatus() {
  return { items: demoGetItems() };
}

async function demoRefreshPlaid() {
  const items = demoGetItems().map((it) => ({ ...it, updated_at: new Date().toISOString() }));
  demoSetItems(items);
  return { ok: true, items, synced: true };
}

async function demoDisconnectPlaid(item_id) {
  demoSetItems(demoGetItems().filter((it) => it.item_id !== item_id));
  return { ok: true };
}

// ---- public API ----
// Returns { link_token }
export const createLinkToken = () =>
  useLive ? liveCall('link-token') : demoCreateLinkToken()

// Returns { ok, institution, depository, credit }
export const exchangePublicToken = (public_token) =>
  useLive ? liveCall('exchange', { public_token }) : demoExchangePublicToken(public_token)

// Returns { items: [{ item_id, institution, updated_at, accounts: [...] }] }
export const plaidStatus = () =>
  useLive ? liveCall('status') : demoPlaidStatus()

// Re-pull live balances for all connections. Returns { ok, items, synced }
export const refreshPlaid = () =>
  useLive ? liveCall('refresh') : demoRefreshPlaid()

export const disconnectPlaid = (item_id) =>
  useLive ? liveCall('disconnect', { item_id }) : demoDisconnectPlaid(item_id)
