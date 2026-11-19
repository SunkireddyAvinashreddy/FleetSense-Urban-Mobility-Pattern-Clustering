import React from 'react'

/* ------------------------------------------------------------ formatting */
export const compact = (n, d = 1) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(d)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(d)}k`
  return `${Math.round(v * 10) / 10}`
}
export const num = (n, d = 0) =>
  Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: d })
export const pct = (n, d = 1) => `${(Number(n || 0) * 100).toFixed(d)}%`
export const hourLabel = (h) => `${String(Math.round(h)).padStart(2, '0')}:00`
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const minuteLabel = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export const chartGrid = { stroke: 'rgba(148,163,184,.10)', strokeDasharray: '3 4' }
export const axis = {
  tick: { fill: '#64748b', fontSize: 10.5 },
  axisLine: false,
  tickLine: false,
}

export function TipBox({ active, payload, label, formatter, labelPrefix = '' }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div style={{
      background: 'rgba(8,14,25,.97)', border: '1px solid rgba(148,163,184,.24)',
      borderRadius: 10, padding: '9px 11px', fontSize: 11.5, boxShadow: '0 18px 36px -18px #000',
    }}>
      <div style={{ color: '#8ea0bd', marginBottom: 5, fontWeight: 650 }}>
        {labelPrefix}{label}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, background: p.color || p.fill || '#4f8cff' }} />
          <span style={{ color: '#93a4c1' }}>{p.name}</span>
          <span style={{ marginLeft: 'auto', color: '#e9effb', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
            {formatter ? formatter(p.value, p) : num(p.value, 1)}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ icons */
const paths = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  map: 'M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 7 9 4.5zM9 4.5V17M15 7v12.5',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h6a4 4 0 0 0 0-8h-4a4 4 0 0 1 0-8h6',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  bus: 'M5 4h14a2 2 0 0 1 2 2v9H3V6a2 2 0 0 1 2-2zM3 15h18v3H3zM7 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM3 9h18',
  alert: 'M12 3 2 20h20L12 3zM12 9v5M12 17.2v.1',
  cpu: 'M6 6h12v12H6zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M10 10h4v4h-4z',
  spark: 'M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  users: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  close: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  play: 'M7 4l12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
}

export function Icon({ name, size = 17, stroke = 1.8, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
      strokeLinejoin="round" {...rest}>
      <path d={paths[name] || paths.grid} />
    </svg>
  )
}

/* ------------------------------------------------------------------ shell */
export function Card({ title, sub, actions, children, className = '', pad = true, ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="card-hd">
          <div className="grow">
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </header>
      )}
      <div className="card-bd" style={pad ? undefined : { padding: 0 }}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, unit, foot, icon, accent, onClick, spark }) {
  return (
    <div className={`stat ${onClick ? 'clickable' : ''}`} onClick={onClick}
      style={onClick ? undefined : { cursor: 'default' }}>
      {icon && <span className="kpi-icon" style={accent ? { background: `${accent}1f`, color: accent, borderColor: `${accent}44` } : undefined}>
        <Icon name={icon} size={14} />
      </span>}
      <div className="label">{label}</div>
      <div className="value num">{value}{unit && <small>{unit}</small>}</div>
      {spark && <div className="spark">{spark}</div>}
      {foot && <div className="foot">{foot}</div>}
    </div>
  )
}

export function Tag({ children, tone, color }) {
  return <span className={`tag ${tone || ''}`}
    style={color ? { color, borderColor: `${color}55`, background: `${color}18` } : undefined}>{children}</span>
}

export function Sparkline({ data = [], color = '#4f8cff', height = 30, fill = true }) {
  const vals = data.length ? data : [0, 0]
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const span = max - min || 1
  const w = 100
  const pts = vals.map((v, i) => [
    (i / Math.max(vals.length - 1, 1)) * w,
    height - ((v - min) / span) * (height - 4) - 2,
  ])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ')
  const id = `sp-${color.replace('#', '')}`
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".42" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

export function Donut({ segments = [], size = 148, thickness = 13, center, sub }) {
  const total = segments.reduce((a, s) => a + (s.value || 0), 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: '0 0 auto' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="rgba(148,163,184,.1)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${Math.max(len - 2, 0)} ${c}`}
              strokeDashoffset={-offset} strokeLinecap="round"
              opacity={s.dim ? 0.22 : 1}
              style={{ transition: 'stroke-dasharray .6s ease' }} />
          )
          offset += len
          return el
        })}
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'grid', placeContent: 'center',
        textAlign: 'center', gap: 1,
      }}>
        <div className="num" style={{ fontSize: 24, fontWeight: 750, letterSpacing: '-1px' }}>{center}</div>
        {sub && <div style={{ fontSize: 10, color: '#63748f', textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 700 }}>{sub}</div>}
      </div>
    </div>
  )
}

