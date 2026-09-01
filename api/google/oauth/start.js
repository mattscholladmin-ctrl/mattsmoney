// Step 1 of connecting: the app calls this (with the user's Supabase session
// token in the Authorization header) and gets back a Google consent URL.
// The browser then navigates there. We keep the Supabase token OUT of any URL
// by carrying only a short-lived signed "state" string instead.
import { getUserFromRequest, signState, buildAuthUrl } from '../../../src/lib/googleServer.js'

export default async function handler(req, res) {
  const user = await getUserFromRequest(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const url = buildAuthUrl(signState(user.id))
  return res.status(200).json({ url })
}
