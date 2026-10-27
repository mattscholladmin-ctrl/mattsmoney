// @ts-nocheck
import { useMemo, useState } from "react";
import {
  unmatchedAppleCharges,
  suggestedAppleParts,
  matchDueDates,
  validateAppleMatch,
  buildAppleMatch,
} from "../lib/apple-bill-match.js";
import { confirmAppleBillMatch } from "../lib/api.js";
import { moneyFull } from "../lib/dw-product.js";
export default function AppleBillMatcher({ data, onSaved }) {
  const charges = useMemo(
    () => unmatchedAppleCharges(data.transactions || []),
    [data.transactions],
  );
  const [selected, setSelected] = useState("");
  const charge = charges.find((t) => t.id === selected) || charges[0];
  const pending = (data.transactions || []).filter(
    (t) => t.pending && /apple/i.test(t.merchant || "") && Number(t.amount) > 0,
  ).length;
  if (!charge && !pending) return null;
  return (
    <section className="dw-card">
      <div className="dw-k">Apple bill matching</div>
      {pending > 0 && (
        <p className="dw-mute">
          {pending} pending Apple charge{pending === 1 ? "" : "s"}: waiting for posting. Pending
          charges cannot mark a bill paid.
        </p>
      )}
      {charge && (
        <>
          <p className="dw-mute">
            Confirm what the posted charge paid. Amount-only matches and previous splits are
            suggestions, and never save automatically.
          </p>
          <label className="dw-field">
            Posted Apple charge
            <select value={charge.id} onChange={(e) => setSelected(e.target.value)}>
              {charges.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.txn_date} · {moneyFull(t.amount)} · {t.merchant}
                </option>
              ))}
            </select>
          </label>
          <ChargeMatch key={charge.id} charge={charge} data={data} onSaved={onSaved} />
        </>
      )}
    </section>
  );
}
function ChargeMatch({ charge, data, onSaved }) {
  const bills = (data.bills || []).filter((b) => b.active !== false);
  const [parts, setParts] = useState(() => suggestedAppleParts(charge, bills, data.transactions));
  const [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const issue = validateAppleMatch(charge, bills, parts);
  const total = parts.reduce((s, p) => s + Math.round(Number(p.amount || 0) * 100), 0) / 100;
  const change = (id, patch) => {
    setReview(false);
    setError("");
    setParts((old) => old.map((p) => (p.bill_id === id ? { ...p, ...patch } : p)));
  };
  async function save(mode) {
    setBusy(true);
    setError("");
    try {
      await confirmAppleBillMatch(buildAppleMatch(charge, bills, parts, mode));
      setSaved(true);
      setReview(false);
    } catch (e) {
      setError(`${e.message} Reload before trying again.`);
      setReview(false);
      setBusy(false);
      return;
    }
    try {
      await onSaved?.();
    } catch (e) {
      setError("Match saved. Refresh the page to see the updated records.");
    } finally {
      setBusy(false);
    }
  }
  if (saved)
    return (
      <p role="status" className="dw-mute">
        Match saved. {error}
      </p>
    );
  return (
    <div>
      {bills.map((b) => {
        const p = parts.find((p) => p.bill_id === b.id),
          dates = matchDueDates(b, charge.txn_date).filter(
            (d) => !b.paid_through || d > b.paid_through,
          );
        return (
          <div key={b.id} style={{ marginTop: 10 }}>
            <label className="dw-plan-toggle">
              <input
                type="checkbox"
                checked={!!p}
                disabled={busy || !dates.length}
                onChange={(e) => {
                  setReview(false);
                  setParts((old) =>
                    e.target.checked
                      ? [
                          ...old,
                          {
                            bill_id: b.id,
                            amount: String(b.amount),
                            due_date: dates.reduce(
                              (a, d) =>
                                Math.abs(Date.parse(d) - Date.parse(charge.txn_date)) <
                                Math.abs(Date.parse(a) - Date.parse(charge.txn_date))
                                  ? d
                                  : a,
                              dates[0],
                            ),
                          },
                        ]
                      : old.filter((x) => x.bill_id !== b.id),
                  );
                }}
              />
              <span className="grow">
                <b>{b.name}</b>
                <span className="dw-mute"> · {moneyFull(b.amount)}</span>
              </span>
            </label>
            {p && (
              <div className="dw-form-grid">
                <label className="dw-field">
                  Payment toward {b.name}
                  <input
                    aria-label={`Payment toward ${b.name}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={p.amount}
                    disabled={busy}
                    onChange={(e) => change(b.id, { amount: e.target.value })}
                  />
                </label>
                <label className="dw-field">
                  Due date for {b.name}
                  <select
                    aria-label={`Due date for ${b.name}`}
                    value={p.due_date}
                    disabled={busy}
                    onChange={(e) => change(b.id, { due_date: e.target.value })}
                  >
                    {dates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        );
      })}
      <p className="dw-mute">
        Selected {moneyFull(total)} of {moneyFull(charge.amount)}. The total must match to the cent.
      </p>
      {issue && <p className="dw-mute">{issue}</p>}
      {error && (
        <p role="alert" className="dw-mute">
          {error}
        </p>
      )}
      {review ? (
        <div>
          <p className="dw-mute">
            Record this posted charge against the following bills? Full payments mark the selected
            due date paid; partial payments preserve the unpaid remainder. This does not make a
            payment or change bank balances.
          </p>
          <ul>
            {parts.map((p) => (
              <li key={p.bill_id}>
                {bills.find((b) => b.id === p.bill_id)?.name} · due {p.due_date} ·{" "}
                {moneyFull(p.amount)}
              </li>
            ))}
          </ul>
          <button className="dw-ctl-btn" disabled={busy || !!issue} onClick={() => save("match")}>
            {busy ? "Saving…" : "Confirm bill match"}
          </button>
          <button className="dw-link" disabled={busy} onClick={() => setReview(false)}>
            Keep editing
          </button>
        </div>
      ) : (
        <button className="dw-ctl-btn" disabled={busy || !!issue} onClick={() => setReview(true)}>
          Review bill match
        </button>
      )}
      <button
        className="dw-link"
        style={{ marginLeft: 12 }}
        disabled={busy}
        onClick={() => {
          setParts([]);
          setReview(false);
          setError("");
          save("not_bill");
        }}
      >
        This charge is not a bill payment
      </button>
    </div>
  );
}
