// @ts-nocheck
// Lightweight, dependency-free SVG charts that match the app's theme.
// DonutChart  — category breakdown ring (slices optionally tappable).
// LineChart   — area + line for a time series (spending trend, net worth).

export const CHART_COLORS = [
  '#22d3ee', // cyan
  '#2dd4bf', // teal
  '#38bdf8', // sky
  '#818cf8', // indigo
  '#a78bfa', // violet
  '#f472b6', // pink
  '#fbbf24', // amber
  '#34d399', // emerald
  '#fb7185', // rose
  '#60a5fa', // blue
]

function polar(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arcPath(cx, cy, rOuter, rInner, start, end) {
  const [ox1, oy1] = polar(cx, cy, rOuter, start)
  const [ox2, oy2] = polar(cx, cy, rOuter, end)
  const [ix2, iy2] = polar(cx, cy, rInner, end)
  const [ix1, iy1] = polar(cx, cy, rInner, start)
  const large = end - start > 180 ? 1 : 0
  return [
    `M ${ox1} ${oy1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${ix1} ${iy1}`,
    'Z',
  ].join(' ')
}

// data: [{ label, value, color }]. centerLabel/centerSub optional strings.
export function DonutChart({ data = [], centerLabel, centerSub, onSlice, activeLabel }) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0)
  const size = 200
  const cx = size / 2
  const cy = size / 2
  const rOuter = 92
  const rInner = 58

  let angle = 0
  const slices = []
  if (total > 0) {
    for (const d of data) {
      const frac = Math.max(0, d.value) / total
      const sweep = frac * 360
      // Clamp so a near-full slice still renders as an arc.
      const end = angle + Math.min(sweep, 359.99)
      slices.push({ ...d, start: angle, end })
      angle += sweep
    }
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-44 h-44 mx-auto block">
      {total <= 0 ? (
        <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="#1e293b" strokeWidth={rOuter - rInner} />
      ) : data.length === 1 ? (
        <circle
          cx={cx}
          cy={cy}
          r={(rOuter + rInner) / 2}
          fill="none"
          stroke={data[0].color}
          strokeWidth={rOuter - rInner}
        />
      ) : (
        slices.map((s) => {
          const dim = activeLabel && activeLabel !== s.label
          return (
            <path
              key={s.label}
              d={arcPath(cx, cy, rOuter, rInner, s.start, s.end)}
              fill={s.color}
              opacity={dim ? 0.35 : 1}
              onClick={onSlice ? () => onSlice(s.label) : undefined}
              style={onSlice ? { cursor: 'pointer' } : undefined}
            />
          )
        })
      )}
      {centerLabel && (
        <text x={cx} y={cy - 2} textAnchor="middle" className="fill-slate-100" style={{ fontSize: 22, fontWeight: 700 }}>
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x={cx} y={cy + 18} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 11 }}>
          {centerSub}
        </text>
      )}
    </svg>
  )
}

// Short money label for chart axes/labels: $1.2k, $950, -$1.4k.
export function abbrevMoney(n) {
  const neg = n < 0
  const v = Math.abs(n)
  const s = v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`
  return neg ? `-${s}` : s
}

// points: [{ label, value }]. format(value) -> string for the latest-value tag.
export function LineChart({ points = [], color = '#22d3ee', format = (v) => v }) {
  if (points.length < 2) {
    return <p className="text-sm text-slate-400">Not enough history yet to chart.</p>
  }
  const W = 320
  const H = 160
  const padL = 32
  const padR = 8
  const padT = 16
  const padB = 24

  const values = points.map((p) => Number(p.value || 0))
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const x = (i) => padL + (i * innerW) / (points.length - 1)
  const y = (v) => padT + (1 - (v - min) / span) * innerH

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const areaPath = `${linePath} L ${x(points.length - 1)} ${y(min)} L ${x(0)} ${y(min)} Z`

  const gid = `grad-${color.replace('#', '')}`
  const last = points[points.length - 1]
  const gridVals = [...new Set([max, (max + min) / 2, min])]
  const step = Math.max(1, Math.round(points.length / 4))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridVals.map((gv, i) => (
        <g key={i}>
          <line x1={padL} y1={y(gv)} x2={W - padR} y2={y(gv)} stroke={gv === 0 ? '#475569' : '#1e293b'} strokeDasharray={gv === 0 ? '3 3' : ''} strokeWidth="1" />
          <text x={padL - 4} y={y(gv) + 3} textAnchor="end" className="fill-slate-500" style={{ fontSize: 9 }}>
            {abbrevMoney(gv)}
          </text>
        </g>
      ))}
      <path d={areaPath} fill={`url(#${gid})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 3.5 : 2} fill={color} />
      ))}
      {points.map((p, i) =>
        i % step === 0 || i === points.length - 1 ? (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-slate-500" style={{ fontSize: 9 }}>
            {p.label}
          </text>
        ) : null
      )}
      <text x={W - padR} y={padT - 3} textAnchor="end" className="fill-slate-200" style={{ fontSize: 11, fontWeight: 600 }}>
        {format(last.value)}
      </text>
    </svg>
  )
}

// bars: [{ label, value, highlight }]. Vertical bars with value + axis labels.
export function BarChart({ bars = [], color = '#22d3ee', format = abbrevMoney }) {
  if (!bars.length) return <p className="text-sm text-slate-400">Not enough data yet.</p>
  const W = 340
  const H = 180
  const padL = 30
  const padR = 8
  const padT = 20
  const padB = 26
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const max = Math.max(...bars.map((b) => Number(b.value || 0)), 1)
  const slot = innerW / bars.length
  const bw = Math.min(34, slot * 0.62)
  const x = (i) => padL + slot * i + (slot - bw) / 2
  const y = (v) => padT + (1 - v / max) * innerH

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      {[max, max / 2].map((gv, i) => (
        <g key={i}>
          <line x1={padL} y1={y(gv)} x2={W - padR} y2={y(gv)} stroke="#1e293b" strokeWidth="1" />
          <text x={padL - 4} y={y(gv) + 3} textAnchor="end" className="fill-slate-500" style={{ fontSize: 9 }}>
            {abbrevMoney(gv)}
          </text>
        </g>
      ))}
      {bars.map((b, i) => {
        const v = Number(b.value || 0)
        const h = Math.max(2, (v / max) * innerH)
        const top = padT + innerH - h
        return (
          <g key={i}>
            <rect x={x(i)} y={top} width={bw} height={h} rx="3" fill={color} opacity={b.highlight ? 1 : 0.45} />
            {v > 0 && (
              <text x={x(i) + bw / 2} y={top - 4} textAnchor="middle" className="fill-slate-300" style={{ fontSize: 8.5 }}>
                {format(v)}
              </text>
            )}
            <text x={x(i) + bw / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9 }}>
              {b.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
