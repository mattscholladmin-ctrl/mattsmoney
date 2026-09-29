export function paidOnlyPlugin() {
  return {
    name: 'paid-only-bills',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/lib/budget.js')) return null
      const needle = "return merchantMatchesBill(occ.name || '', t.merchant || '')"
      if (!code.includes(needle)) return null
      return { code: code.replace(needle, 'return false'), map: null }
    },
  }
}
