// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Free-position tile layout: each tile has a real {x, y, w, h} grid position
// (in grid units), so it can be dragged into ANY open spot — not locked to
// one of two fixed columns like the old system was. One arrangement is
// persisted per breakpoint bucket (mobile/tablet/desktop/wide), each with its
// own column count, so a phone still gets a sensible single-column stack.
//
// Unknown ids are dropped and new tiles appended at the bottom, so a saved
// layout never hides a feature added later.

function loadJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v ?? fallback
  } catch {
    return fallback
  }
}
function saveJson(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

// Every tile defaults to the same width (in grid units); only the total
// column count changes per breakpoint, so more tiles fit per row on a wider
// screen while each tile's default footprint (how many "slots" it fills)
// stays the same as before — 1 per row on a phone, 2 on a laptop, 3 on a
// desktop, 4 on a very wide monitor.
export const TILE_W = 4
export const BREAKPOINTS = [
  { key: 'mobile', minWidth: 0, cols: TILE_W * 1 },
  { key: 'tablet', minWidth: 640, cols: TILE_W * 2 },
  { key: 'desktop', minWidth: 1280, cols: TILE_W * 3 },
  { key: 'wide', minWidth: 1800, cols: TILE_W * 4 },
]

export function useBreakpoint() {
  const compute = () => {
    if (typeof window === 'undefined') return BREAKPOINTS[0]
    const w = window.innerWidth
    let b = BREAKPOINTS[0]
    for (const bp of BREAKPOINTS) if (w >= bp.minWidth) b = bp
    return b
  }
  const [bp, setBp] = useState(compute)
  useEffect(() => {
    const onResize = () => setBp(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return bp
}

// A sensible first-time arrangement: tiles in their given order, stacked
// top-to-bottom, TILE_W wide, wrapping to a new row once `cols` is full.
// Height is a placeholder (~160px at the default row unit) until each tile
// reports its real measured height.
const DEFAULT_H = 40
// react-grid-layout normalizes every item it touches to include `moved` and
// `static` — if our own layout objects omit them, its internal deep-equal
// check against our props never resolves (one side always has extra fields),
// and it re-syncs forever. Include them ourselves so both sides match.
function tileItem(id, x, y, w, h) {
  return { i: id, x, y, w, h, moved: false, static: false }
}
function defaultLayout(ids, cols) {
  const perRow = Math.max(1, Math.floor(cols / TILE_W))
  return ids.map((id, i) => tileItem(id, (i % perRow) * TILE_W, Math.floor(i / perRow) * DEFAULT_H, TILE_W, DEFAULT_H))
}

// Drop unknown ids, keep known ones' saved position, append any tile that's
// new since this layout was last saved (bottom of the arrangement, using the
// widest current row so it doesn't collide with existing items).
function reconcile(layout, ids, cols) {
  const known = new Set(ids)
  const kept = (layout || []).filter((it) => known.has(it.i))
  const have = new Set(kept.map((it) => it.i))
  const missing = ids.filter((id) => !have.has(id))
  if (!missing.length) return kept
  const maxY = kept.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  const perRow = Math.max(1, Math.floor(cols / TILE_W))
  const appended = missing.map((id, i) =>
    tileItem(id, (i % perRow) * TILE_W, maxY + Math.floor(i / perRow) * DEFAULT_H, TILE_W, DEFAULT_H)
  )
  return [...kept, ...appended]
}

// Greedy top-to-bottom, left-to-right repack by REAL height — same idea as
// the old count-based/height-based auto-arrange, adapted to free x/y
// coordinates. Walks tiles in reading order (top-left to bottom-right of
// their current layout) and lays them out compactly, closing any gaps.
export function packByHeight(layout, heightOf, cols) {
  const perRow = Math.max(1, Math.floor(cols / TILE_W))
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
  const colBottoms = new Array(perRow).fill(0)
  return ordered.map((it) => {
    let best = 0
    for (let c = 1; c < perRow; c++) if (colBottoms[c] < colBottoms[best]) best = c
    const h = Math.max(1, Math.round(Number(heightOf(it.i)) || it.h))
    const next = tileItem(it.i, best * TILE_W, colBottoms[best], TILE_W, h)
    colBottoms[best] += h
    return next
  })
}

export function useTileLayout(pageKey, tileIds, _legacyDefault, storage = {}) {
  const baseKey = storage.layout || `budget.layout.${pageKey}`
  const collapsedKey = storage.collapsed || `budget.collapsed.${pageKey}`
  const bp = useBreakpoint()

  const [layouts, setLayouts] = useState(() => {
    const out = {}
    for (const b of BREAKPOINTS) out[b.key] = loadJson(`${baseKey}.${b.key}`, null)
    return out
  })
  const [collapsed, setCollapsed] = useState(() => loadJson(collapsedKey, {}))

  // Which breakpoints had no saved layout at all when this page first loaded
  // — i.e. still showing the placeholder-spaced default stack. Captured once
  // at mount (not reactive) so it can gate a ONE-TIME auto-pack once real
  // tile heights are known, without ever re-triggering later and undoing a
  // layout the user has since dragged tiles around in.
  const wasDefaultRef = useRef(null)
  if (wasDefaultRef.current === null) {
    const wd = {}
    for (const b of BREAKPOINTS) wd[b.key] = layouts[b.key] == null
    wasDefaultRef.current = wd
  }

  useEffect(() => {
    saveJson(collapsedKey, collapsed)
  }, [collapsedKey, collapsed])

  const effective = useMemo(() => {
    const out = {}
    for (const b of BREAKPOINTS) {
      const saved = layouts[b.key]
      out[b.key] = saved ? reconcile(saved, tileIds, b.cols) : defaultLayout(tileIds, b.cols)
    }
    return out
  }, [layouts, tileIds])

  const layout = effective[bp.key]
  const cols = bp.cols

  // `next` can be an array (set directly) or an updater `(current) => array`.
  // The updater form is what lets setItemHeight/autoArrange stay referentially
  // stable across renders (they never need `layout` itself as a dependency),
  // which matters: an unstable identity here would make every GridTile's
  // measuring effect re-fire on every render, cascading into a render loop.
  const applyLayout = useCallback(
    (next) => {
      setLayouts((prev) => {
        const current = prev[bp.key] ? reconcile(prev[bp.key], tileIds, bp.cols) : defaultLayout(tileIds, bp.cols)
        const resolved = typeof next === 'function' ? next(current) : next
        if (resolved === current) return prev
        saveJson(`${baseKey}.${bp.key}`, resolved)
        return { ...prev, [bp.key]: resolved }
      })
    },
    [baseKey, bp.key, bp.cols, tileIds]
  )

  const toggleTile = useCallback((id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })), [])

  // Set a tile's real measured height (in row units already, caller converts
  // from px). Only writes when it actually changed, so measuring doesn't
  // cause a save/re-render loop.
  const setItemHeight = useCallback(
    (id, h) => {
      applyLayout((cur) => {
        const item = cur.find((it) => it.i === id)
        if (!item || item.h === h) return cur
        return cur.map((it) => (it.i === id ? { ...it, h } : it))
      })
    },
    [applyLayout]
  )

  const autoArrange = useCallback(
    (heightOf) => {
      applyLayout((cur) => packByHeight(cur, heightOf, bp.cols))
    },
    [applyLayout, bp.cols]
  )

  return {
    layout,
    cols,
    bpKey: bp.key,
    needsInitialPack: !!wasDefaultRef.current[bp.key],
    applyLayout,
    setItemHeight,
    collapsed,
    toggleTile,
    autoArrange,
  }
}
