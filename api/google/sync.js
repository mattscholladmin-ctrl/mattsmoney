// "Sync now": pushes the user's upcoming bills, paydays and phase changes into
// Google Calendar (if push is on), and returns their upcoming Google events
// (if pull is on). Honors each toggle independently.
import {
  getUserFromRequest,
  adminClient,
  getConnection,
  getValidAccessToken,
  listUpcomingEvents,
  pushBudgetEvents,
} from '../../src/lib/googleServer.js'

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const db = adminClient()
  const conn = await getConnection(user.id, db)
  if (!conn || !conn.refresh_token) {
    return res.status(400).json({ error: 'not connected' })
  }

  const token = await getValidAccessToken(user.id, db)
  if (!token) {
    // Refresh token dead/revoked — tell the app to prompt a reconnect.
    return res.status(409).json({ error: 'reconnect_required' })
  }

  let pushed = 0
  let pulled = []

  // ---- Push: budget → calendar --------------------------------------------
  if (conn.push_enabled) {
    pushed = await pushBudgetEvents(token, user.id, db)
  }

  // ---- Pull: calendar → budget --------------------------------------------
  if (conn.pull_enabled) {
    try {
      pulled = await listUpcomingEvents(token, 60)
    } catch {
      pulled = []
    }
  }

  return res.status(200).json({
    ok: true,
    push_enabled: conn.push_enabled,
    pull_enabled: conn.pull_enabled,
    pushed,
    pulled,
  })
}
