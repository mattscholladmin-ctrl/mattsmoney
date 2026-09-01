// @ts-nocheck
import { useCallback, useEffect, useRef } from 'react'
import GridLayout, { verticalCompactor, useContainerWidth } from 'react-grid-layout'
import { TILE_W } from '../lib/tileLayout'
import 'react-grid-layout/css/styles.css'

// Wraps a dashboard tile so it can be collapsed and dragged into a new spot.
// In normal use the tile renders untouched (zero added chrome). Collapsed
// tiles show as a slim bar you tap to reopen. In "Customize" mode every tile
// gets a name strip with a collapse chevron and becomes draggable.
function Chevron({ collapsed }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function GripDots() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.7" />
      <circle cx="15" cy="6" r="1.7" />
      <circle cx="9" cy="12" r="1.7" />
      <circle cx="15" cy="12" r="1.7" />
      <circle cx="9" cy="18" r="1.7" />
      <circle cx="15" cy="18" r="1.7" />
    </svg>
  )
}

export default function TileFrame({ name, collapsed, arranging, onToggle, children }) {
  // Collapsed: a slim card showing just the name; tap to reopen.
  if (collapsed) {
    return (
      <div className="rounded-2xl bg-white px-5 py-3.5 shadow flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 font-semibold text-slate-800 min-w-0"
        >
          <span className="text-slate-400">
            <Chevron collapsed />
          </span>
          <span className="truncate">{name}</span>
        </button>
        {arranging && (
          <span className="text-slate-300">
            <GripDots />
          </span>
        )}
      </div>
    )
  }

  // Normal mode: render the tile exactly as-is, no added chrome.
  if (!arranging) return children

  // Customize mode: a labeled grab strip above the open tile. The strip
  // itself is the drag handle (see dragConfig.handle below) — tapping
  // elsewhere in the tile (a button, a link) still works normally.
  return (
    <div>
      <div className="tile-drag-handle flex items-center justify-between gap-2 mb-1 px-1 cursor-grab active:cursor-grabbing">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 min-w-0">
          <GripDots />
          <span className="truncate">{name}</span>
        </span>
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Collapse ${name}`}
          className="text-slate-400 hover:text-slate-600"
        >
          <Chevron />
        </button>
      </div>
      {children}
    </div>
  )
}

// One grid item. Reports its own real rendered height (collapsed or
// expanded, whichever is showing), converted to grid row units, so the tile
// is always sized to fit its actual content instead of a fixed guess — and
// so "Auto-arrange" can pack by real size.
//
// react-grid-layout's own row math is `px = h*rowHeight + (h-1)*marginY`
// (margin is added BETWEEN every row, not just between tiles) — so the
// inverse conversion has to account for marginY too, or every measured
// height gets overestimated in row units, rendered even taller next pass,
// measured even bigger again, and so on without ever settling.
function GridTile({ id, rowHeightPx, marginY, onHeight, children }) {
  const elRef = useRef(null)
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const report = () => {
      const px = el.getBoundingClientRect().height
      const h = Math.max(1, Math.round((px + marginY) / (rowHeightPx + marginY)))
      onHeight(id, h)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [id, rowHeightPx, marginY, onHeight])
  return <div ref={elRef}>{children}</div>
}

const ROW_HEIGHT = 4 // px per grid row — fine-grained so a tile's height never jumps awkwardly
const MARGIN = 16 // px gap between tiles, both axes

function columnCount(cols) {
  return Math.max(1, Math.floor(cols / TILE_W))
}

// Split a free-form {x,y} layout into N content-sized CSS columns. Uses x to
// pick the column and y to order within it, so a saved Customize arrangement
// still applies — without react-grid-layout's placeholder row heights, which
// stacked cards on top of each other whenever measured h exceeded the slot.
function splitIntoColumns(layout, perRow) {
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
  if (perRow <= 1) return [ordered]
  const columns = Array.from({ length: perRow }, () => [])
  for (const it of ordered) {
    const c = Math.min(perRow - 1, Math.max(0, Math.floor(it.x / TILE_W)))
    columns[c].push(it)
  }
  const used = columns.filter((c) => c.length).length
  if (used <= 1 && ordered.length > 1) {
    columns.forEach((c) => {
      c.length = 0
    })
    ordered.forEach((it, i) => columns[i % perRow].push(it))
  }
  return columns
}

// Renders a page's tiles. Default view is content-sized CSS columns (no overlap,
// height follows the card). Customize mode is a free grid — drag a tile anywhere
// there's an open spot. Columns adapt to screen width. Tiles whose node is
// null (nothing to show) are skipped entirely.
export function TileColumns({ names, tiles, tilesState, arranging }) {
  const { width, containerRef, mounted } = useContainerWidth()
  const { layout, cols, applyLayout, setItemHeight, collapsed, toggleTile, autoArrange } = tilesState

  const heightsRef = useRef({})
  const setHeight = useCallback(
    (id, rows) => {
      heightsRef.current[id] = rows
      setItemHeight(id, rows)
    },
    [setItemHeight]
  )
  const handleAutoArrange = () => autoArrange((id) => heightsRef.current[id])

  // Entering Customize: pack by last measured heights so RGL doesn't open on
  // the placeholder-spaced stack (which overlaps). Heights are collected in
  // the CSS-column view below, so they're usually ready immediately.
  const wasArranging = useRef(false)
  useEffect(() => {
    if (arranging && !wasArranging.current) {
      autoArrange((id) => heightsRef.current[id])
    }
    wasArranging.current = arranging
  }, [arranging, autoArrange])

  const visible = layout.filter((it) => tiles[it.i] != null)
  const perRow = columnCount(cols)

  const renderFrame = (it) => (
    <TileFrame
      name={names[it.i]}
      collapsed={!!collapsed[it.i]}
      arranging={arranging}
      onToggle={() => toggleTile(it.i)}
    >
      {tiles[it.i]}
    </TileFrame>
  )

  if (!arranging) {
    const columns = splitIntoColumns(visible, perRow)
    return (
      <div className={perRow === 1 ? 'flex flex-col gap-4' : 'flex gap-4 items-start'}>
        {columns.map((col, i) => (
          <div key={i} className={perRow === 1 ? 'flex flex-col gap-4' : 'flex-1 min-w-0 flex flex-col gap-4'}>
            {col.map((it) => (
              <GridTile key={it.i} id={it.i} rowHeightPx={ROW_HEIGHT} marginY={MARGIN} onHeight={setHeight}>
                <div data-tile={it.i}>{renderFrame(it)}</div>
              </GridTile>
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={containerRef}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <p className="text-xs text-slate-400">
          Drag a tile by its name strip and drop it anywhere there's room —
          any open spot, not just a fixed column. ⌄ collapses a tile.
          Everything saves automatically.
        </p>
        <button
          type="button"
          onClick={handleAutoArrange}
          className="shrink-0 text-xs font-medium text-emerald-700 rounded-full border border-emerald-200 px-3 py-1 hover:bg-emerald-50"
        >
          Auto-arrange (close gaps)
        </button>
      </div>
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={visible}
          gridConfig={{ cols, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN] }}
          dragConfig={{ enabled: true, handle: '.tile-drag-handle' }}
          resizeConfig={{ enabled: false }}
          compactor={verticalCompactor}
          onLayoutChange={applyLayout}
          autoSize
        >
          {visible.map((it) => (
            <div key={it.i} data-tile={it.i}>
              <GridTile id={it.i} rowHeightPx={ROW_HEIGHT} marginY={MARGIN} onHeight={setHeight}>
                {renderFrame(it)}
              </GridTile>
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  )
}
