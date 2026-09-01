// @ts-nocheck
import { isSupabaseConfigured } from './supabase.js'
import * as live from './googleClient.live.js'
import * as demo from './googleClient.demo.js'

const api = isSupabaseConfigured ? live : demo

export const googleStatus = (...a) => api.googleStatus(...a)
export const connectGoogle = (...a) => api.connectGoogle(...a)
export const setGoogleToggles = (...a) => api.setGoogleToggles(...a)
export const disconnectGoogle = (...a) => api.disconnectGoogle(...a)
export const syncGoogle = (...a) => api.syncGoogle(...a)
export const googleEvents = (...a) => api.googleEvents(...a)
