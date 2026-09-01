// @ts-nocheck
// Server-only helpers for the Google Calendar integration.
// IMPORTANT: only import this from files in /api — it uses secrets
// (service-role key, client secret) and must never reach the browser bundle.
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  upcomingBills,
  upcomingIncome,
  phaseStatus,
  debtsAsBills,
} from './budget.js'
import { isoDate, money, shortDate } from './format.js'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const CALENDARS = 'https://www.googleapis.com/calendar/v3/calendars'
const CAL_LIST = 'https://www.googleapis.com/calendar/v3/users/me/calendarList'
const BUDGET_CAL_NAME = 'Budget'

function eventsUrl(calendarId) {
  return `${CALENDARS}/${encodeURIComponent(calendarId)}/events`
}

// Full calendar scope: needed to CREATE the dedicated "Budget" calendar (the
// narrower calendar.events scope can't make new calendars) and to read the
// user's primary calendar for the pull direction. openid+email name the account.
export const SCOPES = 'openid email https://www.googleapis.com/auth/calendar'

// ---- Supabase (service role — bypasses RLS) --------------------------------
export function adminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// Verify the caller's Supabase session token (sent as a Bearer header) and
// return their user, or null if the token is missing/invalid.
export async function getUserFromRequest(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  const { data, error } = await adminClient().auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

// ---- OAuth "state" signing (HMAC) ------------------------------------------
// Carries the user id through the round-trip to Google without putting the
// Supabase token in any URL. Signed + time-limited so it can't be forged.
function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}
export function signState(uid) {
  const payload = b64url(JSON.stringify({ uid, iat: Date.now() }))
  const sig = crypto
    .createHmac('sha256', process.env.GOOGLE_STATE_SECRET)
    .update(payload)
    .digest('base64url')
  return `${payload}.${sig}`
}
export function verifyState(state) {
  if (!state || !state.includes('.')) return null
  const [payload, sig] = state.split('.')
  const expected = crypto
    .createHmac('sha256', process.env.GOOGLE_STATE_SECRET)
    .update(payload)
    .digest('base64url')
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null
  }
  try {
    const { uid, iat } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!uid || Date.now() - iat > 15 * 60 * 1000) return null // 15 min window
    return uid
  } catch {
    return null
  }
}

// ---- OAuth URLs / token exchange -------------------------------------------
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent', // force refresh token even on re-connect
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`)
  return res.json() // { access_token, refresh_token, expires_in, scope, ... }
}

async function refreshAccessToken(refresh_token) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`refresh failed: ${await res.text()}`)
  return res.json() // { access_token, expires_in, ... } (no new refresh_token)
}

export async function fetchUserEmail(access_token) {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    if (!res.ok) return null
    const j = await res.json()
    return j.email || null
  } catch {
    return null
  }
}

// ---- Connection row helpers ------------------------------------------------
export async function getConnection(uid, db = adminClient()) {
  const { data } = await db
    .from('google_calendar')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle()
  return data || null
}

export async function saveConnection(uid, fields, db = adminClient()) {
  const { error } = await db
    .from('google_calendar')
    .upsert(
      { user_id: uid, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  if (error) throw error
}

// Returns a usable access token for the user, refreshing it if expired.
// Returns null if the user isn't connected or the refresh token is dead.
export async function getValidAccessToken(uid, db = adminClient()) {
  const conn = await getConnection(uid, db)
  if (!conn || !conn.refresh_token) return null

  const stillFresh =
    conn.access_token &&
    conn.expiry &&
    new Date(conn.expiry).getTime() - Date.now() > 60 * 1000
  if (stillFresh) return conn.access_token

  try {
    const t = await refreshAccessToken(conn.refresh_token)
    const expiry = new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString()
    await saveConnection(
      uid,
      { access_token: t.access_token, expiry },
      db
    )
    return t.access_token
  } catch {
    return null
  }
}

// ---- Budget calendar (dedicated, toggleable in Google) ---------------------
// Find the user's "Budget" calendar by name, or create it. Returns its id.
// Requires the full calendar scope (calendar.events alone can't create one).
export async function ensureBudgetCalendar(access_token) {
  const listRes = await fetch(`${CAL_LIST}?maxResults=250&minAccessRole=owner`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (listRes.ok) {
    const j = await listRes.json()
    const found = (j.items || []).find((c) => c.summary === BUDGET_CAL_NAME)
    if (found) return found.id
  }
  const createRes = await fetch(CALENDARS, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: BUDGET_CAL_NAME,
      description: 'Bills, paydays and phase changes from your Budget app',
    }),
  })
  if (!createRes.ok) throw new Error(`create calendar failed: ${await createRes.text()}`)
  const created = await createRes.json()
  return created.id
}

// ---- Calendar event read/write ---------------------------------------------
export async function listUpcomingEvents(access_token, days = 60) {
  const timeMin = new Date().toISOString()
  const timeMax = new Date(Date.now() + days * 86400000).toISOString()
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })
  const res = await fetch(`${eventsUrl('primary')}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!res.ok) throw new Error(`list events failed: ${await res.text()}`)
  const j = await res.json()
  return (j.items || []).map((e) => ({
    id: e.id,
    summary: e.summary || '(no title)',
    date: e.start?.date || e.start?.dateTime || null,
    allDay: Boolean(e.start?.date),
  }))
}

