// @ts-nocheck
import { useMemo, useState } from "react";
import { forecastCash, estimatePayoff, nextDebtDate } from "../lib/planning.js";
import { computePaycheckPlan } from "../lib/paycheck-plan.js";
import { upsertBudget, deleteBudget } from "../lib/api";
import { CATEGORY_CATALOG, moneyFull } from "../lib/dw-product.js";
import { isoDate, shortDate } from "../lib/format.js";

export default function PlanningPanel({ data, state, onChanged, refreshError }) {
  return (
    <>
      <Forecast data={data} state={state} refreshError={refreshError} />
      <Budgets data={data} state={state} onChanged={onChanged} />
      <DebtComparison debts={data.debts || []} />
    </>
  );
}
function Forecast({ data, state, refreshError }) {
  const [horizon, setHorizon] = useState("30");
  const [daily, setDaily] = useState("");
  const [showAll, setShowAll] = useState(false);
  const suggested =
    Math.round(
      ((data.budgets || []).reduce((s, b) => s + Math.max(0, Number(b.monthly_limit || 0)), 0) /
        30.4375) *
        100,
    ) / 100;
  const spending = daily === "" ? suggested : Number(daily);
  const valid = Number.isFinite(spending) && spending >= 0;
  const forecast = useMemo(
    () => forecastCash({ data, state, horizon: Number(horizon), dailySpend: valid ? spending : 0 }),
    [data, state, horizon, spending, valid],
  );
  return (
    <details className="dw-card">
      <summary className="dw-link">Cash-flow forecast</summary>
      <p className="dw-mute">
        A projection of included available cash after protected savings, set-asides, scheduled
        bills, enabled debt payments, and future goal contributions. Expected pay is an estimate,
        not cash available today.
      </p>
      <label className="dw-field">
        Forecast period
        <select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
      </label>
      <label className="dw-field">
        Everyday spending per day
        <input
          type="number"
          min="0"
          step="0.01"
          value={daily}
          placeholder={String(suggested)}
          onChange={(e) => setDaily(e.target.value)}
        />
      </label>
      <p className="dw-mute">
        {daily === ""
          ? `Using ${moneyFull(suggested)} a day from your category budgets. Change it to try a different amount.`
          : "Your daily amount replaces the category-budget assumption for this preview."}{" "}
        Keep recurring bills out of this amount to avoid counting them twice.
      </p>
      {!valid ? (
        <p role="alert" className="dw-mute">
          Enter a daily amount of zero or more.
        </p>
      ) : (
        <>
          {(forecast.missing.length > 0 || refreshError) && (
            <p role="alert" className="dw-mute">
              Incomplete estimate:{" "}
              {forecast.missing.length
                ? `available balance missing for ${forecast.missing.join(", ")}. `
                : ""}
              {refreshError ? "Latest budget reload failed." : ""}
            </p>
          )}
          <div className="dw-stat-row">
            <span>Protected today</span>
            <b>{moneyFull(forecast.protectedCash)}</b>
          </div>
          <div className="dw-stat-row">
            <span>Expected income in period</span>
            <b>{moneyFull(forecast.expectedIncome)}</b>
          </div>
          <div className="dw-stat-row">
            <span>Projected cash left {shortDate(forecast.through)}</span>
            <b>{moneyFull(forecast.ending)}</b>
          </div>
          <div className="dw-stat-row">
            <span>Lowest projected amount</span>
            <b>{moneyFull(forecast.lowest)}</b>
          </div>
          <p className="dw-mute" role="status">
            {forecast.firstShortfall
              ? `Possible shortfall starting ${shortDate(forecast.firstShortfall)}.`
              : "No shortfall in this scenario."}
          </p>
          <p className="dw-mute">
            Uses saved bank balances and your current switches. Bills are assumed to leave before
            income on the same day. Debt interest and unscheduled purchases can change the result.
            Today's unreceived pay is excluded until a future scheduled payday.
          </p>
          <div className="dw-tx-list">
            {forecast.points
              .filter((p) => p.entries.length)
              .slice(0, showAll ? 91 : 8)
              .map((p) => (
                <div
                  key={p.date}
                  style={{ padding: "10px 0", borderBottom: "1px solid var(--dw-line)" }}
                >
                  <div className="dw-stat-row">
                    <span>{shortDate(p.date)}</span>
                    <b>{moneyFull(p.balance)}</b>
                  </div>
                  {p.entries.map((e, i) => (
                    <div key={i} className="dw-mute">
                      {e.name} · {moneyFull(e.delta)}
                    </div>
                  ))}
                </div>
              ))}
          </div>
          <button className="dw-link" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer dates" : "Show all dates"}
          </button>
        </>
      )}
    </details>
  );
}
function Budgets({ data, state, onChanged }) {
  const [category, setCategory] = useState("Groceries"),
    [amount, setAmount] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const plan = computePaycheckPlan({ data, state });
  const numeric = Number(amount);
  const valid = amount !== "" && Number.isFinite(numeric) && numeric >= 0;
  const old = (data.budgets || []).find((b) => b.category === category);
  const preview = valid
    ? computePaycheckPlan({
        data: {
          ...data,
          budgets: [
            ...(data.budgets || []).filter((b) => b.category !== category),
            { category, monthly_limit: numeric },
          ],
        },
        state,
      })
    : null;
  async function save(e) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await upsertBudget({ category, monthly_limit: numeric });
      await onChanged();
      setMessage("Category budget saved.");
      setAmount("");
    } catch (e) {
      setMessage(e.message || "Budget was not saved.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(b) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await deleteBudget(b.id);
      await onChanged();
      setMessage("Category budget removed.");
    } catch (e) {
      setMessage(e.message || "Could not remove budget.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="dw-card">
      <summary className="dw-link">Category budgets</summary>
      <p className="dw-mute">
        Monthly limits reserve everyday money across your paychecks. Saving changes your spending
        plan, not your bank balance.
      </p>
      {(data.budgets || []).map((b) => (
        <div className="dw-stat-row" key={b.id || b.category}>
          <span>{b.category}</span>
          <b>{moneyFull(b.monthly_limit)}</b>
          <button
            className="dw-link"
            disabled={busy}
            onClick={() => {
              setCategory(b.category);
              setAmount(String(b.monthly_limit));
              setMessage("");
            }}
          >
            Edit
          </button>
          <button className="dw-link" disabled={busy} onClick={() => remove(b)}>
            Remove budget
          </button>
        </div>
      ))}
      <form onSubmit={save}>
        <label className="dw-field">
          Budget category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {[
              ...new Set([
                ...CATEGORY_CATALOG.map((c) => c.name),
                ...(data.budgets || []).map((b) => b.category),
              ]),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="dw-field">
          Monthly category limit
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {preview && (
          <p className="dw-mute" role="status">
            If saved, safe to spend changes from {moneyFull(plan.safeToSpend)} to{" "}
            {moneyFull(preview.safeToSpend)}.
          </p>
        )}
        <button className="dw-ctl-btn" disabled={!valid || busy}>
          {busy ? "Saving…" : old ? "Save budget change" : "Add category budget"}
        </button>
      </form>
      {message && (
        <p className="dw-mute" role="status">
          {message}
        </p>
      )}
    </details>
  );
}
function DebtComparison({ debts }) {
  const active = debts.filter((d) => d.active !== false && Number(d.balance) > 0);
  const [id, setId] = useState(""),
    [extra, setExtra] = useState(""),
    [now, setNow] = useState("");
  const debt = active.find((d) => d.id === id) || active[0];
  if (!debt) return null;
  const monthly = Math.max(Number(debt.plan_payment || 0), Number(debt.min_payment || 0));
  const valid = [extra, now].every(
    (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
  );
  const opts = {
    balance: Number(debt.balance),
    payment: monthly,
    apr: debt.apr == null ? null : Number(debt.apr),
    today: isoDate(),
    firstDate: nextDebtDate(debt,isoDate()),
    frequency: debt.pay_frequency || "monthly",
  };
  const base = estimatePayoff(opts),
    changed = valid
      ? estimatePayoff({ ...opts, extraMonthly: Number(extra || 0), extraNow: Number(now || 0) })
      : null;
  const summary = (r) =>
    !r
      ? "Enter valid amounts."
      : r.paidOff
        ? `${r.periods} ${debt.pay_frequency === "weekly" ? "weekly" : debt.pay_frequency === "biweekly" ? "biweekly" : "monthly"} payments · ${moneyFull(r.interest)} estimated interest · ${new Date(r.date+"T12:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`
        : "Payment does not pay this off within 100 years or does not cover interest.";
  return (
    <details className="dw-card">
      <summary className="dw-link">Compare debt payoff</summary>
      <p className="dw-mute">
        Try extra payments without changing your debt or making a payment. This is a monthly
        estimate; actual interest, fees, posting dates and payment cadence may differ.
      </p>
      <label className="dw-field">
        Compare debt
        <select value={debt.id} onChange={(e) => setId(e.target.value)}>
          {active.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <div className="dw-stat-row">
        <span>Saved amount each payment</span>
        <b>{moneyFull(monthly)}</b>
      </div>
      <label className="dw-field">
        Extra each month
        <input
          type="number"
          min="0"
          step="0.01"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
        />
      </label>
      <label className="dw-field">
        Extra payment now
        <input
          type="number"
          min="0"
          step="0.01"
          value={now}
          onChange={(e) => setNow(e.target.value)}
        />
      </label>
      {base?.unknownApr && (
        <p className="dw-mute">
          APR is missing. These figures assume no interest and understate the cost of an
          interest-bearing debt.
        </p>
      )}
      <p className="dw-mute">Current plan: {summary(base)}</p>
      <p className="dw-mute" role="status">
        With extra payments: {summary(changed)}
      </p>
      {base?.paidOff && changed?.paidOff && (
        <p className="dw-mute">
          About {Math.max(0, base.periods - changed.periods)} fewer payments and{" "}
          {moneyFull(Math.max(0, base.interest - changed.interest))} less interest.
        </p>
      )}
    </details>
  );
}
