// @ts-nocheck
// Single Google client for Matt's Money.
//
// Backend is chosen once at load:
//   - Supabase configured (production) -> live /api/google/* serverless
//     endpoints, carrying the Supabase session token.
//   - otherwise -> in-memory preview mock, local dev only.
import { isSupabaseConfigured, supabase } from './supabase.js'

const useLive = isSupabaseConfigured

// ---- live backend ----
async function liveAuthHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function liveCall(path, { method = 'GET', body } = {}) {
  const headers = await liveAuthHeader()
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || `request failed (${res.status})`)
    err.status = res.status
    err.code = json.error
    throw err
  }
  return json
}

// ---- demo backend (in-memory) ----
let demoConnected = true;
let demoPush = true;
let demoPull = true;

async function demoGoogleStatus() {
  return {
    connected: demoConnected,
    email: demoConnected ? "matt@gmail.com" : null,
    push_enabled: demoPush,
    pull_enabled: demoPull,
  };
}

async function demoConnectGoogle() {
  demoConnected = true;
}

async function demoSetGoogleToggles(fields = {}) {
  if (fields.push_enabled != null) demoPush = !!fields.push_enabled;
  if (fields.pull_enabled != null) demoPull = !!fields.pull_enabled;
  return { connected: demoConnected, push_enabled: demoPush, pull_enabled: demoPull };
}

async function demoDisconnectGoogle() {
  demoConnected = false;
  return { ok: true };
}

async function demoSyncGoogle() {
  return { pushed: 4, pulled: 2, push_enabled: demoPush, pull_enabled: demoPull };
}

async function demoGoogleEvents() {
  const iso = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString();
  };
  return {
    events: [
      { id: "e1", summary: "Rent due", start: iso(2) },
      { id: "e2", summary: "Payday", start: iso(1) },
    ],
  };
}

// ---- public API ----
// Returns { connected, email?, push_enabled?, pull_enabled? }
export const googleStatus = () =>
  useLive ? liveCall('/api/google/status') : demoGoogleStatus()

// Kicks off the connect flow: gets a consent URL and navigates to it.
export const connectGoogle = () =>
  useLive
    ? liveCall('/api/google/oauth/start').then(({ url }) => { window.location.href = url })
    : demoConnectGoogle()

export const setGoogleToggles = (fields) =>
  useLive ? liveCall('/api/google/toggle', { method: 'POST', body: fields }) : demoSetGoogleToggles(fields)

export const disconnectGoogle = () =>
  useLive ? liveCall('/api/google/disconnect', { method: 'POST' }) : demoDisconnectGoogle()

// Runs a sync; returns { pushed, pulled, push_enabled, pull_enabled }
export const syncGoogle = () =>
  useLive ? liveCall('/api/google/sync', { method: 'POST' }) : demoSyncGoogle()

// Read-only upcoming Google events (when pull is on).
export const googleEvents = () =>
  useLive ? liveCall('/api/google/events') : demoGoogleEvents()