export function Bar({ value, max, color = '#4f8cff', height = 6 }) {
  const w = Math.max(0, Math.min(100, (value / (max || 1)) * 100))
  return (
    <div className="bar-track" style={{ height }}>
      <div className="bar-fill" style={{ width: `${w}%`, background: `linear-gradient(90deg, ${color}, ${color}bb)` }} />
    </div>
  )
}

export function Gauge({ value, max = 100, color = '#4f8cff', size = 84, label, sub }) {
  const r = (size - 10) / 2
  const c = Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  return (
    <div style={{ width: size, textAlign: 'center' }}>
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`}>
        <path d={`M5,${size / 2} A${r},${r} 0 0 1 ${size - 5},${size / 2}`} fill="none"
          stroke="rgba(148,163,184,.14)" strokeWidth="7" strokeLinecap="round" />
        <path d={`M5,${size / 2} A${r},${r} 0 0 1 ${size - 5},${size / 2}`} fill="none"
          stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} style={{ transition: 'stroke-dasharray .5s' }} />
      </svg>
      <div style={{ marginTop: -10, fontSize: 16, fontWeight: 750 }} className="num">{label}</div>
      <div style={{ fontSize: 9.5, color: '#63748f', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{sub}</div>
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value ?? o} className={(o.value ?? o) === value ? 'on' : ''}
          onClick={() => onChange(o.value ?? o)}>{o.label ?? o}</button>
      ))}
    </div>
  )
}

export function Toggle({ on, onChange, children }) {
  return (
    <span className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="track" />
      {children}
    </span>
  )
}

export function Loading({ label = 'Loading', height = 120 }) {
  return (
    <div style={{ padding: 8 }}>
      <div className="skeleton" style={{ height }} />
      <div style={{ fontSize: 11, color: '#63748f', marginTop: 8 }}>{label}…</div>
    </div>
  )
}

export function ErrorBox({ error }) {
  return <div className="err"><Icon name="alert" size={15} /> <span>{String(error?.message || error)}</span></div>
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>
}

export function Drawer({ open, onClose, title, sub, children, width }) {
  React.useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" style={width ? { width } : undefined}>
        <header className="drawer-hd">
          <div className="grow">
            <h3>{title}</h3>
            {sub && <div className="sub dim" style={{ fontSize: 11.5, marginTop: 3 }}>{sub}</div>}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
        </header>
        <div className="drawer-bd">{children}</div>
      </aside>
    </>
  )
}

export function Counter({ value, format = num, duration = 700 }) {
  const [v, setV] = React.useState(0)
  const from = React.useRef(0)
  React.useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration)
      const eased = 1 - (1 - p) ** 3
      setV(a + (value - a) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{format(v)}</>
}

export function Heat({ value, max, color = '#4f8cff' }) {
  const t = Math.max(0, Math.min(1, value / (max || 1)))
  return (
    <div title={`${Math.round(value)}`} style={{
      height: 22, borderRadius: 5,
      background: `color-mix(in srgb, ${color} ${Math.round(12 + t * 78)}%, rgba(9,15,27,.85))`,
      border: '1px solid rgba(148,163,184,.08)',
      transition: 'background .3s',
    }} />
  )
}
