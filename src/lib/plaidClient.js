// @ts-nocheck
import { isSupabaseConfigured } from './supabase.js'
import * as live from './plaidClient.live.js'
import * as demo from './plaidClient.demo.js'

const api = isSupabaseConfigured ? live : demo

export const createLinkToken = (...a) => api.createLinkToken(...a)
export const exchangePublicToken = (...a) => api.exchangePublicToken(...a)
export const plaidStatus = (...a) => api.plaidStatus(...a)
export const refreshPlaid = (...a) => api.refreshPlaid(...a)
export const disconnectPlaid = (...a) => api.disconnectPlaid(...a)
