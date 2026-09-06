// @ts-nocheck
// In-memory store for the preview mock. Same function names as the live
// Supabase API so every screen stays interactive.
import { demoData } from "./demoData";
import { isoDate } from "./format";

const KEY = "budget.demoStore.v3";

function nid() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return demoData();
}

let store = null;
function get() {
  if (!store) store = loadStore();
  return store;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}
function list(key) {
  const s = get();
  if (!Array.isArray(s[key])) s[key] = [];
  return s[key];
}
function add(key, row) {
  const rec = { id: nid(), ...row };
  list(key).push(rec);
  save();
  return rec;
}
function upd(key, id, patch) {
  const arr = list(key);
  const i = arr.findIndex((x) => String(x.id) === String(id));
  if (i >= 0) arr[i] = { ...arr[i], ...patch };
  save();
  return i >= 0 ? arr[i] : null;
}
function del(key, id) {
  const s = get();
  s[key] = list(key).filter((x) => String(x.id) !== String(id));
  save();
}

export async function fetchAll() {
  return structuredClone(get());
}

export async function addSetAside({ name, amount, due_date }) {
  add("setAsides", { name, amount: Number(amount) || 0, due_date: due_date || null });
}
export async function removeSetAside(id) {
  del("setAsides", id);
}

export async function addBalanceEntry({ account_id, balance, as_of, note }) {
  add("balances", {
    account_id: account_id || null,
    balance: Number(balance) || 0,
    as_of: as_of || isoDate(),
    note: note || "Balance update",
    created_at: new Date().toISOString(),
  });
}

export async function adjustAccountBalance(accountId, delta, { as_of, note } = {}) {
  const s = get();
  const latest = [...(s.balances || [])]
    .filter((b) => b.account_id === accountId)
    .sort((a, b) => (a.as_of < b.as_of ? 1 : a.as_of > b.as_of ? -1 : 0))[0];
  const cur = Number(latest?.balance || 0);
  await addBalanceEntry({
    account_id: accountId,
    balance: Number((cur + Number(delta || 0)).toFixed(2)),
    as_of: as_of || isoDate(),
    note: note || "Adjustment",
  });
}

export async function addAccount({ name, kind, sort_order, include_in_spendable }) {
  add("accounts", {
    name,
    kind: kind || "spending",
    sort_order: sort_order ?? list("accounts").length + 1,
    include_in_spendable: include_in_spendable ?? kind !== "savings",
    manual: true,
  });
}
export async function updateAccount(id, { name, kind, include_in_spendable, hidden }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (kind !== undefined) patch.kind = kind || "spending";
  if (include_in_spendable !== undefined) patch.include_in_spendable = include_in_spendable;
  if (hidden !== undefined) patch.hidden = hidden;
  upd("accounts", id, patch);
}
export async function setAccountOrder(ids = []) {
  ids.forEach((id, i) => upd("accounts", id, { sort_order: i + 1 }));
}
export async function deleteAccount(id) {
  del("accounts", id);
}

export async function addTransaction({
  txn_date,
  merchant,
  amount,
  category,
  note,
  goal_id,
  income_source,
  account_id,
  bucket_goal_id,
}) {
  add("transactions", {
    txn_date,
    merchant,
    amount,
    category,
    note: note || null,
    goal_id: goal_id || null,
    income_source: income_source || null,
    account_id: account_id || null,
    bucket_goal_id: bucket_goal_id || null,
  });
}
export async function updateTransaction(id, fields) {
  const patch = {};
  for (const k of ["txn_date", "merchant", "amount", "category", "note", "goal_id", "income_source"]) {
    if (fields[k] !== undefined) patch[k] = fields[k] || (k === "note" || k === "goal_id" || k === "income_source" ? null : fields[k]);
  }
  upd("transactions", id, patch);
}
export async function deleteTransaction(id) {
  del("transactions", id);
}
export async function setTransactionCategories(updates = []) {
  for (const { id, to } of updates) upd("transactions", id, { category: to });
}
export async function setIncomeSources(ids = [], source) {
  for (const id of ids) upd("transactions", id, { income_source: source });
}

export async function addBill({ name, amount, category, cadence, due_day, smooth, start_date }) {
  add("bills", {
    name,
    amount: Number(amount) || 0,
    category: category || null,
    cadence: cadence || "monthly",
    due_day: due_day ?? null,
    start_date: start_date || null,
    active: true,
    smooth: !!smooth,
  });
}
export async function updateBill(id, fields) {
  upd("bills", id, fields);
}
export async function deleteBill(id) {
  del("bills", id);
}
export async function setBillSmooth(id, smooth) {
  upd("bills", id, { smooth: !!smooth, smooth_since: smooth ? isoDate() : null });
}
export async function setDebtSmooth(id, smooth) {
  upd("debts", id, { smooth: !!smooth, smooth_since: smooth ? isoDate() : null });
}
export async function setDebtActive(id, active) {
  upd("debts", id, { active: !!active });
}

export async function moveToSmoothing({
  table,
  id,
  amount,
  currentSaved = 0,
  fromAccountId,
  toAccountId,
  dir = 1,
}) {
  const key = table === "debts" ? "debts" : "bills";
  const nextSaved = Math.max(0, Number(currentSaved) + dir * Number(amount || 0));
  upd(key, id, { smooth_saved: nextSaved });
  if (fromAccountId) await adjustAccountBalance(fromAccountId, -dir * amount, { note: "Smoothing move" });
  if (toAccountId) await adjustAccountBalance(toAccountId, dir * amount, { note: "Smoothing move" });
}

