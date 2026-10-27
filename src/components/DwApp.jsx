// @ts-nocheck
import { useAppPreferences } from "../lib/use-app-preferences.js";
import {
  reviewPatch,
  deferredQueue,
  deferReview,
  filterActivity,
} from "../lib/transaction-review.js";
import { checkPurchase } from "../lib/purchase-check.js";
import ShopPage from "./ShopPage";
import PlanningPanel from "./PlanningPanel.jsx";
import GuideCard from "./GuideCard";
import AppleBillMatcher from "./AppleBillMatcher.jsx";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  updateTransaction,
  addTransaction,
  upsertBudget,
  updateAccount,
  addIncome,
  updateIncome,
  deleteIncome,
  markBillPaid,
  setBillPartial,
  addBill,
  addGoal,
  updateGoal,
  deleteGoal,
  addDebt,
  updateDebt,
  deleteDebt,
  addDebtPayment,
} from "../lib/api";
import { signOut } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import GoogleCalendarCard from "./GoogleCalendarCard";
import { computePaycheckPlan } from "../lib/paycheck-plan";
import { shortDate, isoDate } from "../lib/format";
import ConnectBankCard from "./ConnectBankCard";
import RecurringBillsCard from "./RecurringBillsCard";
import IncomeCard from "./IncomeCard";
import {
  upcomingIncome,
  suggestBillPayment,
  unpaidBills,
  obligationSchedule,
} from "../lib/budget";
import "../dw.css";
import {
  PURPOSES,
  CATEGORY_CATALOG,
  moneyFull,
  moneyCompact,
  monthKeyFrom,
  monthLabel,
  computeProduct,
  insightCards,
  mapCategory,
  isExpense,
  spendAmount,
} from "../lib/dw-product";

const DwContext = createContext(null);

function Icon({ d, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  review: "M4 12.5 9.5 18 20 6.5",
  receipt: "M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
};

const PURPOSE_META = {
  needs: { label: "Needs", color: "#3b82f6" },
  wants: { label: "Wants", color: "#eab308" },
  savings: { label: "Savings", color: "#22c55e" },
  paid: { label: "Reviewed", color: "#9ca3af" },
};

function applyTheme(mode) {
  const root = document.documentElement;
  root.dataset.dw = "1";
  root.dataset.dwtheme = "dark";
}

/* Monthly spending history for Insights (last 6 months, expenses only) */
function monthlyHistory(txns) {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKeyFrom(d);
    const total = (txns || [])
      .filter((t) => {
        const td = String(t.txn_date || "");
        if (!td.startsWith(key)) return false;
        if (t.hidden) return false;
        if (!isExpense(t)) return false;
        const cat = String(t.category || "");
        if (cat === "Transfers" || cat === "Income") return false;
        return true;
      })
      .reduce((s, t) => s + spendAmount(t), 0);
    out.push({ key, label: d.toLocaleString("en-US", { month: "short" }), total });
  }
  return out;
}

function topMerchants(txns, month, n = 5) {
  const map = {};
  for (const t of txns || []) {
    const td = String(t.txn_date || "");
    if (!td.startsWith(month)) continue;
    if (t.hidden) continue;
    if (!isExpense(t)) continue;
    const cat = String(t.category || "");
    if (cat === "Transfers" || cat === "Income") continue;
    const name = t.merchant || "Unknown";
    map[name] = (map[name] || 0) + spendAmount(t);
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, total]) => ({ name, total }));
}

