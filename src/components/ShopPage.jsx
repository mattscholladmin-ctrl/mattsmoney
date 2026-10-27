// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { useShopping } from "../lib/use-shopping.js";
import {
  addIngredients,
  parseIngredients,
  parseReceipt,
  remindersText,
  remindersUrl,
  importLegacyShop,
} from "../lib/shop.js";
import { RECIPES } from "../lib/recipes.js";
import { moneyFull, CATEGORY_CATALOG } from "../lib/dw-product.js";
import { isoDate } from "../lib/format.js";

export default function ShopPage({
  userId = "demo",
  grocerySpend = 0,
  groceryBudget = null,
  monthLabel = "This month",
  transactions = [],
}) {
  const { data, edit, dirty, ready, busy, conflict, message, save, reload } = useShopping(userId);
  const [view, setView] = useState("hub"),
    [query, setQuery] = useState(""),
    [mealName, setMealName] = useState(""),
    [ingredients, setIngredients] = useState(""),
    [instructions, setInstructions] = useState("");
  const [item, setItem] = useState(""),
    [qty, setQty] = useState(""),
    [store, setStore] = useState("Groceries"),
    [staple, setStaple] = useState(""),
    [notice, setNotice] = useState("");
  const [receiptText, setReceiptText] = useState(""),
    [receipt, setReceipt] = useState(null),
    [ocrBusy, setOcrBusy] = useState(false),
    [ocrMessage, setOcrMessage] = useState("");
  const [editingMeal, setEditingMeal] = useState(null);
  const workerRef = useRef(null);
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );
  const recipes = RECIPES.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()));
  const total = data.items
    .filter((i) => !i.checked)
    .reduce((s, i) => s + Math.max(0, Number(i.estimatedCost || 0)), 0);
  const priced = data.items.filter(
    (i) => !i.checked && i.estimatedCost !== "" && i.estimatedCost != null,
  ).length;
  const unchecked = data.items.filter((i) => !i.checked).length;
  function updateItem(id, patch) {
    edit((d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  }
  function addMeal(recipe) {
    const meal = { ...recipe, id: crypto.randomUUID() };
    edit((d) => ({ ...d, meals: [...d.meals, meal] }));
    setNotice("Meal added. Use Add ingredients when you want it on the shopping list.");
  }
  function addCustom(e) {
    e.preventDefault();
    const parsed = parseIngredients(ingredients);
    if (!mealName.trim() || !parsed.length) {
      setNotice("Add a meal name and at least one ingredient.");
      return;
    }
    if (editingMeal) {
      edit((d) => ({
        ...d,
        meals: d.meals.map((m) =>
          m.id === editingMeal
            ? { ...m, name: mealName.trim(), ingredients: parsed, instructions }
            : m,
        ),
      }));
      setEditingMeal(null);
      setNotice("Meal updated in your draft.");
    } else addMeal({ name: mealName.trim(), ingredients: parsed, instructions });
    setMealName("");
    setIngredients("");
    setInstructions("");
  }
  async function copyList() {
    const text = remindersText(data);
    if (!text) {
      setNotice("Your shopping list is empty.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Shopping list copied.");
    } catch {
      setNotice("Copy is unavailable. Select the list text below to copy it.");
    }
  }
  function prepareReceipt(text) {
    const parsed = parseReceipt(text);
    setReceipt({
      ...parsed,
      date: isoDate(),
      total: parsed.total == null ? "" : String(parsed.total),
    });
    setReceiptText(text);
  }
  async function scan(file) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type) || file.size > 15 * 1024 * 1024) {
      setOcrMessage("Choose a PNG, JPEG, WebP or BMP image under 15 MB.");
      return;
    }
    setOcrBusy(true);
    setOcrMessage("Loading the local receipt reader. The image stays in this browser.");
    let worker = null,
      cancelled = false;
    const timeout = (promise, ms) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                "Receipt reading timed out. Try a smaller, clearer image or enter the text.",
              ),
            ),
          ms,
        );
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    try {
      const { createWorker } = await import("tesseract.js");
      const loading = createWorker("eng", 1, {
        workerPath: "/ocr/7.0.0/worker.min.js",
        corePath: "/ocr/7.0.0",
        langPath: "/ocr/7.0.0",
        workerBlobURL: false,
        logger: (m) => {
          if (!cancelled && m.status === "recognizing text")
            setOcrMessage(`Reading receipt: ${Math.round(m.progress * 100)}%`);
        },
      }).then((loaded) => {
        if (cancelled) {
          loaded.terminate();
          throw new Error("Reading cancelled.");
        }
        return loaded;
      });
      worker = await timeout(loading, 30000);
      workerRef.current = worker;
      const result = await timeout(worker.recognize(file), 45000);
      prepareReceipt(result.data.text);
      setOcrMessage("Review the extracted details. Nothing has been saved.");
    } catch (e) {
      setOcrMessage(
        `Could not read this image. You can paste or type the receipt text below. ${e.message}`,
      );
    } finally {
      cancelled = true;
      await worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      setOcrBusy(false);
    }
  }
  function confirmReceipt() {
    if (
      !receipt?.merchant.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(receipt.date) ||
      !Number.isFinite(Number(receipt.total)) ||
      Number(receipt.total) <= 0 ||
      receipt.items.some((i) => !Number.isFinite(Number(i.amount)))
    ) {
      setNotice("Confirm a merchant, date and positive total first.");
      return;
    }
    edit((d) => ({
      ...d,
      receipts: [
        ...d.receipts,
        { ...receipt, id: crypto.randomUUID(), total: Number(receipt.total), reviewed: true },
      ],
    }));
    setReceipt(null);
    setReceiptText("");
    setOcrMessage("");
    setNotice(
      "Reviewed receipt added to shopping changes. Save changes to sync it. It does not add a budget transaction.",
    );
  }
  return (
    <div className="dw-page">
      <header className="dw-page-h">
        <div>
          <h1>Shop</h1>
          <p className="dw-sub">Meals, groceries, and your shopping list.</p>
        </div>
      </header>
      <section className="dw-card">
        <p className="dw-mute" role="status">
          {message}
        </p>
        <div className="dw-review-ctrl">
          <button
            className="dw-ctl-btn"
            disabled={!dirty || !ready || busy || conflict}
            onClick={save}
          >
            {busy ? "Saving…" : "Save shopping changes"}
          </button>
          <button className="dw-link" disabled={busy} onClick={reload}>
            {dirty ? "Discard draft and reload account list" : "Reload account list"}
          </button>
        </div>
      </section>
      <div className="dw-review-tabs" style={{ flexWrap: "wrap", margin: "16px 0" }}>
        {["hub", "meals", "list", "staples", "receipts"].map((v) => (
          <button
            key={v}
            className={view === v ? "on" : ""}
            onClick={() => {
              setView(v);
              setNotice("");
            }}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>
      {notice && (
        <p className="dw-mute" role="status">
          {notice}
        </p>
      )}
      {view === "hub" && (
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-k">Grocery spending · {monthLabel}</div>
            <div className="dw-stat-row">
              <span>Saved transactions</span>
              <b>{moneyFull(grocerySpend)}</b>
            </div>
            <div className="dw-stat-row">
              <span>Monthly grocery budget</span>
              <b>{groceryBudget == null ? "Not set" : moneyFull(groceryBudget)}</b>
            </div>
            <p className="dw-mute">
              Uses the same grocery category and visibility choices as Insights. Receipts are
              separate until matched to a transaction; saving a receipt does not count it again.
            </p>
          </section>
          <section className="dw-card">
            <div className="dw-k">Shopping list</div>
            <p className="dw-mute">
              {unchecked} unchecked items · {priced} have your estimated prices.
            </p>
            <div className="dw-stat-row">
              <span>Estimated cost of priced items</span>
              <b>{moneyFull(total)}</b>
            </div>
            {priced < unchecked && (
              <p className="dw-mute">
                The estimate is incomplete until every item has a price. These are your estimates,
                not live store prices.
              </p>
            )}
            <button className="dw-link" onClick={() => setView("list")}>
              Open shopping list →
            </button>
          </section>
          <section className="dw-card">
            <div className="dw-k">Planned meals</div>
            {!data.meals.length && (
              <p className="dw-mute">Choose a starter recipe or add your own.</p>
            )}
            {data.meals.map((m) => (
              <p className="dw-mute" key={m.id}>
                {m.name}
              </p>
            ))}
            <button className="dw-link" onClick={() => setView("meals")}>
              Plan meals →
            </button>
          </section>
          <details className="dw-card">
            <summary className="dw-link">Import the previous list from this browser</summary>
            <p className="dw-mute">
              This replaces your unsaved shopping draft. Sample Ingredient A/B entries are excluded.
              Your account version stays unchanged until you save.
            </p>
            <button
              className="dw-ctl-btn"
              onClick={() => {
                try {
                  const raw = localStorage.getItem("mm.shop.v1");
                  if (!raw) throw Error("No previous list found.");
                  edit(importLegacyShop(raw));
                  setNotice("Previous list imported into your draft. Review it before saving.");
                } catch (e) {
                  setNotice(e.message);
                }
              }}
            >
              Import previous list
            </button>
          </details>
        </div>
      )}
      {view === "meals" && (
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-k">Your meal plan</div>
            {data.meals.map((m) => (
              <details key={m.id} style={{ margin: "12px 0" }}>
                <summary className="dw-link">{m.name}</summary>
                <p className="dw-mute">{m.instructions}</p>
                <ul className="dw-mute">
                  {m.ingredients.map((i, j) => (
                    <li key={j}>
                      {i.qty} {i.name}
                    </li>
                  ))}
                </ul>
                <button
                  className="dw-ctl-btn"
                  onClick={() => {
                    edit((d) => addIngredients(d, m.ingredients, store));
                    setNotice(
                      "Ingredients added. Staples were skipped; shared ingredients keep both quantities.",
                    );
                  }}
                >
                  Add ingredients to list
                </button>
                <button
                  className="dw-link"
                  style={{ marginLeft: 12 }}
                  onClick={() => {
                    setEditingMeal(m.id);
                    setMealName(m.name);
                    setIngredients(m.ingredients.map((i) => `${i.name} | ${i.qty}`).join("\n"));
                    setInstructions(m.instructions || "");
                    setNotice("Edit the recipe in the form below.");
                  }}
                >
                  Edit meal
                </button>
                <button
                  className="dw-link"
                  style={{ marginLeft: 12 }}
                  onClick={() =>
                    edit((d) => ({ ...d, meals: d.meals.filter((x) => x.id !== m.id) }))
                  }
                >
                  Remove meal
                </button>
              </details>
            ))}
          </section>
          <section className="dw-card">
            <div className="dw-k">Starter recipes</div>
            <label className="dw-field">
              Find a starter recipe
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {recipes.map((r) => (
              <details key={r.id}>
                <summary className="dw-link">
                  {r.name} · {r.servings} servings
                </summary>
                <p className="dw-mute">{r.instructions}</p>
                <ul className="dw-mute">
                  {r.ingredients.map((i) => (
                    <li key={i.name}>
                      {i.qty} {i.name}
                    </li>
                  ))}
                </ul>
                <button className="dw-ctl-btn" onClick={() => addMeal(r)}>
                  Add this meal
                </button>
              </details>
            ))}
          </section>
          <section className="dw-card">
            <div className="dw-k">{editingMeal ? "Edit your recipe" : "Add your own recipe"}</div>
            <form onSubmit={addCustom}>
              <label className="dw-field">
                Meal name
                <input value={mealName} onChange={(e) => setMealName(e.target.value)} required />
              </label>
              <label className="dw-field">
                Ingredients, one per line
                <textarea
                  value={ingredients}
                  onChange={(e) => setIngredients(e.target.value)}
                  placeholder={"Rice | 1 cup\nBeans | 1 can"}
                  required
                />
              </label>
              <label className="dw-field">
                Instructions
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </label>
              <button className="dw-ctl-btn">
                {editingMeal ? "Save meal edits" : "Add custom meal"}
              </button>
            </form>
          </section>
        </div>
      )}
      {view === "list" && (
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-k">Reminders</div>
            <p className="dw-mute">
              Copy the list, or run your Apple Shortcut with the list as text input. The shortcut
              must already exist on this device.
            </p>
            <button className="dw-ctl-btn" onClick={copyList}>
              Copy shopping list
            </button>
            <label className="dw-field">
              Apple Shortcut name
              <input
                value={data.remindersShortcut || ""}
                onChange={(e) => edit((d) => ({ ...d, remindersShortcut: e.target.value }))}
              />
            </label>
            {remindersUrl(data) ? (
              <a className="dw-ctl-btn" href={remindersUrl(data)}>
                Run Reminders shortcut
              </a>
            ) : (
              <>
                <button className="dw-ctl-btn" disabled>
                  Run Reminders shortcut
                </button>
                <p className="dw-mute">
                  {!String(data.remindersShortcut || "").trim()
                    ? "Enter your Apple Shortcut name above to enable this button."
                    : "Add an unchecked item to your list to enable this button."}
                </p>
              </>
            )}
            <details>
              <summary className="dw-link">Shortcut setup and list text</summary>
              <p className="dw-mute">
                In Apple Shortcuts, create a shortcut with the name above. Split Shortcut Input by
                new lines, repeat each line, and add Repeat Item as a reminder to your shopping
                list. Use Run Reminders shortcut above on your Mac or iPhone.
              </p>
              <textarea
                aria-label="Shopping list text"
                readOnly
                value={remindersText(data)}
                style={{ width: "100%" }}
              />
            </details>
          </section>
          <section className="dw-card">
            <div className="dw-k">Shopping list</div>
            <label className="dw-field">
              Store for new items
              <input value={store} onChange={(e) => setStore(e.target.value)} />
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!item.trim()) return;
                edit((d) => addIngredients(d, [{ name: item, qty }], store || "Groceries"));
                setItem("");
                setQty("");
              }}
            >
              <label className="dw-field">
                Item name
                <input value={item} onChange={(e) => setItem(e.target.value)} />
              </label>
              <label className="dw-field">
                Quantity
                <input value={qty} onChange={(e) => setQty(e.target.value)} />
              </label>
              <button className="dw-ctl-btn">Add shopping item</button>
            </form>
            {[...new Set(data.items.map((i) => i.store))].map((s) => (
              <section key={s}>
                <h2 className="dw-h2">{s}</h2>
                {data.items
                  .filter((i) => i.store === s)
                  .map((i) => (
                    <div
                      key={i.id}
                      style={{ padding: "12px 0", borderBottom: "1px solid var(--dw-line)" }}
                    >
                      <label className="dw-field-row">
                        <span>
                          <input
                            type="checkbox"
                            checked={Boolean(i.checked)}
                            onChange={(e) => updateItem(i.id, { checked: e.target.checked })}
                          />{" "}
                          {i.name}
                        </span>
                      </label>
                      <label className="dw-field">
                        Quantity for {i.name}
                        <input
                          value={i.qty}
                          onChange={(e) => updateItem(i.id, { qty: e.target.value })}
                        />
                      </label>
                      <label className="dw-field">
                        Estimated line cost for {i.name}
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={i.estimatedCost}
                          onChange={(e) => updateItem(i.id, { estimatedCost: e.target.value })}
                        />
                      </label>
                      <button
                        className="dw-link"
                        onClick={() =>
                          edit((d) => ({ ...d, items: d.items.filter((x) => x.id !== i.id) }))
                        }
                      >
                        Remove item
                      </button>
                    </div>
                  ))}
              </section>
            ))}
          </section>
        </div>
      )}
      {view === "staples" && (
        <section className="dw-card">
          <div className="dw-k">Staples on hand</div>
          <p className="dw-mute">
            These are skipped when adding recipe ingredients. Existing list items stay until you
            remove them.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!staple.trim()) return;
              edit((d) => ({ ...d, staples: [...new Set([...d.staples, staple.trim()])] }));
              setStaple("");
            }}
          >
            <label className="dw-field">
              Staple name
              <input value={staple} onChange={(e) => setStaple(e.target.value)} />
            </label>
            <button className="dw-ctl-btn">Add staple</button>
          </form>
          {data.staples.map((s) => (
            <div className="dw-stat-row" key={s}>
              <span>{s}</span>
              <button
                className="dw-link"
                onClick={() => edit((d) => ({ ...d, staples: d.staples.filter((x) => x !== s) }))}
              >
                Remove staple
              </button>
            </div>
          ))}
        </section>
      )}
      {view === "receipts" && (
        <div className="dw-col-stack">
          <section className="dw-card">
            <div className="dw-k">Read a receipt</div>
            <p className="dw-mute">
              Choose an image to read locally in your browser. Nothing is saved until you review it
              and save shopping changes. Recognition can make mistakes.
            </p>
            <label className="dw-field">
              Receipt image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/bmp"
                disabled={ocrBusy}
                onChange={(e) => scan(e.target.files?.[0])}
              />
            </label>
            {ocrMessage && (
              <p className="dw-mute" role="status">
                {ocrMessage}
              </p>
            )}
            <label className="dw-field">
              Receipt text
              <textarea value={receiptText} onChange={(e) => setReceiptText(e.target.value)} />
            </label>
            <button
              className="dw-ctl-btn"
              disabled={!receiptText.trim() || ocrBusy}
              onClick={() => prepareReceipt(receiptText)}
            >
              Review receipt text
            </button>
            {receipt && (
              <>
                <label className="dw-field">
                  Receipt merchant
                  <input
                    value={receipt.merchant}
                    onChange={(e) => setReceipt({ ...receipt, merchant: e.target.value })}
                  />
                </label>
                <label className="dw-field">
                  Receipt date
                  <input
                    type="date"
                    value={receipt.date}
                    onChange={(e) => setReceipt({ ...receipt, date: e.target.value })}
                  />
                </label>
                <label className="dw-field">
                  Receipt total
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={receipt.total}
                    onChange={(e) => setReceipt({ ...receipt, total: e.target.value })}
                  />
                </label>
                {receipt.items.map((i, j) => (
                  <div key={j}>
                    <label className="dw-field">
                      Receipt item name
                      <input
                        value={i.name}
                        onChange={(e) =>
                          setReceipt({
                            ...receipt,
                            items: receipt.items.map((x, k) =>
                              k === j ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="dw-field">
                      Item category
                      <select
                        value={i.category}
                        onChange={(e) =>
                          setReceipt({
                            ...receipt,
                            items: receipt.items.map((x, k) =>
                              k === j ? { ...x, category: e.target.value } : x,
                            ),
                          })
                        }
                      >
                        {CATEGORY_CATALOG.map((c) => (
                          <option key={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="dw-field">
                      Receipt item amount
                      <input
                        type="number"
                        step="0.01"
                        value={i.amount}
                        onChange={(e) =>
                          setReceipt({
                            ...receipt,
                            items: receipt.items.map((x, k) =>
                              k === j ? { ...x, amount: Number(e.target.value) } : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
                <p className="dw-mute">
                  Extracted item sum:{" "}
                  {moneyFull(receipt.items.reduce((s, i) => s + Number(i.amount || 0), 0))}. Tax,
                  discounts or missed lines may explain a difference from the total.
                </p>
                <label className="dw-field">
                  Match an existing grocery transaction, optional
                  <select
                    value={receipt.transaction_id || ""}
                    onChange={(e) => setReceipt({ ...receipt, transaction_id: e.target.value })}
                  >
                    <option value="">Not matched</option>
                    {transactions
                      .filter(
                        (t) => !t.pending && t.category === "Groceries" && Number(t.amount) > 0,
                      )
                      .slice(0, 100)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.txn_date} · {t.merchant} · {moneyFull(t.amount)}
                        </option>
                      ))}
                  </select>
                </label>
                <button className="dw-ctl-btn" onClick={confirmReceipt}>
                  Add reviewed receipt
                </button>
              </>
            )}
          </section>
          <section className="dw-card">
            <div className="dw-k">Reviewed receipts</div>
            {!data.receipts.length && <p className="dw-mute">No receipts saved yet.</p>}
            {data.receipts.map((r) => (
              <details key={r.id}>
                <summary className="dw-link">
                  {r.merchant} · {r.date} · {moneyFull(r.total)}
                </summary>
                {r.transaction_id && (
                  <p className="dw-mute">Matched to a saved budget transaction.</p>
                )}
                {r.items.map((i, j) => (
                  <p className="dw-mute" key={j}>
                    {i.name} · {moneyFull(i.amount)} · {i.category}
                  </p>
                ))}
                <button
                  className="dw-link"
                  onClick={() =>
                    edit((d) => ({ ...d, receipts: d.receipts.filter((x) => x.id !== r.id) }))
                  }
                >
                  Remove receipt
                </button>
              </details>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}
