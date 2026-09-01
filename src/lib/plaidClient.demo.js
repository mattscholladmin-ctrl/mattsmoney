// @ts-nocheck
// Preview mock of Plaid. Settings still shows connected banks (SoFi + Capital
// One) matching demo accounts. Live Link stays on the deployed app.

const DEMO_ITEMS = [
  {
    item_id: "item_sofi",
    institution: "SoFi",
    updated_at: new Date().toISOString(),
    accounts: [
      { name: "SoFi Checking", mask: "2418", type: "depository", current: 1284.56, available: 1284.56, pending: 0 },
      { name: "SoFi Savings", mask: "4495", type: "depository", current: 850, available: 850, pending: 0 },
    ],
  },
  {
    item_id: "item_c1",
    institution: "Capital One",
    updated_at: new Date().toISOString(),
    accounts: [
      { name: "depository Account 8756", mask: "8756", type: "depository", current: 312.4, available: 280.1, pending: 32.3 },
    ],
  },
];

const KEY = "budget.demoPlaidItems";

function getItems() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return DEMO_ITEMS.map((it) => ({ ...it }));
}

function setItems(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

export async function createLinkToken() {
  throw new Error(
    "This preview already has SoFi and Capital One connected. Live bank linking stays on your deployed app."
  );
}

export async function exchangePublicToken() {
  return { ok: true, institution: "Demo Bank", depository: 1, credit: 0 };
}

export async function plaidStatus() {
  return { items: getItems() };
}

export async function refreshPlaid() {
  const items = getItems().map((it) => ({ ...it, updated_at: new Date().toISOString() }));
  setItems(items);
  return { ok: true, items, synced: true };
}

export async function disconnectPlaid(item_id) {
  setItems(getItems().filter((it) => it.item_id !== item_id));
  return { ok: true };
}
