// @ts-nocheck
import { addPushSubscription, removePushSubscription } from './api'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

// iOS only allows web push when the app is installed to the home screen.
export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

// iPhone/iPad — these are the only devices that require the home-screen install
// before notifications can be turned on. Everything else (desktop) works as-is.
export function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Returns the current subscription on this device (or null).
export async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

// Ask permission, subscribe this device, and store it in Supabase.
export async function enablePush() {
  if (!pushSupported()) {
    throw new Error('This device or browser does not support notifications.')
  }
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('Notifications are not configured yet.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications were not allowed. You can enable them in your phone settings.')
  }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    })
  }
  const json = sub.toJSON()
  await addPushSubscription({
    endpoint: sub.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  })
  return sub
}

// Unsubscribe this device and remove it from Supabase.
export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await removePushSubscription(sub.endpoint)
  await sub.unsubscribe()
}
