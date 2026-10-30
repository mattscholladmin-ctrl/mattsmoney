// @ts-nocheck
import { accountSummaries } from '../lib/budget.js';
import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import {
  createLinkToken,
  exchangePublicToken,
  plaidStatus,
  refreshPlaid,
  disconnectPlaid,
} from "../lib/plaidClient";
import { shortDate, money } from "../lib/format";
import AccountOrderCard from "./AccountOrderCard";

function accountTitle(name, mask) {
  let n = String(name || "Account")
    .replace(/\s+/g, " ")
    .trim();
  n = n.replace(/\b(\S+)(?:\s+\1\b)+/gi, "$1");
  n = n
    .replace(/\bdepository\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = String(mask || "").trim();
  if (m && n.includes(m)) n = n.replaceAll(m, "").replace(/\s+/g, " ").trim();
  return m ? `${n} ··${m}` : n;
}

const LS_TOKEN = "plaid.link_token";

export default function ConnectBankCard({ onChanged, accounts = [], balances = [], plain = false, onToggle }) {
  const savedAccounts = accountSummaries(accounts, balances);
  const [linkToken, setLinkToken] = useState(null);
  const [repairId, setRepairId] = useState(null);
  const [syncMessage, setSyncMessage] = useState("");
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const { items } = await plaidStatus();
      setItems(items || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // OAuth banks bounce out and back with ?oauth_state_id=... — resume with the
  // token we stashed before leaving.
  const isOAuthReturn =
    typeof window !== "undefined" && window.location.search.includes("oauth_state_id");

  useEffect(() => {
    if (isOAuthReturn) {
      const saved = localStorage.getItem(LS_TOKEN);
      if (saved) {
        setBusy(true);
        setRepairId(localStorage.getItem("plaid.repair_item") || null);
        setLinkToken(saved);
      }
    }
  }, [isOAuthReturn]);

  async function toggleAccount(account, included) {
    if (busy) return;
    setBusy(true);setError(null);
    try { await onToggle?.(account.id, !included) }
    catch (e) { setError(e.message || 'Could not save the account setting. Try again.') }
    finally { setBusy(false) }
  }
  const start = async (itemId = null) => {
    setRepairId(typeof itemId === "string" ? itemId : null);
    setError(null);
    setBusy(true);
    try {
      const { link_token } = await createLinkToken(typeof itemId === "string" ? itemId : undefined);
      localStorage.setItem(LS_TOKEN, link_token);
      if (typeof itemId === "string") localStorage.setItem("plaid.repair_item", itemId);
      else localStorage.removeItem("plaid.repair_item");
      setLinkToken(link_token);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const onSuccess = useCallback(
    async (public_token) => {
      try {
        let reconnectResult = null;
        if (repairId) {
          const result = await refreshPlaid();
          reconnectResult = result;
          setSyncMessage(
            result.ok
              ? "Bank access reconnected and balances refreshed."
              : "Bank access reconnected, but some balances or transactions could not refresh. Check the bank status below.",
          );
        } else await exchangePublicToken(public_token);
        localStorage.removeItem(LS_TOKEN);
        localStorage.removeItem("plaid.repair_item");
        window.history.replaceState({}, "", window.location.pathname);
        await loadStatus();
        if (reconnectResult?.results)
          setItems((old) =>
            old.map((it) => {
              const outcome = reconnectResult.results.find((r) => r.item_id === it.item_id);
              return outcome?.error
                ? { ...it, error: outcome.error, needs_repair: outcome.needs_repair }
                : it;
            }),
          );
        onChanged?.();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
        setLinkToken(null);
      }
    },
    [loadStatus, onChanged, repairId],
  );

  const config = {
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      setBusy(false);
      setLinkToken(null);
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem("plaid.repair_item");
      if (err) setError(err.display_message || err.error_message || "Connection cancelled");
    },
  };
  if (isOAuthReturn) config.receivedRedirectUri = window.location.href;

  const { open, ready } = usePlaidLink(config);

  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, ready, open]);

  const refresh = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await refreshPlaid();
      setSyncMessage(
        result.ok
          ? `Updated ${result.synced} bank connection${result.synced === 1 ? "" : "s"}.`
          : `Updated ${result.synced} of ${result.items} connections. Some balances or transactions could not be updated.`,
      );
      await loadStatus();
      if (result.results)
        setItems((old) =>
          old.map((it) => {
            const r = result.results.find((r) => r.item_id === it.item_id);
            return r?.error ? { ...it, error: r.error, needs_repair: r.needs_repair } : it;
          }),
        );
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (item_id) => {
    setError(null);
    setBusy(true);
    try {
      await disconnectPlaid(item_id);
      await loadStatus();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={plain ? "dw-flat dw-bank-connections" : "rounded-2xl bg-white p-5 shadow space-y-3"}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800">Bank &amp; card connections</h2>
          <p className="text-sm text-slate-500">Linked accounts pull balances automatically.</p>
        </div>
        {items.length > 0 && (
          <button
            onClick={refresh}
            disabled={busy}
            className="text-sm font-semibold text-emerald-700 disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {syncMessage && (
        <p className="dw-mute" role="status">
          {syncMessage}
        </p>
      )}
      {items.map((it) => (
        <div key={it.item_id} className="dw-bank">
          <div className="dw-bank-h">
            <div>
              <b>{it.institution || "Bank"}</b>
              {it.transaction_bank_updated_at && (
                <span>
                  Bank transaction update{" "}
                  {new Date(it.transaction_bank_updated_at).toLocaleString()}
                </span>
              )}
              <span>
                {it.updated_at
                  ? `Last saved balance sync ${new Date(it.updated_at).toLocaleString()}`
                  : "Connected"}
              </span>
            </div>
            <button type="button" onClick={() => disconnect(it.item_id)} disabled={busy}>
              Disconnect
            </button>
          </div>
          {it.error && (
            <p className="dw-mute" role="alert">
              {it.error}
            </p>
          )}
          {
            <button
              type="button"
              className="dw-ctl-btn"
              disabled={busy}
              onClick={() => start(it.item_id)}
            >
              {it.needs_repair ? "Repair connection" : "Reconnect bank access"}
            </button>
          }
          {(it.accounts || []).map((a, i) => {
            const mask = String(a.mask || "").trim();
            const matches = savedAccounts.filter(
              (x) => mask && (String(x.mask || "") === mask || String(x.name || "").includes(mask)),
            );
            const app =
              matches.length === 1
                ? matches[0]
                : matches.find((x) => x.plaid_item_id === it.item_id);
            const included = app
              ? (app.include_in_spendable === true ||
                  (app.include_in_spendable == null && app.kind !== "savings")) &&
                !app.hidden
              : false;
            return (
              <div key={i} className="dw-plan-toggle">
                {app && (
                  <button
                    type="button"
                    className={`dw-switch${included ? " on" : ""}`}
                    aria-pressed={included}
                    aria-label={`Include ${app.name} in Safe to Spend`}
                    disabled={busy}
                    onClick={() => toggleAccount(app, included)}
                  />
                )}
                <span className="grow">
                  <b>{accountTitle(a.name, a.mask)}</b>
                  <em>
                    {app ? (included ? "In safe to spend" : "Left out") : a.subtype || a.type || ""}
                  </em>
                </span>
                <span className="dw-amt">
                  {app?.balance != null ? money(app.balance) : "No available balance"}
                  <em>{app?.asOf ? `Saved balance used by Home · ${app.asOf}` : "No saved balance"}</em>
                  {app && a.available != null && Number(a.available) !== Number(app.balance) && <em role="status">The bank reports a newer balance. Refresh to update the app.</em>}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {accounts
        .filter(
          (x) =>
            !items.some((it) =>
              it.accounts.some((a) => {
                const mask = String(a.mask || "").trim();
                return (
                  mask && (String(x.mask || "") === mask || String(x.name || "").includes(mask))
                );
              }),
            ),
        )
        .map((a) => {
          const included =
            (a.include_in_spendable === true ||
              (a.include_in_spendable == null && a.kind !== "savings")) &&
            !a.hidden;
          return (
            <div key={a.id} className="dw-plan-toggle">
              <button
                type="button"
                className={`dw-switch${included ? " on" : ""}`}
                aria-pressed={included}
                    aria-label={`Include ${a.name} in Safe to Spend`}
                disabled={busy}
                onClick={() => toggleAccount(a, included)}
              />
              <span className="grow">
                <b>{a.name}</b>
                <em>{included ? "In safe to spend" : "Left out"}</em>
              </span>
            </div>
          );
        })}

      <button
        onClick={start}
        disabled={busy}
        className="w-full rounded-lg bg-emerald-700 text-white font-semibold px-4 py-2.5 disabled:opacity-60"
      >
        {busy ? "Working…" : items.length ? "+ Connect another" : "+ Connect a bank or card"}
      </button>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {!plain && <AccountOrderCard accounts={accounts} onChanged={onChanged} embedded />}
    </section>
  );
}
