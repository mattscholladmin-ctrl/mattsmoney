// Disconnect: revoke the token at Google (best effort) and delete the stored
// connection so the user can connect a different account cleanly.
import { getUserFromRequest, adminClient, getConnection } from '../../src/lib/googleServer.js'

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const db = adminClient()
  const conn = await getConnection(user.id, db)

  // Best-effort revoke at Google so the grant doesn't linger.
  const token = conn?.refresh_token || conn?.access_token
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      })
    } catch {
      // ignore — we still drop our copy below
    }
  }

  await db.from('google_event_map').delete().eq('user_id', user.id)
  await db.from('google_calendar').delete().eq('user_id', user.id)

  return res.status(200).json({ ok: true })
}
