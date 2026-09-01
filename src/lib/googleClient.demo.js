// @ts-nocheck
let connected = true;
let push = true;
let pull = true;

export async function googleStatus() {
  return {
    connected,
    email: connected ? "matt@gmail.com" : null,
    push_enabled: push,
    pull_enabled: pull,
  };
}

export async function connectGoogle() {
  connected = true;
}

export async function setGoogleToggles(fields = {}) {
  if (fields.push_enabled != null) push = !!fields.push_enabled;
  if (fields.pull_enabled != null) pull = !!fields.pull_enabled;
  return { connected, push_enabled: push, pull_enabled: pull };
}

export async function disconnectGoogle() {
  connected = false;
  return { ok: true };
}

export async function syncGoogle() {
  return { pushed: 4, pulled: 2, push_enabled: push, pull_enabled: pull };
}

export async function googleEvents() {
  const iso = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString();
  };
  return {
    events: [
      { id: "e1", summary: "Rent due", start: iso(2) },
      { id: "e2", summary: "Payday", start: iso(1) },
    ],
  };
}