function eventBody({ summary, description, date }) {
  // All-day event. end.date is exclusive, so it's the following day.
  const next = new Date(date + 'T00:00:00Z')
  next.setUTCDate(next.getUTCDate() + 1)
  const endDate = next.toISOString().slice(0, 10)
  return {
    summary,
    description: description || 'Added by Budget',
    start: { date },
    end: { date: endDate },
    transparency: 'transparent',
    reminders: { useDefault: false },
  }
}

export async function createCalendarEvent(access_token, calendarId, fields) {
  const res = await fetch(eventsUrl(calendarId), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody(fields)),
  })
  if (!res.ok) throw new Error(`create event failed: ${await res.text()}`)
  const j = await res.json()
  return j.id
}

export async function updateCalendarEvent(access_token, calendarId, eventId, fields) {
  const res = await fetch(`${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(eventBody(fields)),
  })
  // 404/410 → the user deleted it on Google's side; signal caller to recreate.
  if (res.status === 404 || res.status === 410) return false
  if (!res.ok) throw new Error(`update event failed: ${await res.text()}`)
  return true
}

export async function deleteCalendarEvent(access_token, calendarId, eventId) {
  await fetch(`${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${access_token}` },
  })
}

// ---- Push: budget → dedicated "Budget" calendar ----------------------------
// Shared by the manual "Sync now" endpoint and the daily cron. Builds the
// desired set of events (bills, paydays, phase changes) inside the window and
// creates/updates them on the user's Budget calendar, deduping via the mapping
// table. Returns the number of events pushed.
const PUSH_WINDOW_DAYS = 45

export async function pushBudgetEvents(token, uid, db = adminClient()) {
  const calId = await ensureBudgetCalendar(token)
  const today = isoDate()

  const [bills, debts, income, phases, goals] = await Promise.all([
    db.from('recurring_bills').select('*').eq('user_id', uid),
    db.from('debts').select('*').eq('user_id', uid),
    db.from('income_sources').select('*').eq('user_id', uid),
    db.from('phases').select('*').eq('user_id', uid),
    db.from('goals').select('*').eq('user_id', uid),
  ])

  // Pass goals so debts that already have a payment-plan series aren't billed
  // again on the calendar (matches the dashboard's de-dup).
  const allBills = [...(bills.data || []), ...debtsAsBills(debts.data || [], goals.data || [])]
  const upBills = upcomingBills(allBills, today, PUSH_WINDOW_DAYS)
  const upIncome = upcomingIncome(
    (income.data || []).filter((i) => i.confirmed !== false),
    today,
    PUSH_WINDOW_DAYS
  )

  const desired = []
  for (const b of upBills) {
    desired.push({
      key: `bill:${b.name}:${b.date}`,
      date: b.date,
      summary: `Bill: ${b.name} (${money(b.amount)})`,
      description: `Bill due — added by Budget.`,
    })
  }
  for (const i of upIncome) {
    desired.push({
      key: `income:${i.name}:${i.date}`,
      date: i.date,
      summary: `Payday: ${i.name} (${money(i.amount)})`,
      description: `Expected income — added by Budget.`,
    })
  }
  const ph = phaseStatus(phases.data || [], today)
  if (ph?.next?.starts_on) {
    const d = ph.next.starts_on
    if (d >= today && d <= isoDate(new Date(Date.now() + PUSH_WINDOW_DAYS * 86400000))) {
      desired.push({
        key: `phase:${ph.next.name}:${d}`,
        date: d,
        summary: `Phase change: ${ph.next.name}`,
        description: `Budget phase starts ${shortDate(d)} — added by Budget.`,
      })
    }
  }

  const { data: maps } = await db
    .from('google_event_map')
    .select('*')
    .eq('user_id', uid)
  const byKey = new Map((maps || []).map((m) => [m.source_key, m.google_event_id]))

  let pushed = 0
  for (const ev of desired) {
    try {
      const existingId = byKey.get(ev.key)
      if (existingId) {
        const ok = await updateCalendarEvent(token, calId, existingId, ev)
        if (ok) {
          pushed++
          continue
        }
        // Event deleted on Google's side — fall through to recreate.
      }
      const newId = await createCalendarEvent(token, calId, ev)
      await db.from('google_event_map').upsert(
        {
          user_id: uid,
          source_key: ev.key,
          google_event_id: newId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,source_key' }
      )
      pushed++
    } catch {
      // Skip a single bad event rather than failing the whole sync.
    }
  }
  return pushed
}
