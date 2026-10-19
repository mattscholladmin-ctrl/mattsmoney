// @ts-nocheck
import { isSupabaseConfigured, supabase } from './supabase.js'

const demoKey = (userId) => `mm.demo.preferences:${userId}`
export async function fetchAppPreferences(userId) {
  if (!isSupabaseConfigured) {
    try { return JSON.parse(localStorage.getItem(demoKey(userId)) || 'null') }
    catch { return null }
  }
  const { data, error } = await supabase.from('app_preferences')
    .select('preferences,revision,updated_at').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}
export async function patchAppPreferences(userId, patch, initializeOnly = false) {
  if (!isSupabaseConfigured) {
    const existing = await fetchAppPreferences(userId)
    if (initializeOnly && existing) return existing
    const next = { preferences: { ...(existing?.preferences || {}), ...patch }, revision: Number(existing?.revision || 0) + 1, updated_at: new Date().toISOString() }
    localStorage.setItem(demoKey(userId), JSON.stringify(next))
    return next
  }
  const { data, error } = await supabase.rpc('patch_app_preferences', {
    p_patch: patch, p_initialize_only: initializeOnly,
  })
  if (error) throw error
  if (!data?.[0]) throw new Error('Preferences were not saved. Please sign in again.')
  return data[0]
}
