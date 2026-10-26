/** Run each connection independently and report partial failures truthfully. */
/** @param {any[]} items @param {(item:any)=>Promise<any>} syncBalances @param {(item:any)=>Promise<any>} syncTransactions */
export async function syncBankItems(items, syncBalances, syncTransactions) {
  const results = [];
  for (const item of items) {
    let balances = false,
      transactions = false;
    let error = null,
      errorCode = null;
    try {
      await syncBalances(item);
      balances = true;
      const result = await syncTransactions(item);
      transactions = result?.ready !== false;
      if (!transactions) {
        error = result?.error || "Transactions are not ready. Try refreshing again later.";
        errorCode = result?.error_code || null;
      }
    } catch (e) {
      errorCode = /** @type {any} */ (e)?.response?.data?.error_code || null;
      error =
        errorCode === "ITEM_LOGIN_REQUIRED"
          ? "Sign in again to repair this bank connection."
          : "This bank could not finish updating. Try again later.";
    }
    results.push({
      item_id: item.item_id,
      institution: item.institution_name || "Bank",
      balances,
      transactions,
      error,
      error_code: errorCode,
      needs_repair: errorCode === "ITEM_LOGIN_REQUIRED",
    });
  }
  return {
    ok: results.every((r) => r.balances && r.transactions),
    items: items.length,
    synced: results.filter((r) => r.balances && r.transactions).length,
    results,
  };
}
