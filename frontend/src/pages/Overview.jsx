import React from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Bar as MiniBar, Card, Donut, ErrorBox, Icon, Loading, Sparkline, Stat, Tag,
  TipBox, axis, chartGrid, compact, hourLabel, num, pct,
} from '../ui.jsx'
import StopDrawer from '../components/StopDrawer.jsx'

export default function Overview({ go }) {
  const { data, loading, error } = useAsync(() => api.overview(), [])
  const [range, setRange] = React.useState(28)
  const [stopId, setStopId] = React.useState(null)

  if (loading) return <Loading height={420} label="Loading city telemetry" />
  if (error) return <ErrorBox error={error} />

  const k = data.kpis
  const daily = data.daily.slice(-range)
  const hourly = data.hourly.map((v, h) => ({ h: hourLabel(h), demand: v }))
  const clusterSegments = data.clusters.map((c) => ({ value: c.stops, color: c.color, name: c.name }))
  const topRoutes = [...data.routes].sort((a, b) => b.riders_day - a.riders_day).slice(0, 6)
  const maxRoute = Math.max(...topRoutes.map((r) => r.riders_day), 1)

  return (
    <>
      <div className="grid g4">
        <Stat label="Daily riders" value={compact(k.daily_riders)} unit={`/ ${compact(k.daily_boardings)} boardings`}
          icon="users" accent="#4f8cff" onClick={() => go('fleet')}
          foot={<span><span style={{ color: '#34d399' }}>▲</span> weekday mean over {data.window.days} days</span>}
          spark={<Sparkline data={daily.map((d) => d.riders)} color="#4f8cff" />} />
        <Stat label="Camera footfall" value={compact(k.daily_pedestrians)} unit="peds / day"
          icon="target" accent="#2dd4bf" onClick={() => go('clusters')}
          foot={`${num(k.daily_visits)} bus calls per day`}
          spark={<Sparkline data={daily.map((d) => d.peds)} color="#2dd4bf" />} />
        <Stat label="Stops clustered" value={k.stops} unit={`→ ${k.clusters} archetypes`}
          icon="layers" accent="#a78bfa" onClick={() => go('clusters')}
          foot={`${k.features} behaviour features`} />
        <Stat label="Live fleet" value={k.vehicles} unit="buses"
          icon="bus" accent="#f59e0b" onClick={() => go('map')}
          foot={`${k.routes} routes · ${k.avg_speed} km/h avg`} />
      </div>

      <div className="grid g4" style={{ marginTop: 14 }}>
        <Stat label="On-time operations" value={`${k.on_time_pct}`} unit="%"
          icon="clock" accent="#34d399"
          foot={`|delay| ≤ 2 min at stops`} />
        <Stat label="Mean dwell" value={num(k.avg_dwell_s, 1)} unit="s"
          icon="clock" accent="#38bdf8"
          foot={`occupancy ${num(k.avg_occupancy, 1)} riders`} />
        <Stat label="Model silhouette" value={num(k.silhouette, 3)}
          icon="cpu" accent="#f472b6" onClick={() => go('model')}
          foot={`purity ${pct(k.purity)} · unsupervised`} />
        <Stat label="Detected anomalies" value={k.anomaly_stops} unit="stops"
          icon="alert" accent="#f43f5e" onClick={() => go('anomalies')}
          foot={`of ${k.stops} stops · DBSCAN`} />
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Demand & footfall trend" sub={`${data.window.start} → ${data.window.end} · riders vs camera pedestrians`}
          actions={
            <div className="seg">
              {[7, 14, 28].map((r) => (
                <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}d</button>
              ))}
            </div>
          }>
          <div style={{ height: 268 }}>
            <ResponsiveContainer>
              <AreaChart data={daily} margin={{ top: 10, right: 6, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="ov-riders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#4f8cff" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="ov-peds" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGrid} vertical={false} />
                <XAxis dataKey="date" {...axis} tickFormatter={(d) => d.slice(5)} interval={Math.ceil(range / 7)} />
                <YAxis {...axis} width={46} tickFormatter={compact} />
                <Tooltip content={<TipBox formatter={(v) => compact(v)} />} />
                <Area type="monotone" dataKey="riders" name="Riders" stroke="#4f8cff" strokeWidth={2.2} fill="url(#ov-riders)" />
                <Area type="monotone" dataKey="peds" name="Pedestrians" stroke="#2dd4bf" strokeWidth={1.8} fill="url(#ov-peds)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Discovered archetypes" sub={`k=${k.clusters} from the unsupervised clusterer`}
          actions={<span className="tag info">{k.stops} stops</span>}>
          <div className="row" style={{ gap: 18, alignItems: 'center' }}>
            <Donut segments={clusterSegments} center={k.clusters} sub="clusters" size={142} thickness={14} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1, minWidth: 0 }}>
              {data.clusters.slice(0, 6).map((c) => (
                <div key={c.id} className="legend-item" onClick={() => go('clusters')} style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 7, minWidth: 0 }}>
                    <span className="swatch" style={{ background: c.color }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  </span>
                  <span className="mono" style={{ color: '#93a4c1', fontSize: 11 }}>{c.stops}</span>
                </div>
              ))}
              {data.clusters.length > 6 && (
                <button className="btn ghost" style={{ marginTop: 4, justifyContent: 'space-between' }} onClick={() => go('clusters')}>
                  All {data.clusters.length} archetypes <Icon name="chevron" size={13} />
                </button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="split" style={{ marginTop: 14 }}>
        <Card title="City demand by hour" sub="Weekday mean demand (riders + 0.35 × pedestrians)">
          <div style={{ height: 214 }}>
            <ResponsiveContainer>
              <BarChart data={hourly} margin={{ top: 8, right: 6, left: -14, bottom: 0 }}>
                <CartesianGrid {...chartGrid} vertical={false} />
                <XAxis dataKey="h" {...axis} interval={2} />
                <YAxis {...axis} width={46} tickFormatter={compact} />
                <Tooltip content={<TipBox formatter={(v) => compact(v)} />} />
                <Bar dataKey="demand" name="Demand" radius={[4, 4, 0, 0]}>
                  {hourly.map((d, i) => (
                    <Cell key={i} fill={i >= 8 && i <= 10 || i >= 17 && i <= 19 ? '#4f8cff' : '#31456b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Busiest corridors" sub="By average weekday riders" actions={<button className="btn ghost" onClick={() => go('routes')}>All routes</button>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {topRoutes.map((r) => (
              <div key={r.route_id} onClick={() => go('routes')} style={{ cursor: 'pointer' }}>
                <div className="row between" style={{ marginBottom: 5 }}>
                  <span className="row" style={{ gap: 7, fontSize: 12 }}>
                    <span className="swatch" style={{ background: r.color, width: 8, height: 8, borderRadius: 3 }} />
                    {r.route_name}
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: '#93a4c1' }}>
                    {compact(r.riders_day)} · {r.on_time_pct}% on time
                  </span>
                </div>
                <MiniBar value={r.riders_day} max={maxRoute} color={r.color} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Top stops by total footfall" sub="Click any stop to open its full telemetry"
        style={{ marginTop: 14 }} pad={false}
        actions={<Tag tone="good">{data.top_stops.length} stops</Tag>}>
        <div className="table-wrap" style={{ maxHeight: 330 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Stop</th><th>Zone</th><th>Archetype</th>
                <th className="r">Riders/day</th><th className="r">Pedestrians/day</th>
                <th className="r">Dwell</th><th className="r">Routes</th><th className="r">Anomaly</th>
              </tr>
            </thead>
            <tbody>
              {data.top_stops.map((s) => (
                <tr key={s.stop_id} className="clickable" onClick={() => setStopId(s.stop_id)}>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: s.cluster_color }} />
                      <span style={{ fontWeight: 600 }}>{s.stop_name}</span>
                      <span className="dim mono" style={{ fontSize: 10 }}>{s.stop_id}</span>
                    </div>
                  </td>
                  <td className="muted">{s.zone}</td>
                  <td><Tag color={s.cluster_color}>{s.cluster_name}</Tag></td>
                  <td className="r">{num(s.riders)}</td>
                  <td className="r">{num(s.peds)}</td>
                  <td className="r">{num(s.dwell, 1)}s</td>
                  <td className="r">{s.routes}</td>
                  <td className="r">{num(s.anomaly, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <Card title="Model scorecard" sub="Trained on the full panel, no labels used">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[
              ['Silhouette', num(k.silhouette, 3)],
              ['Cluster purity', pct(k.purity)],
              ['Clusters (k)', k.clusters],
              ['Data points', num(k.data_points)],
              ['Behaviour features', k.features],
            ].map(([a, b]) => (
              <div key={a} className="row between" style={{ fontSize: 12 }}>
                <span className="muted">{a}</span>
                <span className="mono" style={{ fontWeight: 650 }}>{b}</span>
              </div>
            ))}
            <button className="btn" onClick={() => go('model')}>Open diagnostics <Icon name="chevron" size={13} /></button>
          </div>
        </Card>
        <Card title="Recurring rhythms" sub="Second clustering layer on 24-dim curves">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.rhythms.map((r) => (
              <div key={r.id}>
                <div className="row between" style={{ fontSize: 11.5, marginBottom: 4 }}>
                  <span>{r.name}</span>
                  <span className="dim mono">{r.stops} stops · peak {hourLabel(r.peak_hour)}</span>
                </div>
                <MiniBar value={r.stops} max={Math.max(...data.rhythms.map((x) => x.stops))} color="#a78bfa" />
              </div>
            ))}
          </div>
        </Card>
        <Card title="Network coverage" sub="Stops and demand per zone">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflow: 'auto' }}>
            {[...data.zones].sort((a, b) => b.stops - a.stops).slice(0, 8).map((z) => (
              <div key={z.zone} className="row between" style={{ fontSize: 11.5 }}>
                <span style={{ color: '#c7d3e6' }}>{z.zone}</span>
                <span className="row" style={{ gap: 10 }}>
                  <span className="dim mono">{z.stops} stops</span>
                  <span className="mono" style={{ color: '#93a4c1' }}>{compact(z.riders)}/day</span>
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <StopDrawer stopId={stopId} onClose={() => setStopId(null)} />
    </>
  )
}
