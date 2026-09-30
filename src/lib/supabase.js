// @ts-nocheck
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = false // TEMP visual-verify: force demo mode

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null