/* Spending within the current paycheck window */
function reviewDate(d) {
  if (!d) return "";
  const iso = String(d).slice(0, 10);
  const dt = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function paycheckWindowSpend(txns, pay) {
  if (!pay || !pay.nextIncome) return 0;
  const end = String(pay.nextIncome.date || "").slice(0, 10);
  const start = pay.prevIncomeDate ? String(pay.prevIncomeDate).slice(0, 10) : null;
  return (txns || [])
    .filter((t) => {
      const td = String(t.txn_date || "").slice(0, 10);
      if (!td || td >= end) return false;
      if (start && td < start) return false;
      if (t.hidden) return false;
      if (!isExpense(t)) return false;
      const cat = String(t.category || "");
      if (cat === "Transfers" || cat === "Income") return false;
      return true;
    })
    .reduce((s, t) => s + spendAmount(t), 0);
}

export default function DwApp({ data, setData, load, session, demo, syncing, refreshError }) {
  const [state, setState, preferenceStatus, retryPreferences] = useAppPreferences(
    session?.user?.id || "demo",
  );
  const [page, setPage] = useState(() => {
    try {
      return localStorage.getItem("mm.dw.page") || "home";
    } catch {
      return "home";
    }
  });
  const [month, setMonth] = useState(() => monthKeyFrom(new Date()));
  const [infoOpen, setInfoOpen] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [filterPurpose, setFilterPurpose] = useState("all");
  const [query, setQuery] = useState("");
  const [reviewMode, setReviewMode] = useState("spend");
  const [billIdx, setBillIdx] = useState(0);
  const [reviewErr, setReviewErr] = useState("");
  const [correctOn, setCorrectOn] = useState(false);
  const [billDraft, setBillDraft] = useState({ name: "", amount: "" });
  const [showAddBill, setShowAddBill] = useState(false);
  const [newBill, setNewBill] = useState({ name: "", amount: "" });
  const [addedBills, setAddedBills] = useState([]);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [txnFront, setTxnFront] = useState([]);
  const [billFront, setBillFront] = useState([]);
  const [reviewHist, setReviewHist] = useState([]);
  const [reviewTotals, setReviewTotals] = useState({ needs: 0, wants: 0, savings: 0 });
  const [activityLimit, setActivityLimit] = useState(120);
  const [activityMonth, setActivityMonth] = useState("");
  const [activityScope, setActivityScope] = useState("spending");
  const [activityCategory, setActivityCategory] = useState("");
  const reviewInFlight = useRef(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [transactionError, setTransactionError] = useState("");

  useEffect(() => {
    applyTheme();
    const fontScale = { s: "1.35", m: "1.56", l: "1.75", xl: "1.93" };
    document.documentElement.style.setProperty("--dw-type", fontScale[state.fs || "m"]);
    delete document.documentElement.dataset.fs;
  }, [state]);
  useEffect(() => {
    try {
      localStorage.setItem("mm.dw.page", page);
    } catch {
      /* ignore */
    }
  }, [page]);

  const product = useMemo(() => computeProduct({ data, state, month }), [data, state, month]);
  const pay = useMemo(() => computePaycheckPlan({ data, state }), [data, state]);
  const upcoming = useMemo(
    () => upcomingIncome(data.income || [], isoDate(), 30, data.transactions || []),
    [data],
  );
  const insights = useMemo(
    () => insightCards(product, month).filter((c) => !state.dismissed?.includes(c.id)),
    [product, month, state.dismissed],
  );
  const history = useMemo(() => monthlyHistory(product.txns), [product.txns]);
  const merchants = useMemo(() => topMerchants(product.txns, month), [product.txns, month]);
  const windowSpend = useMemo(() => paycheckWindowSpend(product.txns, pay), [product.txns, pay]);
  const planRows = pay.planRows;
  const pullTotal = planRows.reduce((s, r) => s + (state.planOff?.[r.id] ? 0 : r.share), 0);
  const spreadOn = state.spreadBills !== false;
  const salaryNames = new Set(
    (data.income || [])
      .filter((s) => s.active !== false && s.confirmed !== false && Number(s.amount) > 0)
      .map((s) => String(s.name || "").toLowerCase()),
  );
  const extraCandidates = (data.transactions || [])
    .filter((t) => {
      const amt = Number(t.amount || 0);
      if (!(amt < 0)) return false;
      const src = String(t.income_source || "").toLowerCase();
      if (src && salaryNames.has(src)) return false;
      const blob = `${t.category || ""} ${t.merchant || ""} ${t.income_source || ""}`;
      if (src) return true;
      return /income|payroll|deposit/i.test(blob);
    })
    .sort((a, b) => String(b.txn_date || "").localeCompare(String(a.txn_date || "")));
  const extra =
    extraCandidates.find(
      (t) => t.income_source && !salaryNames.has(String(t.income_source).toLowerCase()),
    ) ||
    extraCandidates.find((t) => !t.income_source) ||
    null;
  const extraAmt = extra ? Math.abs(Number(extra.amount || 0)) : 0;
  const extraOn = !!(extra && state.extraId === extra.id);
  // Payment state comes from persisted bill occurrences, never a forever-local flag.
  const dueRows = pay.info.windowItems || [];
  const laterRows = pay.info.laterItems || [];
  const safeShown = pay.safeToSpend;
  const [paymentError, setPaymentError] = useState("");
  const payMatch = (() => {
    if (state.matchSkip) return null;
    const bills = [...(pay.info.windowItems || []), ...(pay.info.laterItems || [])];
    for (const b of bills) {
      const txn = suggestBillPayment(
        { name: b.name, amount: b.fullAmount || b.amount, date: b.due || isoDate(), billId: b.id },
        data.transactions || [],
        isoDate(),
      );
      if (txn) return { bill: b, txn };
    }
    return null;
  })();

  async function markPaid(bill) {
    const due = bill.due || isoDate();
    setPaymentError("");
    try {
      await markBillPaid(bill.id, due);
      patchState({ matchSkip: true });
      await load();
      return true;
    } catch (err) {
      setPaymentError(err.message || "Could not save the payment. The bill is still reserved.");
      return false;
    }
  }

  async function logPartial(bill, raw) {
    const add = Number(raw);
    if (!(add > 0)) return false;
    const full = Number(bill.fullAmount || bill.amount || 0);
    const next = Number(bill.partialPaid || 0) + add;
    if (full > 0 && next >= full - 0.009) {
      return await markPaid(bill);
    }
    try {
      await setBillPartial(bill.id, Math.round(next * 100) / 100, bill.due || isoDate());
      load();
      return true;
    } catch {
      return false;
    }
  }

  function currentDue(bill) {
    const rows = [...(pay.info.windowItems || []), ...(pay.info.laterItems || [])];
    const row = rows.find((b) => b.id === bill.id);
    if (row?.due) return row.due;
    return obligationSchedule(bill, isoDate()).next_due || isoDate();
  }

  async function saveReviewedBill(bill) {
    const name = String(bill?.name || "").trim();
    const amount = Number(bill?.amount);
    if (!name || !(amount > 0)) return;
    const existing = (data.bills || []).find(
      (b) =>
        String(b.name || "")
          .trim()
          .toLowerCase() === name.toLowerCase(),
    );
    if (!existing) {
      const day =
        Number(String(bill.latest || isoDate()).slice(8, 10)) || Number(isoDate().slice(8, 10));
      try {
        await addBill({ name, amount, category: "Bills", cadence: "monthly", due_day: day });
      } catch (err) {
        setReviewErr(err.message || "Could not save that bill.");
        return;
      }
    }
    if (bill.id) patchState({ rejectedIdeas: { ...(state.rejectedIdeas || {}), [bill.id]: true } });
    setReviewErr("");
    setBillIdx(0);
    setCorrectOn(false);
    setNewBill({ name: "", amount: "" });
    setShowAddBill(false);
    load();
  }

  function patchState(partial) {
    setState((s) => ({ ...s, ...partial }));
  }

  async function commitReview(transaction, fields, expected) {
    if (reviewInFlight.current) return false;
    reviewInFlight.current = true;
    setReviewBusy(true);
    setTransactionError("");
    try {
      if (Object.keys(fields).length) await updateTransaction(transaction.id, fields, expected);
      setData((current) => ({
        ...current,
        transactions: current.transactions.map((t) =>
          t.id === transaction.id ? { ...t, ...fields } : t,
        ),
      }));
      setState((current) => {
        const meta = { ...current.meta };
        delete meta[transaction.id];
        return { ...current, meta };
      });
      return true;
    } catch (error) {
      setTransactionError(
        error.message || "Could not save this review. Nothing was marked reviewed.",
      );
      return false;
    } finally {
      reviewInFlight.current = false;
      setReviewBusy(false);
    }
  }

  async function classify(t, purpose) {
    const raw = data.transactions.find((row) => row.id === t.id) || t;
    try {
      const { fields, expected } = reviewPatch(raw, { purpose });
      return await commitReview(raw, fields, expected);
    } catch (error) {
      setTransactionError(error.message);
      return false;
    }
  }

  async function setCat(t, category) {
    const raw = data.transactions.find((row) => row.id === t.id) || t;
    try {
      const { fields, expected } = reviewPatch(raw, { category });
      return await commitReview(raw, fields, expected);
    } catch (error) {
      setTransactionError(error.message);
      return false;
    }
  }

  async function setVisibility(t, hidden) {
    const raw = data.transactions.find((row) => row.id === t.id) || t;
    try {
      const { fields, expected } = reviewPatch(raw, { hidden });
      return await commitReview(raw, fields, expected);
    } catch (error) {
      setTransactionError(error.message);
      return false;
    }
  }

  const queue = product.queue;
  const orderedQueue = useMemo(() => deferredQueue(queue, txnFront), [queue, txnFront]);
  const front = orderedQueue[0] || null;

  function parkAtFront(list, index, setFront, setIndex) {
    const item = list[index];
    if (!item || reviewBusy) return;
    setFront((ids) => deferReview(ids, item.id));
    setIndex(0);
  }

  async function goReview(dir) {
    if (!front || reviewBusy) return;
    const raw = data.transactions.find((t) => t.id === front.id) || front;
    const afterNote = reviewPatch(raw, { purpose: dir }).fields.note || raw.note;
    const saved = await classify(front, dir);
    if (!saved) return;
    setReviewHist((h) => [
      ...h,
      {
        id: front.id,
        purpose: dir,
        amount: Math.abs(Number(front.amount || 0)),
        beforeNote: raw.note ?? null,
        afterNote,
      },
    ]);
    setReviewTotals((t) => ({ ...t, [dir]: t[dir] + Math.abs(Number(front.amount || 0)) }));
  }

  function skipReview() {
    parkAtFront(orderedQueue, 0, setTxnFront, setReviewIdx);
  }

  async function undoReview() {
    const last = reviewHist[reviewHist.length - 1];
    if (!last || reviewBusy) return;
    const txn = data.transactions.find((t) => t.id === last.id);
    if (!txn) {
      setTransactionError("That transaction is no longer available. Reload to check it.");
      return;
    }
    const saved = await commitReview(
      txn,
      { note: last.beforeNote },
      { expected_note: last.afterNote ?? null },
    );
    if (!saved) return;
    setReviewHist((h) => h.slice(0, -1));
    setTxnFront((ids) => ids.filter((id) => id !== last.id));
    setReviewTotals((t) => ({ ...t, [last.purpose]: Math.max(0, t[last.purpose] - last.amount) }));
  }

  const billIdeas = useMemo(() => {
    const names = new Set((data.bills || []).map((b) => String(b.name || "").toLowerCase()));
    const groups = {};
    for (const t of data.transactions || []) {
      if (!isExpense(t) || t.hidden || t.pending) continue;
      const name = String(t.merchant || "").trim();
      if (!name || names.has(name.toLowerCase())) continue;
      const key = name.toLowerCase();
      if (!groups[key]) groups[key] = { id: `idea-${key}`, name, charges: [] };
      groups[key].charges.push({
        amount: Math.abs(Number(t.amount || 0)),
        day: String(t.txn_date || "").slice(0, 10),
      });
    }
    const rejected = state.rejectedIdeas || {};
    return Object.values(groups)
      .map((g) => {
        const latest = [...g.charges].sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
        if (!latest) return null;
        const count = g.charges.filter((c) => Math.abs(c.amount - latest.amount) < 0.009).length;
        return {
          id: g.id,
          name: g.name,
          amount: latest.amount,
          latest: latest.day,
          count,
          note: `Seen ${count} times`,
        };
      })
      .filter((g) => g && g.count >= 2 && !rejected[g.id])
      .sort((a, b) => String(a.latest).localeCompare(String(b.latest)));
  }, [data, state.rejectedIdeas]);

  const orderedBills = useMemo(() => deferredQueue(billIdeas, billFront), [billIdeas, billFront]);

  const nav = [
    { id: "home", label: "Home", icon: ICONS.home },
    { id: "insights", label: "Insights", icon: ICONS.chart },
    { id: "activity", label: "Activity", icon: ICONS.grid },
    {
      id: "review",
      label: "Review",
      icon: ICONS.review,
      badge: queue.length + billIdeas.length || null,
    },
    { id: "bills", label: "Bills", icon: ICONS.receipt },
    { id: "shop", label: "Shop", icon: ICONS.receipt },
    { id: "profile", label: "Settings", icon: ICONS.person },
  ];

  /* ================= HOME (paycheck-first overview) ================= */

  /* ================= INSIGHTS (monthly patterns) ================= */

  /* ================= ACTIVITY ================= */
  function weekKey(d) {
    const dt = new Date(d + "T12:00:00");
    const day = (dt.getDay() + 6) % 7;
    dt.setDate(dt.getDate() - day);
    return dt.toISOString().slice(0, 10);
  }
  function weekLabel(key) {
    const start = new Date(key + "T12:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const fmt = (d) => d.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase();
    return `${fmt(start)} – ${fmt(end)}`;
  }

  /* ================= REVIEW (categorize flow) ================= */

  /* ================= BILLS ================= */

  /* ================= PROFILE ================= */

  const context = {
    activityMonth,
    setActivityMonth,
    activityScope,
    setActivityScope,
    activityCategory,
    setActivityCategory,
    setMonth,
    transactionError,
    classify,
    reviewBusy,
    setCat,
    setVisibility,
    pay,
    spreadOn,
    safeShown,
    setInfoOpen,
    infoOpen,
    nav,
    page,
    setPage,
    refreshError,
    syncing,
    data,
    product,
    pullTotal,
    windowSpend,
    session,
    load,
    payMatch,
    markPaid,
    patchState,
    planRows,
    state,
    currentDue,
    dueRows,
    laterRows,
    logPartial,
    setSheet,
    extra,
    extraOn,
    extraAmt,
    history,
    merchants,
    insights,
    month,
    filterPurpose,
    query,
    activityLimit,
    weekKey,
    queue,
    setReviewIdx,
    setQuery,
    setFilterPurpose,
    weekLabel,
    setActivityLimit,
    billIdx,
    orderedBills,
    orderedQueue,
    reviewMode,
    setReviewMode,
    showAddBill,
    correctOn,
    billDraft,
    setBillDraft,
    saveReviewedBill,
    setCorrectOn,
    setBillIdx,
    parkAtFront,
    setBillFront,
    newBill,
    setNewBill,
    setShowAddBill,
    reviewErr,
    front,
    reviewTotals,
    goReview,
    undoReview,
    reviewHist,
    skipReview,
    upcoming,
    preferenceStatus,
    retryPreferences,
  };
  return (
    <DwContext.Provider value={context}>
      <div className="dw-app">
        <Sidebar />
        <main className="dw-main">
          {transactionError && (
            <p className="dw-mute" role="alert">
              {transactionError}{" "}
              <button
                className="dw-link"
                onClick={() => {
                  setTransactionError("");
                  load();
                }}
              >
                Reload transactions
              </button>
            </p>
          )}
          {preferenceStatus.kind === "loading" && (
            <p className="dw-mute" role="status">
              Loading your saved planning choices…
            </p>
          )}
          {preferenceStatus.kind === "error" && (
            <p className="dw-mute" role="alert">
              Your latest preferences are kept on this device. Account sync failed.{" "}
              <button className="dw-link" onClick={retryPreferences}>
                Retry
              </button>
            </p>
          )}
          {paymentError && (
            <p className="dw-mute" role="alert">
              {paymentError}
            </p>
          )}
          {page === "home" && <Home />}
          {page === "insights" && <Insights />}
          {page === "activity" && <Activity />}
          {page === "review" && <Review />}
          {page === "bills" && <Bills />}
          {page === "shop" && <ShopPage key={session?.user?.id || "demo"} userId={session?.user?.id || "demo"} transactions={product.txns} grocerySpend={product.catSpend?.Groceries || 0} groceryBudget={(data.budgets || []).find(b=>b.category === "Groceries")?.monthly_limit ?? null} monthLabel={monthLabel(month)}/> }
          {page === "profile" && <Profile />}
        </main>
        <nav className="dw-tabs">
          {nav.map((n) => (
            <button key={n.id} className={page === n.id ? "on" : ""} onClick={() => setPage(n.id)}>
              <Icon d={n.icon} size={22} />
              {n.label}
              {n.badge ? (
                <b
                  className="dw-badge"
                  style={{ position: "absolute", marginTop: -18, marginLeft: 18 }}
                >
                  {n.badge}
                </b>
              ) : null}
            </button>
          ))}
        </nav>
        {sheet && (
          <TxSheet
            t={product.txns.find((t) => t.id === sheet.id) || sheet}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    </DwContext.Provider>
  );
}

function Profile() {
  const { data, load, session, state, patchState, preferenceStatus, retryPreferences, syncing } =
    useContext(DwContext);
  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [job, setJob] = useState({ id: "", name: "", amount: "", cadence: "biweekly", anchor: "" });
  const [jobMsg, setJobMsg] = useState("");
  const accounts = data.accounts || [];
  async function savePassword(e) {
    e.preventDefault();
    setPwMsg("");
    if (!supabase) {
      setPwMsg("Sign-in is not available here.");
      return;
    }
    if (pw.length < 8) {
      setPwMsg("Use at least 8 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwMsg(error ? error.message : "Password updated.");
    if (!error) setPw("");
  }
  async function saveJob(e) {
    e.preventDefault();
    setJobMsg("");
    if (!job.name || !(Number(job.amount) > 0)) {
      setJobMsg("Name and amount are required.");
      return;
    }
    try {
      if (job.id) {
        await updateIncome(job.id, {
          name: job.name.trim(),
          amount: Number(job.amount),
          cadence: job.cadence,
          anchor_date: job.anchor || null,
          due_day: job.cadence === "monthly" && job.anchor ? Number(job.anchor.slice(8, 10)) : null,
          confirmed: true,
        });
        setJobMsg("Paycheck updated.");
      } else {
        await addIncome({
          name: job.name.trim(),
          amount: Number(job.amount),
          cadence: job.cadence,
          anchor_date: job.anchor || null,
          due_day: job.cadence === "monthly" && job.anchor ? Number(job.anchor.slice(8, 10)) : null,
          confirmed: true,
        });
        setJobMsg("Paycheck added.");
      }
      setJob({ id: "", name: "", amount: "", cadence: "biweekly", anchor: "" });
      load();
    } catch (err) {
      setJobMsg(err.message);
    }
  }
  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Settings</h1>
          <p className="dw-sub">Accounts, paychecks, type size, and connections.</p>
        </div>
      </header>
      <div className="dw-ins-2">
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-ident">
              <div className="dw-ava">{(session?.user?.email?.[0] || "M").toUpperCase()}</div>
              <div>
                <div className="dw-h2">
                  {session?.user?.email ? session.user.email.split("@")[0] : "Matt"}
                </div>
                <p className="dw-mute" style={{ margin: "2px 0 0" }}>
                  {session?.user?.email || ""}
                </p>
              </div>
            </div>
          </section>
          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>
              Accounts
            </div>
            <p className="dw-mute" style={{ margin: "0 0 8px" }}>
              Each account is listed once. The switch keeps it in or out of safe to spend.
            </p>
            <ConnectBankCard
              plain
              accounts={accounts}
              onChanged={load}
              onToggle={(id, on) =>
                updateAccount(id, { include_in_spendable: on, hidden: false }).then(load)
              }
            />
          </section>
          <section className="dw-card">
            <div className="dw-k">Steady paychecks</div>
            <p className="dw-mute" style={{ margin: "6px 0 0" }}>
              Steady pay sets the payday schedule. Received extra pay is already in bank cash.
            </p>
            <div className="dw-tx-list" style={{ marginTop: 8 }}>
              {(data.income || [])
                .filter(
                  (s) =>
                    !(Number(s.amount || 0) === 0 && s.cadence === "one_time" && !s.anchor_date),
                )
                .map((s) => (
                  <div key={s.id} className="dw-tx" style={{ cursor: "default" }}>
                    <span className="grow">
                      <b>{s.name}</b>
                      <em>
                        {s.cadence === "biweekly"
                          ? "Every 2 weeks"
                          : s.cadence === "weekly"
                            ? "Every week"
                            : s.cadence === "monthly"
                              ? "Every month"
                              : s.cadence}
                      </em>
                    </span>
                    <span className="dw-amt">{moneyFull(s.amount)}</span>
                    <button
                      className="dw-link"
                      type="button"
                      onClick={() =>
                        setJob({
                          id: s.id,
                          name: s.name || "",
                          amount: String(s.amount || ""),
                          cadence: s.cadence || "biweekly",
                          anchor: s.anchor_date || "",
                        })
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="dw-link"
                      type="button"
                      onClick={() =>
                        deleteIncome(s.id).then(() => {
                          setJobMsg("Paycheck removed.");
                          load();
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                ))}
            </div>
            <form onSubmit={saveJob}>
              <label className="dw-field">
                Name
                <input
                  value={job.name}
                  onChange={(e) => setJob({ ...job, name: e.target.value })}
                />
              </label>
              <label className="dw-field">
                Amount each check
                <input
                  type="number"
                  value={job.amount}
                  onChange={(e) => setJob({ ...job, amount: e.target.value })}
                />
              </label>
              <label className="dw-field">
                How often
                <select
                  value={job.cadence}
                  onChange={(e) => setJob({ ...job, cadence: e.target.value })}
                >
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every two weeks</option>
                  <option value="monthly">Every month</option>
                </select>
              </label>
              <label className="dw-field">
                Next payday
                <input
                  type="date"
                  value={job.anchor}
                  onChange={(e) => setJob({ ...job, anchor: e.target.value })}
                />
              </label>
              <button className="dw-ctl-btn" type="submit">
                {job.id ? "Save paycheck" : "Add paycheck"}
              </button>
              {job.id && (
                <button
                  className="dw-ctl-btn"
                  type="button"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    setJob({ id: "", name: "", amount: "", cadence: "biweekly", anchor: "" })
                  }
                >
                  Cancel
                </button>
              )}
              {jobMsg && (
                <p className="dw-mute" style={{ marginTop: 8 }}>
                  {jobMsg}
                </p>
              )}
            </form>
          </section>
        </div>
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-k">Text size</div>
            <p className="dw-mute" style={{ margin: "6px 0 10px" }}>
              Scales every size together. Big numbers stay big. Labels stay smaller.
            </p>
            <div className="dw-review-tabs">
              {[
                ["s", "Small"],
                ["m", "Medium"],
                ["l", "Large"],
                ["xl", "Larger"],
              ].map(([z, label]) => (
                <button
                  key={z}
                  type="button"
                  className={(state.fs || "m") === z ? "on" : ""}
                  onClick={() => patchState({ fs: z })}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
          <section className="dw-card">
            <div className="dw-k">Password</div>
            <form onSubmit={savePassword}>
              <label className="dw-field">
                New password
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <button className="dw-ctl-btn" type="submit">
                Update password
              </button>
              {pwMsg && (
                <p className="dw-mute" style={{ marginTop: 8 }}>
                  {pwMsg}
                </p>
              )}
            </form>
          </section>
          <section className="dw-card">
            <div className="dw-k">Connections</div>
            <div className="dw-conn">
              <div>
                <b>ChatGPT</b>
                <p>Choose Matt’s Money in a regular ChatGPT chat, then ask it to read your budget or propose a record change. Set its permissions to Allow read actions so it asks before changes. The connection uses a private address and access key; the public address below alone does not grant access. It cannot move money.</p>
              </div>
              <div>
                <b>Grok</b>
                <p>
                  In Grok, open Connectors, add a custom connector, and paste the address below.
                  Name it Matt’s Money. Ask it to read the app. It will not change anything until
                  you say yes.
                </p>
              </div>
              <div>
                <b>Claude</b>
                <p>
                  In Claude, open Settings, then Connectors, then Add custom connector. Paste the
                  same address. Ask it to read the app. It will not change anything until you say
                  yes.
                </p>
              </div>
              <code>https://mattsmoney.vercel.app/mcp</code>
            </div>
            <GoogleCalendarCard plain />
          </section>
          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 4 }}>
              Preferences
            </div>
            <p className="dw-mute" role={preferenceStatus.kind === "error" ? "alert" : "status"}>
              {preferenceStatus.kind === "saved"
                ? "Preferences saved to your account."
                : preferenceStatus.kind === "saving"
                  ? "Saving preferences…"
                  : preferenceStatus.kind === "error"
                    ? `Kept on this device. Account sync failed: ${preferenceStatus.error}`
                    : "Loading account preferences…"}
            </p>
            {preferenceStatus.kind === "error" && (
              <button className="dw-link" onClick={retryPreferences}>
                Retry saving preferences
              </button>
            )}
            <details>
              <summary className="dw-field-row">How Matt’s Money works</summary>
              <GuideCard current />
            </details>
            <button className="dw-field-row" onClick={() => load()}>
              <span>Reload saved budget {syncing ? "…" : ""}</span>
              <b>↻</b>
            </button>
            <button className="dw-field-row" onClick={() => signOut()}>
              <span>Log out</span>
              <b>→</b>
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

function Bills() {
  const { data, load, upcoming } = useContext(DwContext);
  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Bills</h1>
          <p className="dw-sub">
            These feed your paycheck plan — the app sets aside enough from each check to cover them.
          </p>
        </div>
      </header>
      <div className="dw-ins-2">
        <section className="dw-card dw-embed dw-bills-tile">
          <div className="dw-k" style={{ marginBottom: 8 }}>
            Recurring bills
          </div>
          <RecurringBillsCard
            bills={data.bills || []}
            transactions={data.transactions || []}
            onChanged={load}
            embedded
          />
        </section>
        <section className="dw-card dw-embed dw-bills-tile">
          <div className="dw-k" style={{ marginBottom: 8 }}>
            Income
          </div>
          <p className="dw-mute" style={{ margin: "0 0 8px" }}>
            Add every steady paycheck. Extra pay still waits until you confirm it.
          </p>
          <IncomeCard
            income={data.income || []}
            upcomingIncome={upcoming}
            transactions={data.transactions || []}
            onChanged={load}
            embedded
          />
        </section>
      </div>
    </div>
  );
}

function Review() {
  const {
    billIdx,
    orderedBills,
    orderedQueue,
    reviewMode,
    setReviewMode,
    showAddBill,
    correctOn,
    billDraft,
    setBillDraft,
    saveReviewedBill,
    setCorrectOn,
    patchState,
    state,
    setBillIdx,
    parkAtFront,
    setBillFront,
    newBill,
    setNewBill,
    setShowAddBill,
    reviewErr,
    front,
    reviewTotals,
    setCat,
    reviewBusy,
    goReview,
    undoReview,
    reviewHist,
    skipReview,
  } = useContext(DwContext);
  const billAt = billIdx < orderedBills.length ? billIdx : 0;
  const bill = orderedBills[billAt] || null;
  const txnLeft = orderedQueue.length;
  const billLeft = orderedBills.length;
  const tabs = (
    <div className="dw-review-tabs">
      <button className={reviewMode === "spend" ? "on" : ""} onClick={() => setReviewMode("spend")}>
        Transactions
      </button>
      <button className={reviewMode === "bills" ? "on" : ""} onClick={() => setReviewMode("bills")}>
        Bills
      </button>
    </div>
  );
  if (reviewMode === "bills") {
    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Review</h1>
            <p className="dw-sub">Confirm bills the app noticed, or add your own.</p>
          </div>
        </header>
        <div className="dw-review-wrap">
          {tabs}
          {!bill && !showAddBill && (
            <div className="dw-review-done">
              <div className="dw-big-check">✓</div>
              <div className="dw-h2">No suggested bills left</div>
              <p className="dw-mute">You can still add or remove a bill yourself.</p>
            </div>
          )}
          {bill && !showAddBill && (
            <>
              <div className="dw-review-stack">
                <div className="dw-review-behind" />
                <div className="dw-review-card">
                  <div className="dw-mark">{bill.name[0]}</div>
                  {correctOn ? (
                    <div className="dw-split" style={{ textAlign: "left" }}>
                      <label className="dw-field">
                        Name
                        <input
                          value={billDraft.name}
                          onChange={(e) => setBillDraft({ ...billDraft, name: e.target.value })}
                        />
                      </label>
                      <label className="dw-field">
                        Amount
                        <input
                          value={billDraft.amount}
                          onChange={(e) => setBillDraft({ ...billDraft, amount: e.target.value })}
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      <div className="dw-review-merchant">{bill.name}</div>
                      <div className="dw-review-amt">{moneyFull(bill.amount)}</div>
                      <p className="dw-mute">{bill.note}</p>
                      <div className="dw-review-date">{reviewDate(bill.latest)}</div>
                    </>
                  )}
                </div>
              </div>
              <p className="dw-progress dw-progress-under">{billLeft} left</p>
              <div className="dw-bucket-btns">
                <button
                  className="bw-needs"
                  onClick={() => {
                    saveReviewedBill(
                      correctOn
                        ? {
                            ...bill,
                            name: billDraft.name || bill.name,
                            amount: Number(billDraft.amount || bill.amount),
                          }
                        : bill,
                    );
                  }}
                >
                  Confirm
                </button>
                <button
                  className="bw-wants"
                  onClick={() => {
                    setCorrectOn(true);
                    setBillDraft({ name: bill.name, amount: String(bill.amount) });
                  }}
                >
                  Correct
                </button>
                <button
                  className="bw-savings"
                  onClick={() => {
                    patchState({
                      rejectedIdeas: { ...(state.rejectedIdeas || {}), [bill.id]: true },
                    });
                    setBillIdx(0);
                    setCorrectOn(false);
                  }}
                >
                  Not a bill
                </button>
              </div>
              <div className="dw-review-ctrl">
                <button
                  className="dw-ctl-btn"
                  type="button"
                  onClick={() => {
                    parkAtFront(orderedBills, billAt, setBillFront, setBillIdx);
                    setCorrectOn(false);
                  }}
                >
                  Skip
                </button>
              </div>
            </>
          )}
          {showAddBill && (
            <div className="dw-review-card">
              <div className="dw-split" style={{ textAlign: "left" }}>
                <label className="dw-field">
                  Name
                  <input
                    value={newBill.name}
                    onChange={(e) => setNewBill({ ...newBill, name: e.target.value })}
                  />
                </label>
                <label className="dw-field">
                  Amount
                  <input
                    value={newBill.amount}
                    onChange={(e) => setNewBill({ ...newBill, amount: e.target.value })}
                  />
                </label>
              </div>
              <button
                className="dw-ctl-btn"
                style={{ marginTop: 12 }}
                onClick={() =>
                  saveReviewedBill({
                    name: newBill.name,
                    amount: Number(newBill.amount),
                    latest: isoDate(),
                  })
                }
              >
                Add bill
              </button>
            </div>
          )}
          <button className="dw-link" onClick={() => setShowAddBill((v) => !v)}>
            {showAddBill ? "Cancel" : "Add a bill"}
          </button>
          {reviewErr && (
            <p className="dw-mute" style={{ marginTop: 8 }}>
              {reviewErr}
            </p>
          )}
        </div>
      </div>
    );
  }
  if (!front) {
    return (
      <div className="dw-page">
        <header className="dw-page-h">
          <div>
            <h1>Review</h1>
            <p className="dw-sub">Sort your spending into buckets.</p>
          </div>
        </header>
        <div className="dw-review-wrap">
          {tabs}
          <div className="dw-review-done">
            <div className="dw-big-check">✓</div>
            <div className="dw-h2">All caught up</div>
            <p className="dw-mute">Every posted transaction in this queue is reviewed.</p>
            {reviewHist.length > 0 && (
              <button className="dw-ctl-btn" disabled={reviewBusy} onClick={undoReview}>
                ↩ Undo last review
              </button>
            )}
            {reviewTotals.needs + reviewTotals.wants + reviewTotals.savings > 0 && (
              <div style={{ marginTop: 16, display: "flex", gap: 16, justifyContent: "center" }}>
                {["needs", "wants", "savings"].map((p) => (
                  <span key={p} className="dw-mute">
                    <span
                      className="dw-dot"
                      style={{ background: PURPOSE_META[p].color, marginRight: 6 }}
                    />
                    {moneyFull(reviewTotals[p])}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  const amt = Math.abs(Number(front.amount || 0));
  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Review</h1>
          <p className="dw-sub">Put the charge in the right category. Sorting it is optional.</p>
        </div>
      </header>
      <div className="dw-review-wrap">
        {tabs}
        <div className="dw-review-stack">
          <div className="dw-review-behind b2" />
          <div className="dw-review-behind" />
          <div className="dw-review-card">
            <div className="dw-mark">{(front.merchant || "?")[0]}</div>
            <div className="dw-review-merchant">{front.merchant || "Unknown"}</div>
            <div className="dw-review-amt">{moneyFull(amt)}</div>
            <label className="dw-review-cat">
              <span>Category</span>
              <select
                value={front.category || "Other"}
                onChange={(e) => setCat(front, e.target.value)}
                disabled={reviewBusy}
              >
                {!CATEGORY_CATALOG.some((c) => c.name === front.category) && front.category && (
                  <option value={front.category}>{front.category}</option>
                )}
                {CATEGORY_CATALOG.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value="Transfers">Transfers</option>
                <option value="Income">Income</option>
              </select>
            </label>
            <div className="dw-review-date">{reviewDate(front.txn_date)}</div>
          </div>
        </div>
        <p className="dw-progress dw-progress-under">{txnLeft} left</p>
        <p className="dw-review-sort">Then sort it, if you want</p>
        <div className="dw-bucket-btns">
          <button className="bw-wants" disabled={reviewBusy} onClick={() => goReview("wants")}>
            Wants<small>{moneyFull(reviewTotals.wants)}</small>
          </button>
          <button className="bw-savings" disabled={reviewBusy} onClick={() => goReview("savings")}>
            Savings<small>{moneyFull(reviewTotals.savings)}</small>
          </button>
          <button className="bw-needs" disabled={reviewBusy} onClick={() => goReview("needs")}>
            Needs<small>{moneyFull(reviewTotals.needs)}</small>
          </button>
        </div>
        <div className="dw-review-ctrl">
          <button
            className="dw-ctl-btn"
            onClick={undoReview}
            disabled={reviewHist.length === 0 || reviewBusy}
          >
            ↩ Undo
          </button>
          <button className="dw-ctl-btn" disabled={reviewBusy} onClick={skipReview}>
            Skip →
          </button>
        </div>
      </div>
    </div>
  );
}

function Activity() {
  const {
    product,
    filterPurpose,
    query,
    activityLimit,
    weekKey,
    setSheet,
    queue,
    setReviewIdx,
    setPage,
    setQuery,
    setFilterPurpose,
    weekLabel,
    setActivityLimit,
    activityMonth,
    setActivityMonth,
    activityScope,
    setActivityScope,
    activityCategory,
    setActivityCategory,
  } = useContext(DwContext);
  const list = filterActivity(product.txns, {
    scope: activityScope,
    month: activityMonth,
    category: activityCategory,
    purpose: filterPurpose,
    query,
  });
  const shown = list.slice(0, activityLimit);
  const groups = {};
  for (const t of shown) {
    const k = weekKey(String(t.txn_date || "").slice(0, 10));
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  }
  const sortedWeeks = Object.keys(groups).sort().reverse();
  const thisWeek = weekKey(isoDate());

  function Tile({ t }) {
    const amt = Number(t.amount || 0);
    const expense = Number(t.amount || 0) > 0;
    const pm = PURPOSE_META[t.purpose];
    return (
      <button className="dw-tile" onClick={() => setSheet(t)}>
        <div className="dw-tile-top">
          <span className="dw-mark" style={{ width: 30, height: 30, fontSize: 13 }}>
            {(t.merchant || "?")[0]}
          </span>
          <span className={`dw-tile-amt${expense ? "" : " pos"}`}>
            {expense ? "−" : "+"}
            {moneyFull(Math.abs(amt))}
          </span>
        </div>
        <div className="dw-tile-name">{t.merchant || "—"}</div>
        <div className="dw-tile-meta">
          {String(t.txn_date || "").slice(5)}
          {pm && t.purpose !== "unreviewed" && (
            <span className={`dw-chip ${t.purpose}`}>{pm.label}</span>
          )}
          {t.purpose === "unreviewed" && isExpense(t) && (
            <span className="dw-chip unreviewed">Review</span>
          )}
          {!isExpense(t) && (
            <span className="dw-chip">
              {t.category === "Income"
                ? "Income"
                : t.category === "Transfers"
                  ? "Transfer"
                  : "Payment"}
            </span>
          )}
          {t.pending && " · pending"}
        </div>
      </button>
    );
  }

  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Transaction Activity</h1>
          <p className="dw-sub">
            {shown.length < list.length
              ? `Showing ${shown.length} of ${list.length}`
              : `${list.length} transactions`}
          </p>
        </div>
        {queue.length > 0 && (
          <button
            className="dw-ctl-btn"
            onClick={() => {
              setReviewIdx(0);
              setPage("review");
            }}
          >
            Review {queue.length} →
          </button>
        )}
      </header>
      <div className="dw-toolbar">
        <label className="dw-field">
          View
          <select
            value={activityScope}
            onChange={(e) => {
              setActivityScope(e.target.value);
              setActivityLimit(120);
            }}
          >
            <option value="spending">Spending only</option>
            <option value="all">All transactions</option>
          </select>
        </label>
        <label className="dw-field">
          Month
          <input
            type="month"
            value={activityMonth}
            onChange={(e) => {
              setActivityMonth(e.target.value);
              setActivityLimit(120);
            }}
          />
        </label>
        <label className="dw-field">
          Category
          <select
            value={activityCategory}
            onChange={(e) => {
              setActivityCategory(e.target.value);
              setActivityLimit(120);
            }}
          >
            <option value="">All categories</option>
            {[...CATEGORY_CATALOG.map((c) => c.name), "Income", "Transfers"].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        {(activityMonth || activityCategory || query || filterPurpose !== "all") && (
          <button
            className="dw-link"
            onClick={() => {
              setActivityMonth("");
              setActivityCategory("");
              setQuery("");
              setFilterPurpose("all");
            }}
          >
            Clear filters
          </button>
        )}
        <input
          className="dw-search"
          placeholder="Search transactions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="dw-chips">
          {["all", "needs", "wants", "savings", "paid"].map((id) => (
            <button
              key={id}
              className={filterPurpose === id ? "on" : ""}
              onClick={() => setFilterPurpose(id)}
            >
              {id !== "all" && (
                <span className="dw-dot" style={{ background: PURPOSE_META[id].color }} />
              )}
              {id === "all" ? "All" : PURPOSE_META[id].label}
            </button>
          ))}
        </div>
      </div>
      {sortedWeeks.map((wk, wi) => {
        const items = groups[wk];
        const total = items.reduce((s, t) => s + (isExpense(t) ? spendAmount(t) : 0), 0);
        return (
          <div key={wk}>
            <div className="dw-week-h">
              <span className="dw-k">{wk === thisWeek ? "This week" : weekLabel(wk)}</span>
              <span className="dw-total">Spent {moneyFull(total)}</span>
            </div>
            <div className="dw-txgrid">
              {items.map((t) => (
                <Tile key={t.id} t={t} />
              ))}
            </div>
          </div>
        );
      })}
      {sortedWeeks.length === 0 && <p className="dw-mute">No transactions match.</p>}
      {shown.length < list.length && (
        <button
          className="dw-ctl-btn"
          type="button"
          style={{ marginTop: 16 }}
          onClick={() => setActivityLimit((n) => n + 120)}
        >
          Show more
        </button>
      )}
    </div>
  );
}

function Insights() {
  const {
    history,
    product,
    merchants,
    setPage,
    insights,
    patchState,
    month,
    setMonth,
    setActivityMonth,
    setActivityScope,
    setActivityCategory,
    setQuery,
    setFilterPurpose,
  } = useContext(DwContext);
  const maxMonth = Math.max(...history.map((h) => h.total), 1);
  const avg = history.reduce((s, h) => s + h.total, 0) / (history.length || 1);
  const top = history.reduce(
    (a, b) => (b.total > a.total ? b : a),
    history[0] || { total: 0, label: "—" },
  );
  const catRows = Object.entries(product.catSpend)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, amt]) => ({
      name,
      amt,
      color: CATEGORY_CATALOG.find((c) => c.name === name)?.color || "#a78bfa",
    }));
  const maxCat = Math.max(...catRows.map((c) => c.amt), 1);
  const maxMerch = Math.max(...merchants.map((m) => m.total), 1);

  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Insights</h1>
          <p className="dw-sub">Your money patterns at a glance.</p>
        </div>
        <button
          className="dw-link"
          onClick={() => {
            setActivityMonth("");
            setActivityCategory("");
            setQuery("");
            setFilterPurpose("all");
            setActivityScope("spending");
            setPage("activity");
          }}
        >
          Compare months
        </button>
      </header>

      <div className="dw-ins-2">
        <div className="dw-col-stack">
          {insights.slice(0, 3).map((c) => (
            <section key={c.id} className="dw-card">
              <div className="dw-h2">{c.name || c.title}</div>
              <p className="dw-mute" style={{ margin: "6px 0 0" }}>
                {c.body}
              </p>
            </section>
          ))}
          <section className="dw-card">
            <div className="dw-k">Your split</div>
            <p className="dw-mute" style={{ margin: "6px 0 10px" }}>
              You set these. They do not have to add up to 100.
            </p>
            <div className="dw-split dw-split-stack">
              {["needs", "wants", "savings"].map((id) => (
                <label key={id} className="dw-field">
                  {PURPOSE_META[id].label}
                  <input
                    type="number"
                    min="0"
                    value={product.plan[id]}
                    onChange={(e) =>
                      patchState({ plan: { ...product.plan, [id]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="dw-card">
            <div className="dw-k">Spending by month</div>
            <div className="dw-chart-box">
              <div className="dw-yaxis">
                <span>{moneyCompact(maxMonth)}</span>
                <span>{moneyCompact(maxMonth / 2)}</span>
                <span>$0</span>
              </div>
              <div className="dw-monthchart">
                {history.map((h) => (
                  <div
                    key={h.key}
                    className="dw-monthbar-wrap"
                    role="button"
                    tabIndex={0}
                    aria-label={`View spending in ${h.key}`}
                    onClick={() => {
                      setMonth(h.key);
                      setActivityMonth(h.key);
                      setActivityScope("spending");
                      setActivityCategory("");
                      setQuery("");
                      setFilterPurpose("all");
                      setPage("activity");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.currentTarget.click();
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <div
                      className="dw-monthbar"
                      style={{
                        height: `${Math.max(h.total > 0 ? 8 : 0, (h.total / maxMonth) * 100)}%`,
                      }}
                    >
                      <span className="dw-barval">{h.total ? moneyCompact(h.total) : ""}</span>
                    </div>
                    <span className="dw-monthlbl">{h.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div className="dw-stat-row">
                <span>Average monthly spend</span>
                <b>{moneyFull(avg)}</b>
              </div>
              <div className="dw-stat-row">
                <span>Highest spending month</span>
                <b>
                  {top.label} · {moneyFull(top.total)}
                </b>
              </div>
            </div>
          </section>
        </div>

        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>
              Top categories
            </div>
            {catRows.map((c) => (
              <div
                key={c.name}
                className="dw-catbar"
                role="button"
                tabIndex={0}
                aria-label={`View ${c.name} transactions`}
                onClick={() => {
                  setActivityMonth(month);
                  setActivityScope("spending");
                  setActivityCategory(c.name);
                  setQuery("");
                  setFilterPurpose("all");
                  setPage("activity");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.currentTarget.click();
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <div className="dw-catbar-top">
                  <span className="dw-catname">
                    <span
                      className="dw-catico"
                      style={{ background: `${c.color}22`, color: c.color }}
                    >
                      {(c.name || "?")[0]}
                    </span>
                    {c.name}
                  </span>
                  <span className="dw-catvals">
                    <b>{moneyFull(c.amt)}</b>
                  </span>
                </div>
                <div className="dw-track">
                  <div style={{ width: `${(c.amt / maxCat) * 100}%`, background: c.color }} />
                </div>
              </div>
            ))}
          </section>

          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>
              Month so far
            </div>
            <div className="dw-stat-row">
              <span>Spent in {monthLabel(month)}</span>
              <b>{moneyFull(product.recentSpend || 0)}</b>
            </div>
            {["needs", "wants", "savings"].map((p) => (
              <div key={p} className="dw-stat-row">
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="dw-dot" style={{ background: PURPOSE_META[p].color }} />
                  {PURPOSE_META[p].label}
                </span>
                <b>{moneyFull(product.byPurpose?.[p] || 0)}</b>
              </div>
            ))}
            <div className="dw-stat-row">
              <span>Not assigned to a bucket</span>
              <b>
                {moneyFull(
                  Math.max(0, (product.recentSpend || 0) - (product.classifiedTotal || 0)),
                )}
              </b>
            </div>
          </section>

          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 8 }}>
              Top merchants · {monthLabel(month)}
            </div>
            {merchants.length === 0 ? (
              <p className="dw-mute">No merchant data this month.</p>
            ) : (
              merchants.map((m) => (
                <div
                  key={m.name}
                  className="dw-catbar"
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${m.name} transactions`}
                  onClick={() => {
                    setActivityMonth(month);
                    setActivityScope("spending");
                    setActivityCategory("");
                    setQuery(m.name);
                    setFilterPurpose("all");
                    setPage("activity");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.currentTarget.click();
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <div className="dw-catbar-top">
                    <span className="dw-catname">
                      <span className="dw-mark" style={{ width: 26, height: 26, fontSize: 12 }}>
                        {m.name[0]}
                      </span>
                      {m.name}
                    </span>
                    <span className="dw-catvals">
                      <b>{moneyFull(m.total)}</b>
                    </span>
                  </div>
                  <div className="dw-track">
                    <div
                      style={{ width: `${(m.total / maxMerch) * 100}%`, background: "#3b82f6" }}
                    />
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Home() {
  const {
    pay,
    data,
    safeShown,
    pullTotal,
    spreadOn,
    windowSpend,
    product,
    session,
    load,
    refreshError,
    setPage,
    payMatch,
    markPaid,
    patchState,
    planRows,
    state,
    currentDue,
    dueRows,
    laterRows,
    logPartial,
    setSheet,
    extra,
    extraOn,
    extraAmt,
  } = useContext(DwContext);
  const [editor, setEditor] = useState(null);
  const [extraPayment, setExtraPayment] = useState(null);
  const [planMsg, setPlanMsg] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [partialId, setPartialId] = useState(null);
  const [partialAmt, setPartialAmt] = useState("");
  const dueNow = pay.info.windowItems || [];
  const payday = pay.nextIncome?.date;
  const shares = (pay.info.laterItems || []).filter((b) => b.due && payday && b.due > payday);
  const upcomingBills = unpaidBills(data.bills || [], data.transactions || [], isoDate(), 90)
    .filter((b) => (payday ? b.date > payday : b.date > isoDate()))
    .map((b) => ({ ...b, id: b.billId, due: b.originalDate || b.date }));
  const next = pay.nextIncome;
  const segs = [
    { label: "Safe to spend", amount: Math.max(0, safeShown), color: "#22c55e" },
    {
      label: "Bills due before payday",
      amount: Math.max(0, Number(pay.info.billsBeforePay || 0)),
      color: "#eab308",
    },
    { label: "Goals & debts on", amount: Math.max(0, pullTotal), color: "#a78bfa" },
    {
      label: "Buffer & saved goals",
      amount: Math.max(0, pay.info.floor + pay.info.earmarked + pay.info.tripFunds),
      color: "#64748b",
    },
    { label: "Everyday budgets left", amount: Math.max(0, pay.info.everyday), color: "#f97316" },
    {
      label: "Later bill shares",
      amount: spreadOn ? Math.max(0, pay.info.laterShare) : 0,
      color: "#d97706",
    },
    { label: "Held aside", amount: Math.max(0, Number(pay.info.setAside || 0)), color: "#3b82f6" },
  ].filter((s) => s.amount > 0.005);
  const segTotal = segs.reduce((t, s) => t + s.amount, 0) || 1;
  const paycheckTotal = segTotal + windowSpend;

  const spentMonth = product.recentSpend || 0;
  const unsorted = Math.max(0, spentMonth - (product.classifiedTotal || 0));
  const purposeRows = [
    ...["needs", "wants", "savings"].map((p) => ({
      id: p,
      ...PURPOSE_META[p],
      total: product.byPurpose?.[p] || 0,
    })),
    { id: "unsorted", label: "Not assigned to a bucket", color: "#6b7280", total: unsorted },
  ];
  let ringAt = 0;
  const ringStops = [];
  for (const r of purposeRows) {
    if (!(r.total > 0) || !(spentMonth > 0)) continue;
    const start = ringAt;
    ringAt += (r.total / spentMonth) * 100;
    ringStops.push(`${r.color} ${start}% ${ringAt}%`);
  }
  const ring = ringStops.length
    ? `conic-gradient(${ringStops.join(",")})`
    : "conic-gradient(#3f3f46 0 100%)";

  const firstName = session?.user?.email ? session.user.email.split("@")[0] : "there";

  function openPlan(kind, id) {
    setExtraPayment(null);
    setPlanMsg("");
    if (kind === "Goal") {
      const g = (data.goals || []).find((x) => String(x.id) === String(id));
      if (!g) return;
      setEditor({
        kind: "goal",
        id: g.id,
        name: g.name || "",
        target: String(g.target ?? ""),
        saved: String(g.current ?? ""),
        monthly: String(g.monthly_contribution ?? ""),
        deadline: g.target_date || "",
      });
    } else {
      const d = (data.debts || []).find((x) => String(x.id) === String(id));
      if (!d) return;
      setEditor({
        kind: "debt",
        id: d.id,
        name: d.name || "",
        balance: String(d.balance ?? ""),
        monthly: String(d.plan_payment ?? ""),
        firstDate: d.start_date || d.next_payment_date || "",
        frequency: d.pay_frequency || "monthly",
        minimum: String(d.min_payment ?? 0),
        apr: d.apr == null ? "" : String(d.apr),
        debtType: d.kind || "loan",
        bankLinked: Boolean(d.plaid_account_id),
      });
    }
  }

  async function savePlan(e) {
    e.preventDefault();
    setPlanMsg("");
    const name = editor.name.trim();
    const monthly = Number(editor.monthly);
    if (!name || !Number.isFinite(monthly) || !(monthly > 0)) {
      setPlanMsg("Name and a monthly amount are required.");
      return;
    }
    setPlanBusy(true);
    try {
      if (editor.kind === "goal") {
        const fields = {
          name,
          target: Number(editor.target || 0),
          current: Number(editor.saved || 0),
          monthly_contribution: monthly,
          target_date: editor.deadline || null,
          status: "active",
        };
        if (editor.id) await updateGoal(editor.id, fields);
        else await addGoal(fields);
      } else {
        if (!editor.firstDate || !Number.isFinite(Number(editor.balance || 0)) || Number(editor.balance || 0) < 0 || !Number.isFinite(Number(editor.minimum || 0)) || Number(editor.minimum || 0) < 0 || (editor.apr !== "" && editor.apr != null && (!Number.isFinite(Number(editor.apr)) || Number(editor.apr) < 0 || Number(editor.apr) > 1000))) {
          setPlanMsg("Check the first due date, balance, minimum payment, and APR.");
          setPlanBusy(false);
          return;
        }
        const fields = {
          name,
          ...(editor.bankLinked ? {} : {balance: Number(editor.balance || 0)}),
          plan_payment: monthly,
          min_payment: Number(editor.minimum || 0),
          apr: editor.apr === "" || editor.apr == null ? null : Number(editor.apr),
          due_day: Number(editor.firstDate.slice(8, 10)),
          start_date: editor.firstDate,
          next_payment_date: editor.firstDate,
          pay_frequency: editor.frequency || "monthly",
          kind: editor.debtType || "loan",
        };
        if (editor.id) await updateDebt(editor.id, fields);
        else await addDebt(fields);
      }
      setEditor(null);
      setPlanMsg(editor.id ? "Saved." : "Added.");
      load();
    } catch (err) {
      setPlanMsg(err.message || "Could not save.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function removePlan() {
    if (!editor?.id) return;
    setPlanBusy(true);
    setPlanMsg("");
    try {
      if (editor.kind === "goal") await deleteGoal(editor.id);
      else await deleteDebt(editor.id);
      setEditor(null);
      setPlanMsg("Deleted.");
      load();
    } catch (err) {
      setPlanMsg(err.message || "Could not delete.");
    } finally {
      setPlanBusy(false);
    }
  }

  async function saveExtra(e) {
    e.preventDefault();
    const amount = Number(extraPayment.amount);
    if (!(amount > 0)) {
      setPlanMsg("Enter the payment amount.");
      return;
    }
    setPlanBusy(true);
    setPlanMsg("");
    try {
      await addDebtPayment({
        debt_id: extraPayment.id,
        amount,
        paid_on: extraPayment.date || isoDate(),
      });
      setExtraPayment(null);
      setPlanMsg("Balance lowered. Monthly payment unchanged.");
      load();
    } catch (err) {
      setPlanMsg(err.message || "Could not log the payment.");
    } finally {
      setPlanBusy(false);
    }
  }

  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Welcome back, {firstName}</h1>
          <p className="dw-sub">Here's what's happening with your money.</p>
          {product.missingAvailable?.length > 0 && (
            <p className="dw-mute" role="status">
              Available balance missing: {product.missingAvailable.join(", ")}. Excluded from this
              calculation.
            </p>
          )}
          {refreshError && (
            <p className="dw-mute" role="alert">
              Refresh failed. Showing saved data. {refreshError}
            </p>
          )}
        </div>
      </header>

      <div className="dw-2col">
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">This paycheck's spending plan</div>
              {next && pay.daysLeft != null && (
                <span className="dw-mute" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                  {pay.daysLeft === 1 ? "1 day" : `${pay.daysLeft} days`} left
                </span>
              )}
            </div>
            <div className="dw-plan-nums">
              <span className="dw-big-n">{moneyFull(safeShown)}</span>
              <span className="dw-vs">from the accounts you include</span>
            </div>
            <details className="dw-phone-only">
              <summary className="dw-link">How this is calculated</summary>
              <SpendBreakdown />
            </details>
            <div className="dw-stackbar">
              {segs.map((s) => (
                <div
                  key={s.label}
                  title={`${s.label}: ${moneyFull(s.amount)}`}
                  style={{ width: `${(s.amount / segTotal) * 100}%`, background: s.color }}
                />
              ))}
            </div>
            <div className="dw-legend">
              {segs.map((s) => (
                <div key={s.label} className="dw-legend-row">
                  <span className="dw-dot" style={{ background: s.color }} />
                  {s.label}
                  <b>{moneyFull(s.amount)}</b>
                </div>
              ))}
            </div>
            {pay.perDay != null && next && (
              <p className="dw-mute" style={{ margin: "14px 0 0" }}>
                About {moneyFull(Math.max(0, safeShown) / pay.daysLeft)} a day until{" "}
                {shortDate(next.date)} · spent {moneyFull(windowSpend)} so far
              </p>
            )}
          </section>

          <PurchaseCheck />
          <PlanningPanel data={data} state={state} onChanged={load} refreshError={refreshError}/>

          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Spending this month</div>
              <button className="dw-link dw-spread" onClick={() => setPage("insights")}>
                Insights →
              </button>
            </div>
            <div className="dw-spend-circle">
              <div className="dw-donut" style={{ background: ring }}>
                <div className="dw-donut-hole">
                  <b>{moneyFull(spentMonth)}</b>
                  <span>spent</span>
                </div>
              </div>
              <div className="dw-legend">
                {purposeRows.map((r) => (
                  <div key={r.id} className="dw-legend-row">
                    <span className="dw-dot" style={{ background: r.color }} />
                    {r.label}
                    <b>{moneyFull(r.total)}</b>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {payMatch && (
            <section className="dw-card">
              <div className="dw-k">This looks like a bill payment</div>
              <p className="dw-mute" style={{ margin: "8px 0 0" }}>
                {payMatch.txn.merchant} · {moneyFull(Math.abs(Number(payMatch.txn.amount || 0)))}
                {payMatch.txn.txn_date ? ` · ${shortDate(payMatch.txn.txn_date)}` : ""}. Mark{" "}
                {payMatch.bill.name} paid?
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="dw-ctl-btn" onClick={() => markPaid(payMatch.bill)}>
                  Yes, mark paid
                </button>
                <button className="dw-ctl-btn" onClick={() => patchState({ matchSkip: true })}>
                  Not this
                </button>
              </div>
            </section>
          )}

          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Goals and debts</div>
            </div>
            <p className="dw-mute" style={{ margin: "6px 0 10px" }}>
              Each one can be switched off on its own.
            </p>
            {[
              ["Goal", "Goals"],
              ["Debt", "Debts"],
            ].map(([kind, label]) => {
              const rows = planRows.filter((r) => r.kind === kind);
              const sub = rows.reduce((s, r) => s + (state.planOff?.[r.id] ? 0 : r.share), 0);
              return (
                <div key={kind}>
                  <div className="dw-plan-sec">
                    <span>{label}</span>
                    <b>{moneyFull(sub)}</b>
                    <button
                      className="dw-link"
                      type="button"
                      onClick={() => {
                        setExtraPayment(null);
                        setPlanMsg("");
                        setEditor(
                          kind === "Goal"
                            ? {
                                kind: "goal",
                                id: "",
                                name: "",
                                target: "",
                                saved: "",
                                monthly: "",
                                deadline: "",
                              }
                            : {
                                kind: "debt",
                                id: "",
                                name: "",
                                balance: "",
                                monthly: "",
                                firstDate: "",
                              },
                        );
                      }}
                    >
                      Add
                    </button>
                  </div>
                  {rows.length === 0 && (
                    <p className="dw-mute" style={{ margin: "4px 0 8px" }}>
                      None yet.
                    </p>
                  )}
                  {rows.map((r) => {
                    const on = !state.planOff?.[r.id];
                    const rawId = r.id.slice(2);
                    return (
                      <div key={r.id} className="dw-plan-toggle">
                        <button
                          type="button"
                          className={`dw-switch${on ? " on" : ""}`}
                          aria-pressed={on}
                          onClick={() =>
                            patchState({ planOff: { ...(state.planOff || {}), [r.id]: on } })
                          }
                        />
                        <span className="grow">
                          <b>{r.name}</b>
                          <em>{r.note}</em>
                        </span>
                        <span className="dw-amt">{moneyFull(r.share)}</span>
                        <button
                          className="dw-link"
                          type="button"
                          onClick={() => openPlan(kind, rawId)}
                        >
                          Edit
                        </button>
                        {kind === "Debt" && (
                          <button
                            className="dw-link"
                            type="button"
                            onClick={() => {
                              setEditor(null);
                              setPlanMsg("");
                              setExtraPayment({
                                id: rawId,
                                name: r.name,
                                amount: "",
                                date: isoDate(),
                              });
                            }}
                          >
                            Extra payment
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {editor && (
              <form onSubmit={savePlan}>
                <label className="dw-field">
                  Name
                  <input
                    value={editor.name}
                    onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  />
                </label>
                {editor.kind === "goal" ? (
                  <>
                    <label className="dw-field">
                      Target
                      <input
                        type="number"
                        step="0.01"
                        value={editor.target}
                        onChange={(e) => setEditor({ ...editor, target: e.target.value })}
                      />
                    </label>
                    <label className="dw-field">
                      Saved so far
                      <input
                        type="number"
                        step="0.01"
                        value={editor.saved}
                        onChange={(e) => setEditor({ ...editor, saved: e.target.value })}
                      />
                    </label>
                    <label className="dw-field">
                      Amount per month
                      <input
                        type="number"
                        step="0.01"
                        value={editor.monthly}
                        onChange={(e) => setEditor({ ...editor, monthly: e.target.value })}
                      />
                    </label>
                    <label className="dw-field">
                      Deadline, optional
                      <input
                        type="date"
                        value={editor.deadline}
                        onChange={(e) => setEditor({ ...editor, deadline: e.target.value })}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="dw-field">
                      Balance
                      <input
                        type="number"
                        step="0.01"
                        value={editor.balance}
                        readOnly={editor.bankLinked}
                        onChange={(e) => setEditor({ ...editor, balance: e.target.value })}
                      />
                    </label>
                    <label className="dw-field">
                      Planned amount each payment
                      <input
                        type="number"
                        step="0.01"
                        value={editor.monthly}
                        onChange={(e) => setEditor({ ...editor, monthly: e.target.value })}
                      />
                    </label>
                    {editor.bankLinked && <p className="dw-mute">This balance comes from the bank. Editing the payment plan keeps it unchanged.</p>}
                    <label className="dw-field">Payment frequency<select value={editor.frequency || "monthly"} onChange={e=>setEditor({...editor,frequency:e.target.value})}><option value="monthly">Monthly</option><option value="biweekly">Every two weeks</option><option value="weekly">Weekly</option></select></label>
                    <label className="dw-field">Minimum each payment<input type="number" min="0" step="0.01" value={editor.minimum || ""} onChange={e=>setEditor({...editor,minimum:e.target.value})}/></label>
                    <label className="dw-field">APR %, optional<input type="number" min="0" max="1000" step="0.01" value={editor.apr || ""} onChange={e=>setEditor({...editor,apr:e.target.value})}/></label>
                    <label className="dw-field">Debt type<select value={editor.debtType || "loan"} onChange={e=>setEditor({...editor,debtType:e.target.value})}><option value="loan">Loan</option><option value="card">Credit card</option></select></label>
                    <label className="dw-field">
                      First due date
                      <input
                        type="date"
                        value={editor.firstDate}
                        onChange={(e) => setEditor({ ...editor, firstDate: e.target.value })}
                      />
                    </label>
                  </>
                )}
                <button className="dw-ctl-btn" type="submit" disabled={planBusy}>
                  {editor.id ? "Save" : "Add"}
                </button>
                <button
                  className="dw-ctl-btn"
                  type="button"
                  style={{ marginLeft: 8 }}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </button>
                {editor.id && (
                  <button
                    className="dw-ctl-btn"
                    type="button"
                    style={{ marginLeft: 8 }}
                    onClick={removePlan}
                  >
                    Delete
                  </button>
                )}
              </form>
            )}
            {extraPayment && (
              <form onSubmit={saveExtra}>
                <p className="dw-mute" style={{ margin: "8px 0 0" }}>
                  Extra payment on {extraPayment.name}. This only lowers the balance. The monthly
                  payment stays the same.
                </p>
                <label className="dw-field">
                  Amount
                  <input
                    type="number"
                    step="0.01"
                    value={extraPayment.amount}
                    onChange={(e) => setExtraPayment({ ...extraPayment, amount: e.target.value })}
                  />
                </label>
                <label className="dw-field">
                  Date
                  <input
                    type="date"
                    value={extraPayment.date}
                    onChange={(e) => setExtraPayment({ ...extraPayment, date: e.target.value })}
                  />
                </label>
                <button className="dw-ctl-btn" type="submit" disabled={planBusy}>
                  Log payment
                </button>
                <button
                  className="dw-ctl-btn"
                  type="button"
                  style={{ marginLeft: 8 }}
                  onClick={() => setExtraPayment(null)}
                >
                  Cancel
                </button>
              </form>
            )}
            {planMsg && (
              <p className="dw-mute" style={{ marginTop: 8 }}>
                {planMsg}
              </p>
            )}
          </section>

          <AppleBillMatcher data={data} onSaved={load} />

          <section className="dw-card">
            <div className="dw-plan-sec">
              <span>Bills</span>
              <button
                type="button"
                className={`dw-switch${spreadOn ? " on" : ""}`}
                aria-pressed={spreadOn}
                onClick={() => patchState({ spreadBills: !spreadOn })}
              />
            </div>
            <p className="dw-mute" style={{ margin: "0 0 8px" }}>
              {spreadOn
                ? "On. Later bills take a slice from this check. Due-before-payday bills are held in full."
                : "Off. Only bills due before payday are held, in full."}
            </p>
            <div className="dw-bill-grid">
              {[
                ...dueRows.map((b) => ({ ...b, full: true })),
                ...(spreadOn ? laterRows.map((b) => ({ ...b, full: false })) : []),
              ]
                .sort((a, b) =>
                  String(a.due || "9999-99-99").localeCompare(String(b.due || "9999-99-99")),
                )
                .map((b) => {
                  const paid = Number(b.partialPaid || 0);
                  const hold = b.full ? Number(b.amount || 0) : Number(b.share || 0);
                  const late = b.due && b.due < isoDate() && hold > 0.009;
                  return (
                    <div
                      key={`${b.full ? "due" : "later"}-${b.id}-${b.due}`}
                      className="dw-bill-cell"
                    >
                      <div className="dw-bill-top">
                        <b>{b.name}</b>
                        <span className="dw-amt">{moneyFull(hold)}</span>
                      </div>
                      <em>
                        {b.full
                          ? `Due ${b.due ? shortDate(b.due) : "soon"}${paid > 0 ? "" : " · full amount"}`
                          : `${moneyFull(hold)} of ${moneyFull(b.fullAmount || b.amount)}${b.due ? ` · due ${shortDate(b.due)}` : ""}`}
                        {paid > 0 ? ` · ${moneyFull(paid)} paid` : ""}
                        {late ? " · late" : ""}
                      </em>
                      <div className="dw-bill-actions">
                        <button className="dw-link" onClick={() => markPaid(b)}>
                          Mark paid
                        </button>
                        <button
                          className="dw-link"
                          type="button"
                          onClick={() => {
                            setPartialId(`${b.id}:${b.due}`);
                            setPartialAmt("");
                          }}
                        >
                          Partial
                        </button>
                      </div>
                      {partialId === `${b.id}:${b.due}` && (
                        <form
                          onSubmit={async (e) => {
                            e.preventDefault();
                            const ok = await logPartial(b, partialAmt);
                            if (ok === false) return;
                            setPartialId(null);
                            setPartialAmt("");
                          }}
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                            padding: "0 0 8px",
                          }}
                        >
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={partialAmt}
                            placeholder="Amount"
                            onChange={(e) => setPartialAmt(e.target.value)}
                            style={{ width: 110 }}
                          />
                          <button className="dw-ctl-btn" type="submit">
                            Save
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        </div>

        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Upcoming bills</div>
              <button className="dw-link dw-spread" onClick={() => setPage("bills")}>
                View all →
              </button>
            </div>
            <p className="dw-mute" style={{ margin: "6px 0 0" }}>
              Due after this paycheck
            </p>
            {upcomingBills.length === 0 ? (
              <p className="dw-mute" style={{ marginTop: 8 }}>
                Nothing due after this paycheck.
              </p>
            ) : (
              <div className="dw-tx-list" style={{ marginTop: 6 }}>
                {upcomingBills.slice(0, 5).map((b) => (
                  <div
                    key={`${b.id}-${b.due || ""}`}
                    className="dw-tx"
                    style={{ cursor: "default" }}
                  >
                    <span className="grow">
                      <b>{b.name}</b>
                      <em>Due {shortDate(b.due)}</em>
                    </span>
                    <span className="dw-amt">{moneyFull(b.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dw-card">
            <div className="dw-row-head">
              <div className="dw-k">Recent transactions</div>
              <button className="dw-link dw-spread" onClick={() => setPage("activity")}>
                View all →
              </button>
            </div>
            <div className="dw-tx-list" style={{ marginTop: 6 }}>
              {product.monthTx.slice(0, 5).map((t) => {
                const amt = Number(t.amount || 0);
                const expense = Number(t.amount || 0) > 0;
                return (
                  <button key={t.id} className="dw-tx" onClick={() => setSheet(t)}>
                    <span className="dw-mark">{(t.merchant || "?")[0]}</span>
                    <span className="grow">
                      <b>{t.merchant || "—"}</b>
                      <em>{t.txn_date?.slice(5)}</em>
                    </span>
                    <span className={`dw-amt${expense ? "" : " pos"}`}>
                      {expense ? "−" : "+"}
                      {moneyFull(Math.abs(amt))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 6 }}>
              Upcoming paydays
            </div>
            {pay.paydays.length === 0 ? (
              <p className="dw-mute">
                No paydays on the calendar.{" "}
                <button className="dw-link" onClick={() => setPage("bills")}>
                  Add your income
                </button>
              </p>
            ) : (
              <div className="dw-tx-list">
                {pay.paydays.slice(0, 3).map((pd, i) => (
                  <div
                    key={`${pd.date}-${pd.name}-${i}`}
                    className="dw-tx"
                    style={{ cursor: "default" }}
                  >
                    <span className="grow">
                      <b>{pd.name}</b>
                      <em>{shortDate(pd.date)}</em>
                    </span>
                    <span className="dw-amt">{moneyFull(pd.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {extra && (
            <section className="dw-card">
              <div className="dw-row-head">
                <div className="dw-k">Extra pay</div>
                {!extraOn && (
                  <button
                    className="dw-link dw-spread"
                    onClick={() => patchState({ extraId: extra.id })}
                  >
                    Confirm
                  </button>
                )}
              </div>
              <div className="dw-tx" style={{ cursor: "default" }}>
                <span className="grow">
                  <b>{extra.merchant || extra.income_source || "Extra pay"}</b>
                  <em>
                    {extraOn
                      ? "Reviewed · already included in bank cash"
                      : "Received · already included in bank cash"}
                  </em>
                </span>
                <span className="dw-amt pos">{moneyFull(extraAmt)}</span>
              </div>
            </section>
          )}

          <section className="dw-card">
            <div className="dw-k" style={{ marginBottom: 6 }}>
              Balances
            </div>
            <div className="dw-tx-list">
              <div className="dw-tx" style={{ cursor: "default" }}>
                <span className="grow">
                  <b>Checking</b>
                  <em>available cash</em>
                </span>
                <span className="dw-amt">{moneyFull(product.checkingTotal || 0)}</span>
              </div>
              <div className="dw-tx" style={{ cursor: "default" }}>
                <span className="grow">
                  <b>Savings</b>
                  <em>reserved</em>
                </span>
                <span className="dw-amt">{moneyFull(product.savingsTotal || 0)}</span>
              </div>
              <div className="dw-tx" style={{ cursor: "default" }}>
                <span className="grow">
                  <b>Net cash</b>
                  <em>across accounts</em>
                </span>
                <span className="dw-amt">{moneyFull(product.netCash || 0)}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function PurchaseCheck() {
  const { pay, safeShown, product, refreshError } = useContext(DwContext);
  const [amount, setAmount] = useState("");
  const result = checkPurchase({
    amount,
    safeToSpend: safeShown,
    daysLeft: pay.daysLeft,
    missingAvailable: product.missingAvailable || [],
    refreshError,
  });
  return (
    <details className="dw-card">
      <summary className="dw-link">Check a purchase</summary>
      <p className="dw-mute">
        Try a new expense that is not already covered by a bill or category budget. This is a
        preview; it does not save a transaction or move money.
      </p>
      <label className="dw-field">
        Purchase amount
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      <div role="status" aria-live="polite">
        {amount && !result && <p className="dw-mute">Enter an amount greater than zero.</p>}
        {result && (
          <>
            <div className="dw-stat-row">
              <span>Safe to spend after purchase</span>
              <b>{moneyFull(result.remaining)}</b>
            </div>
            <p className="dw-mute">
              {result.incomplete
                ? "This estimate is incomplete because an included balance is missing or the latest reload failed. Check your account data before relying on it."
                : result.fits
                  ? "This fits within the cash left after your current commitments."
                  : `Your current commitments and this purchase exceed included cash by ${moneyFull(result.shortfall)}.`}
            </p>
            {result.perDay != null && pay.nextIncome && (
              <p className="dw-mute">
                After this purchase: about {moneyFull(result.perDay)} a day until{" "}
                {shortDate(pay.nextIncome.date)}.
              </p>
            )}
            {!pay.nextIncome && (
              <p className="dw-mute">
                Add a confirmed payday to check how long this money needs to last.
              </p>
            )}
            <p className="dw-mute">
              Uses the current saved balances and plan switches. Expected pay is not added to
              today's cash.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

function Sidebar() {
  const {
    safeShown,
    setInfoOpen,
    pay,
    infoOpen,
    nav,
    page,
    setPage,
    refreshError,
    syncing,
    data,
    product,
  } = useContext(DwContext);
  const sts = safeShown;
  const neg = sts < 0;
  const abs = Math.abs(sts);
  return (
    <aside className="dw-side">
      <div className="dw-brand">
        <div className="dw-word">
          matt's <em>money</em>
        </div>
      </div>
      <div className="dw-sts">
        <div className="dw-k">Safe to spend</div>
        <div className="dw-sts-amt">
          <span className="dw-dol">{neg ? "−$" : "$"}</span>
          <span className="dw-dol-n">{Math.floor(abs).toLocaleString()}</span>
          <span className="dw-dol-c">.{String(Math.round((abs % 1) * 100)).padStart(2, "0")}</span>
        </div>
        <div className="dw-sts-row">
          <button className="dw-sts-until" onClick={() => setInfoOpen((v) => !v)}>
            {pay.nextIncome ? `Until ${shortDate(pay.nextIncome.date)}` : "Add payday"} ▾
          </button>
          <button
            className="dw-i"
            onClick={() => setInfoOpen((v) => !v)}
            aria-label="About Safe to Spend"
          >
            i
          </button>
        </div>
        {infoOpen && <SpendBreakdown />}
      </div>
      <nav className="dw-nav">
        {nav.map((n) => (
          <button
            key={n.id}
            className={`dw-nav-item ${page === n.id ? "on" : ""}`}
            onClick={() => setPage(n.id)}
          >
            <Icon d={n.icon} />
            <span>{n.label}</span>
            {n.badge ? <b className="dw-badge">{n.badge}</b> : null}
          </button>
        ))}
        <button className="dw-nav-item" onClick={() => signOut()}>
          <Icon d={ICONS.logout} />
          <span>Log out</span>
        </button>
      </nav>
      <div className="dw-foot">
        <p className="dw-mute" role={refreshError ? "alert" : "status"}>
          {refreshError
            ? `Refresh failed. Showing saved data. ${refreshError}`
            : syncing
              ? "Refreshing budget…"
              : data.fetchedAt
                ? `Loaded ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                : "Saved budget data"}
        </p>
        <div className="dw-k">Accounts</div>
        <div className="dw-acct">
          <span>Checking</span>
          <b>{moneyCompact(product.checkingTotal)}</b>
        </div>
        <div className="dw-acct">
          <span>Savings</span>
          <b>{moneyCompact(product.savingsTotal)}</b>
        </div>
        <div className="dw-acct">
          <span>Net Cash</span>
          <b>{moneyCompact(product.netCash)}</b>
        </div>
        {product.missingAvailable?.length > 0 && (
          <p className="dw-mute" style={{ margin: "8px 12px 0" }}>
            Available balance missing for {product.missingAvailable.join(", ")}. That account is not
            in Safe to spend.
          </p>
        )}
      </div>
    </aside>
  );
}

function SpendBreakdown() {
  const { pay, spreadOn, safeShown } = useContext(DwContext);
  return (
    <div className="dw-pop">
      <p>
        Available cash from the accounts you include, less bills, goal and debt commitments, your
        buffer, saved goal money, set-asides, and remaining category budgets. Received income is
        already in your bank cash and is never added twice.
      </p>
      {[
        ["Available cash", pay.start],
        ["Bills due before payday", -pay.info.billsBeforePay],
        ["Later bill shares", spreadOn ? -pay.info.laterShare : 0],
        ["Goal contributions", -pay.info.goalReserve],
        ["Debt commitments", -pay.debtReserve],
        ["Buffer", -pay.info.floor],
        ["Saved goal money", -pay.info.earmarked],
        ["Set aside", -pay.info.setAside],
        ["Everyday budgets left", -pay.info.everyday],
        ["Other reserved funds", -pay.info.tripFunds],
        ["Safe to spend", safeShown],
      ].map(([label, amount]) => (
        <div className="dw-stat-row" key={label}>
          <span>{label}</span>
          <b>{moneyFull(amount)}</b>
        </div>
      ))}
      {safeShown < 0 && (
        <p>
          Your commitments exceed the included cash. Review the breakdown and your optional
          goal/debt contributions.
        </p>
      )}
    </div>
  );
}

function TxSheet({ t, onClose }) {
  const { transactionError, classify, reviewBusy, setCat, setVisibility } = useContext(DwContext);
  if (!t) return null;
  return (
    <div className="dw-sheet-dim" onClick={onClose}>
      <aside className="dw-sheet dw-sheet-lg" onClick={(e) => e.stopPropagation()}>
        <button className="dw-x" onClick={onClose}>
          ×
        </button>
        <div className="dw-mark dw-mark-lg">{(t.merchant || "?")[0]}</div>
        <h2>{t.merchant || "Transaction"}</h2>
        <div className="dw-sheet-amt">
          {t.pending ? "" : isExpense(t) ? "−" : "+"}
          {moneyFull(Math.abs(Number(t.amount || 0)))}
        </div>
        <p className="dw-mute">{t.txn_date}</p>
        {t.pending && <span className="dw-chip">PENDING</span>}
        {transactionError && (
          <p className="dw-mute" role="alert">
            {transactionError}
          </p>
        )}
        <label className="dw-field">
          Purpose
          <select
            value={t.purpose}
            onChange={(e) => classify(t, e.target.value)}
            disabled={t.pending || reviewBusy}
          >
            {PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dw-field">
          Category
          <select
            value={t.category}
            onChange={(e) => setCat(t, e.target.value)}
            disabled={t.pending || reviewBusy}
          >
            {CATEGORY_CATALOG.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
            <option>Transfers</option>
            <option>Income</option>
          </select>
        </label>
        <p className="dw-mute" style={{ marginTop: 12 }}>
          Visibility: {t.hidden ? "Hidden from Insights" : "Shown"}
        </p>
        <button
          className="dw-text"
          disabled={t.pending || reviewBusy}
          onClick={() => setVisibility(t, !t.hidden)}
        >
          {t.hidden ? "Show in Insights" : "Hide from Insights"}
        </button>
      </aside>
    </div>
  );
}