export async function upsertBudget({ category, monthly_limit }) {
  const existing = list("budgets").find(
    (b) => (b.category || "").toLowerCase() === String(category || "").toLowerCase(),
  );
  if (existing) upd("budgets", existing.id, { monthly_limit: Number(monthly_limit) || 0 });
  else add("budgets", { category, monthly_limit: Number(monthly_limit) || 0 });
}
export async function deleteBudget(id) {
  del("budgets", id);
}
export async function renameBudget(id, category) {
  upd("budgets", id, { category });
}
export async function setTransactionsCategory(ids = [], category) {
  for (const id of ids) upd("transactions", id, { category });
}
export async function upsertCategoryAlias(from_name, to_name) {
  const existing = list("categoryAliases").find((a) => a.from_name === from_name);
  if (existing) upd("categoryAliases", existing.id, { to_name });
  else add("categoryAliases", { from_name, to_name });
}

export async function saveSettings({ buffer_floor }) {
  const s = get();
  s.settings = { ...(s.settings || {}), buffer_floor };
  save();
}
export async function saveNotificationPrefs(prefs) {
  const s = get();
  s.settings = { ...(s.settings || {}), ...prefs };
  save();
}
export async function addPushSubscription() {}
export async function removePushSubscription() {}

export async function addIncome({ name, amount, cadence, anchor_date, due_day, confirmed }) {
  add("income", {
    name,
    amount: Number(amount) || 0,
    cadence: cadence || "monthly",
    anchor_date: anchor_date || null,
    due_day: due_day ?? null,
    confirmed: confirmed !== false,
  });
}
export async function updateIncome(id, fields) {
  upd("income", id, fields);
}
export async function deleteIncome(id) {
  del("income", id);
}

export async function addGoal({
  name,
  target,
  current,
  monthly_contribution,
  note,
  target_date,
  status,
  account_id,
}) {
  add("goals", {
    name,
    target: Number(target) || 0,
    current: Number(current) || 0,
    monthly_contribution: monthly_contribution || 0,
    note: note || null,
    target_date: target_date || null,
    status: status || "active",
    account_id: account_id || null,
    reserved: true,
    sort_order: list("goals").length + 1,
  });
}
export async function updateGoalCurrent(id, current) {
  upd("goals", id, { current: Number(current) || 0 });
}
export async function setGoalReserved(id, reserved, { pace_since } = {}) {
  const patch = { reserved: !!reserved };
  if (pace_since) patch.pace_since = pace_since;
  upd("goals", id, patch);
}
export async function incrementGoalCurrent(id, delta) {
  const g = list("goals").find((x) => String(x.id) === String(id));
  if (!g) return;
  upd("goals", id, { current: Number(g.current || 0) + Number(delta || 0) });
}
export async function decrementDebtBalance(id, delta) {
  const d = list("debts").find((x) => String(x.id) === String(id));
  if (!d) return;
  upd("debts", id, { balance: Math.max(0, Number(d.balance || 0) - Number(delta || 0)) });
}
export async function addDebtPayment({ debt_id, amount, paid_on, note, bankLinked }) {
  add("debtPayments", {
    debt_id,
    amount: Number(amount) || 0,
    paid_on: paid_on || isoDate(),
    note: note || null,
  });
  if (!bankLinked) await decrementDebtBalance(debt_id, amount);
}
export async function deleteDebtPayment(id, { bankLinked } = {}) {
  const p = list("debtPayments").find((x) => String(x.id) === String(id));
  del("debtPayments", id);
  if (p && !bankLinked) {
    const d = list("debts").find((x) => String(x.id) === String(p.debt_id));
    if (d) upd("debts", d.id, { balance: Number(d.balance || 0) + Number(p.amount || 0) });
  }
}
export async function updateGoal(id, fields) {
  upd("goals", id, fields);
}
export async function deleteGoal(id) {
  del("goals", id);
}

export async function addDebt(fields) {
  add("debts", { active: true, ...fields });
}
export async function updateDebtBalance(id, balance) {
  upd("debts", id, { balance: Number(balance) || 0 });
}
export async function updateDebtCredit(id, fields) {
  upd("debts", id, fields);
}
export async function addCreditScore(row) {
  add("creditScores", row);
}
export async function deleteCreditScore(id) {
  del("creditScores", id);
}
export async function toggleMilestone(id, achieved) {
  const m = list("creditMilestones").find((x) => String(x.id) === String(id));
  if (m) upd("creditMilestones", id, { achieved });
  else add("creditMilestones", { id, achieved });
}
export async function toggleCreditTask(id, done) {
  const t = list("creditTasks").find((x) => String(x.id) === String(id));
  if (t) upd("creditTasks", id, { done });
  else add("creditTasks", { id, done });
}
export async function updateDebt(id, fields) {
  upd("debts", id, fields);
}
export async function deleteDebt(id) {
  del("debts", id);
}

export async function addPhase(row) {
  add("phases", row);
}
export async function updatePhase(id, fields) {
  upd("phases", id, fields);
}
export async function deletePhase(id) {
  del("phases", id);
}
export async function addBucket(row) {
  add("buckets", row);
}
export async function updateBucketCurrent(id, current) {
  upd("buckets", id, { current });
}
export async function deleteBucket(id) {
  del("buckets", id);
}
