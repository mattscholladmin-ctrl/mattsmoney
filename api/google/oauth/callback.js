// Step 2: Google redirects the browser here with ?code & ?state after the user
// approves. We verify the state, swap the code for tokens, store them, then
// bounce the browser back into the app.
import {
  verifyState,
  exchangeCode,
  fetchUserEmail,
  saveConnection,
  getConnection,
} from '../../../src/lib/googleServer.js'

function back(res, status) {
  res.setHeader('Location', `/?google=${status}`)
  return res.status(302).end()
}

export default async function handler(req, res) {
  const { code, state, error } = req.query || {}
  if (error) return back(res, 'error')

  const uid = verifyState(state)
  if (!uid || !code) return back(res, 'error')

  try {
    const tokens = await exchangeCode(code)
    const email = await fetchUserEmail(tokens.access_token)
    const expiry = new Date(
      Date.now() + (tokens.expires_in || 3600) * 1000
    ).toISOString()

    // Google only returns a refresh_token on first consent; keep the existing
    // one if this is a re-connect that didn't include a fresh one.
    const existing = await getConnection(uid)
    const refresh_token =
      tokens.refresh_token || existing?.refresh_token || null

    await saveConnection(uid, {
      email,
      access_token: tokens.access_token,
      refresh_token,
      expiry,
      scope: tokens.scope || null,
      // Preserve toggles on re-connect; default push on / pull off for new.
      push_enabled: existing?.push_enabled ?? true,
      pull_enabled: existing?.pull_enabled ?? false,
    })

    return back(res, 'connected')
  } catch (e) {
    return back(res, 'error')
  }
}
