// @ts-nocheck
export const emptyShop = () => ({
  version: 2,
  meals: [],
  items: [],
  staples: [],
  receipts: [],
  remindersShortcut: "Matt's Money Shopping List",
});
export function cleanShop(value) {
  const out = { ...emptyShop(), ...(value && typeof value === "object" ? value : {}), version: 2 };
  for (const key of ["meals", "items", "staples", "receipts"])
    if (!Array.isArray(out[key])) out[key] = [];
  return out;
}
const key = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();
export function addIngredients(shop, ingredients, store = "Groceries") {
  const next = cleanShop(structuredClone(shop));
  const staples = new Set(next.staples.map(key));
  for (const ingredient of ingredients) {
    if (!key(ingredient.name) || staples.has(key(ingredient.name))) continue;
    const existing = next.items.find(
      (i) => !i.checked && key(i.name) === key(ingredient.name) && key(i.store) === key(store),
    );
    if (existing) {
      if (ingredient.qty) existing.qty = [existing.qty, ingredient.qty].filter(Boolean).join(" + ");
    } else
      next.items.push({
        id: crypto.randomUUID(),
        name: String(ingredient.name).trim(),
        qty: ingredient.qty || "",
        store,
        checked: false,
        estimatedCost: "",
      });
  }
  return next;
}
export function parseIngredients(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...quantity] = line.split("|");
      return { name: name.trim(), qty: quantity.join("|").trim() };
    })
    .filter((i) => i.name);
}
export function remindersText(shop) {
  return shop.items
    .filter((i) => !i.checked)
    .map((i) => [i.qty, i.name, i.store ? `(${i.store})` : ""].filter(Boolean).join(" "))
    .join("\n");
}
export function remindersUrl(shop) {
  const name = String(shop.remindersShortcut || "").trim();
  const text = remindersText(shop);
  return name && text
    ? `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}`
    : null;
}
// Receipt recognition is only a draft. The user must verify merchant/date/total.
export function parseReceipt(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const totals = lines.filter(
    (l) => /\b(total|amount due|balance due)\b/i.test(l) && !/sub.?total|savings|discount/i.test(l),
  );
  const match = totals.at(-1)?.match(/(-?\d[\d,]*[.]\d{2})\s*$/);
  const items = lines
    .filter(
      (l) =>
        !/(sub.?total|total|tax|change|cash|visa|mastercard|debit|credit|card|tender|balance)/i.test(
          l,
        ),
    )
    .map((l) => {
      const m = l.match(/^(.+?)\s+\$?(\d+[.]\d{2})\s*$/);
      return m ? { name: m[1].trim(), amount: Number(m[2]), category: "Groceries" } : null;
    })
    .filter(Boolean);
  return {
    merchant: lines[0] || "",
    total: match ? Number(match[1].replaceAll(",", "")) : null,
    items,
  };
}
export function importLegacyShop(value) {
  const old = typeof value === "string" ? JSON.parse(value) : value;
  const next = emptyShop();
  next.staples = Array.isArray(old.staples) ? old.staples : [];
  next.meals = (old.meals || []).map((m) => ({
    ...m,
    id: String(m.id),
    ingredients: (m.ingredients || []).filter((i) => !/^Ingredient [AB]$/i.test(i.name || "")),
  }));
  next.items = (old.list || []).flatMap((g) =>
    (g.items || [])
      .filter((i) => !/^Ingredient [AB]$/i.test(i.name || ""))
      .map((i) => ({ ...i, id: crypto.randomUUID(), store: g.store, estimatedCost: "" })),
  );
  return next;
}
