// @ts-nocheck
// Browser-side calls to the Google Calendar serverless endpoints. Each request
// carries the user's Supabase session token so the server knows who they are.
import { supabase } from './supabase'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function call(path, { method = 'GET', body } = {}) {
  const headers = await authHeader()
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

// Returns { connected, email?, push_enabled?, pull_enabled? }
export function googleStatus() {
  return call('/api/google/status')
}

// Kicks off the connect flow: gets a consent URL and navigates to it.
export async function connectGoogle() {
  const { url } = await call('/api/google/oauth/start')
  window.location.href = url
}

export function setGoogleToggles(fields) {
  return call('/api/google/toggle', { method: 'POST', body: fields })
}

export function disconnectGoogle() {
  return call('/api/google/disconnect', { method: 'POST' })
}

// Runs a sync; returns { pushed, pulled, push_enabled, pull_enabled }
export function syncGoogle() {
  return call('/api/google/sync', { method: 'POST' })
}

// Read-only upcoming Google events (when pull is on).
export function googleEvents() {
  return call('/api/google/events')
}
