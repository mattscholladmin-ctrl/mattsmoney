import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";

async function verifyRequests() {
  const requests = [],
    context = vm.createContext({ console, URL, Date, process: { env: {} } });
  const source = await readFile(new URL("../src/lib/plaidClient.js", import.meta.url), "utf8");
  context.fetch = async (url, opts) => {
    requests.push({ url, ...opts });
    return { ok: true, json: async () => ({ link_token: "test-link" }) };
  };
  const client = new vm.SourceTextModule(source, { context });
  await client.link(async () => {
    const m = new vm.SyntheticModule(
      ["isSupabaseConfigured", "supabase"],
      function () {
        this.setExport("isSupabaseConfigured", true);
        this.setExport("supabase", {
          auth: {
            getSession: async () => ({ data: { session: { access_token: "test-session" } } }),
          },
        });
      },
      { context },
    );
    return m;
  });
  await client.evaluate();
  await client.namespace.createLinkToken("existing-owned-item");
  assert.deepEqual(JSON.parse(requests[0].body), {
    action: "link-token",
    item_id: "existing-owned-item",
  });
  assert.equal(requests[0].headers.Authorization, "Bearer test-session");
  await client.namespace.createLinkToken();
  assert.deepEqual(JSON.parse(requests[1].body), { action: "link-token" });
  const providerCalls = [],
    server = new vm.SourceTextModule(
      await readFile(new URL("../api/plaid.js", import.meta.url), "utf8"),
      { context },
    );
  const exports = {
    getUserFromRequest: async () => ({ id: "owner" }),
    adminClient: () => ({}),
    plaidClient: () => ({
      linkTokenCreate: async (opts) => {
        providerCalls.push(opts);
        return { data: { link_token: "provider-link" } };
      },
    }),
    readBody: async (req) => req.body,
    listItems: async () => [
      { item_id: "existing-owned-item", access_token: "private-provider-token" },
    ],
    Products: { Transactions: "transactions", Liabilities: "liabilities" },
    CountryCode: { Us: "US" },
    syncBankItems: () => {},
    plaidError: () => {},
    saveItem: () => {},
    syncItemAccounts: () => {},
    syncItemTransactions: () => {},
    cleanupUnlinkedAccounts: () => {},
  };
  await server.link(async (spec) => {
    const names = spec.includes("googleServer")
      ? ["getUserFromRequest", "adminClient"]
      : spec === "plaid"
        ? ["Products", "CountryCode"]
        : spec.includes("bank-sync")
          ? ["syncBankItems"]
          : [
              "plaidClient",
              "plaidError",
              "saveItem",
              "listItems",
              "syncItemAccounts",
              "syncItemTransactions",
              "cleanupUnlinkedAccounts",
              "readBody",
            ];
    return new vm.SyntheticModule(
      names,
      function () {
        for (const name of names) this.setExport(name, exports[name]);
      },
      { context },
    );
  });
  await server.evaluate();
  const response = () => ({
    code: 0,
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });
  let res = response();
  await server.namespace.default({ method: "POST", body: JSON.parse(requests[0].body) }, res);
  assert.equal(res.code, 200);
  assert.equal(providerCalls[0].access_token, "private-provider-token");
  assert.equal("products" in providerCalls[0], false);
  assert.equal("optional_products" in providerCalls[0], false);
  assert.equal(JSON.stringify(res.body).includes("private-provider-token"), false);
  res = response();
  await server.namespace.default(
    { method: "POST", body: { action: "link-token", item_id: "another-users-item" } },
    res,
  );
  assert.equal(res.code, 404);
  assert.equal(providerCalls.length, 1);
  res = response();
  await server.namespace.default({ method: "POST", body: { action: "link-token" } }, res);
  assert.equal(res.code, 200);
  assert.equal(providerCalls[1].products[0], "transactions");
  assert.equal("access_token" in providerCalls[1], false);
}
if (process.argv[2] === "verify") await verifyRequests();
else
  test("reconnect keeps the existing item through client and provider, rejects unowned items, and omits new-connection products", () => {
    execFileSync(
      process.execPath,
      ["--experimental-vm-modules", fileURLToPath(import.meta.url), "verify"],
      { stdio: "pipe" },
    );
  });
