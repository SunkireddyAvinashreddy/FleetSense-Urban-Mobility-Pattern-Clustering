import React from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip as LTooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Bar as MiniBar, Card, ErrorBox, Icon, Loading, Sparkline, Tag, TipBox, axis,
  chartGrid, compact, hourLabel, num,
} from '../ui.jsx'
import StopDrawer from '../components/StopDrawer.jsx'
import { displayBusId, displayBusName } from '../fleetLabels.js'

export default function RoutesPage({ go }) {
  const { data, loading, error } = useAsync(() => api.routes(), [])
  const [sel, setSel] = React.useState(null)
  const [stopId, setStopId] = React.useState(null)
  const liveRouteId = data?.routes?.find((r) => r.route_id === sel)?.route_id || data?.routes?.[0]?.route_id
  const liveRouteQ = useAsync(
    () => liveRouteId ? api.route(liveRouteId) : Promise.resolve(null),
    [liveRouteId],
  )

  if (loading) return <Loading height={420} label="Loading route network" />
  if (error) return <ErrorBox error={error} />

  const routes = data.routes
  const active = routes.find((r) => r.route_id === sel) || routes[0]
  const liveVehicles = liveRouteQ.data?.live || []
  const hourly = active.hourly.map((v, h) => ({ h: hourLabel(h), demand: v }))
  const center = active.stops.length
    ? [active.stops.reduce((a, s) => a + s.lat, 0) / active.stops.length,
       active.stops.reduce((a, s) => a + s.lon, 0) / active.stops.length]
    : [12.97, 77.62]
  const totalRiders = routes.reduce((a, r) => a + r.riders_day, 0)

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="label">Corridors</div><div className="value num">{routes.length}</div><div className="foot">{num(routes.reduce((a, r) => a + r.n_stops, 0))} stop calls</div></div>
        <div className="stat"><div className="label">Riders / day</div><div className="value num">{compact(totalRiders)}</div><div className="foot">across the whole network</div></div>
        <div className="stat"><div className="label">Average on-time</div><div className="value num">{num(routes.reduce((a, r) => a + r.on_time_pct, 0) / routes.length, 1)}<small>%</small></div><div className="foot">|deviation| ≤ 2 min</div></div>
        <div className="stat"><div className="label">Fleet assigned</div><div className="value num">{num(routes.reduce((a, r) => a + r.buses, 0))}</div><div className="foot">buses across 24 corridors</div></div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="All corridors" sub="Sorted by daily ridership · click to inspect" pad={false}>
          <div style={{ maxHeight: 640, overflow: 'auto' }}>
            {[...routes].sort((a, b) => b.riders_day - a.riders_day).map((r) => (
              <button key={r.route_id} onClick={() => setSel(r.route_id)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '11px 16px',
                  border: 0, borderBottom: '1px solid rgba(148,163,184,.07)', cursor: 'pointer',
                  background: active.route_id === r.route_id ? 'rgba(79,140,255,.1)' : 'transparent',
                  borderLeft: `3px solid ${active.route_id === r.route_id ? r.color : 'transparent'}`,
                }}>
                <div className="row between">
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span className="swatch" style={{ background: r.color, width: 8, height: 8, borderRadius: 3 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 650, color: '#e9effb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.route_name}</span>
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: '#93a4c1' }}>{r.route_id}</span>
                </div>
                <div className="row between" style={{ marginTop: 4, fontSize: 10.5, color: '#63748f' }}>
                  <span>{r.n_stops} stops · {r.length_km} km · headway {r.headway_min}m</span>
                  <span className="mono">{compact(r.riders_day)}/day · {r.on_time_pct}%</span>
                </div>
                <div style={{ marginTop: 6, height: 24 }}>
                  <Sparkline data={r.hourly} color={r.color} height={24} fill={false} />
                </div>
              </button>
            ))}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title={active.route_name} sub={`${active.origin} → ${active.destination} · ${active.route_id}`}
            actions={<Tag color={active.color}>{active.headway_min} min headway</Tag>}>
            <div style={{ height: 280, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(148,163,184,.12)' }}>
              <MapContainer center={center} zoom={11.4} zoomControl={false} style={{ height: '100%' }} preferCanvas>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                <Polyline positions={active.geometry}
                  pathOptions={{ color: active.color, weight: 4.5, opacity: .95, lineCap: 'round' }} />
                {active.stops.map((s) => (
                  <CircleMarker key={s.stop_id} center={[s.lat, s.lon]} radius={4.4}
                    pathOptions={{ color: active.color, fillColor: '#08101d', fillOpacity: 1, weight: 2 }}
                    eventHandlers={{ click: () => setStopId(s.stop_id) }}>
                    <LTooltip direction="top" offset={[0, -6]} opacity={1}>
                      <span style={{ fontSize: 11 }}>{s.seq}. {s.stop_name}</span>
                    </LTooltip>
                  </CircleMarker>
                ))}
              </MapContainer>
            </div>
            <div className="grid g4" style={{ gap: 8, marginTop: 12 }}>
              {[
                ['Buses', active.buses],
                ['Riders/day', compact(active.riders_day)],
                ['Avg speed', `${active.avg_speed}`],
                ['On time', `${active.on_time_pct}%`],
              ].map(([k, v]) => (
                <div key={k} className="stat" style={{ padding: '8px 10px', gap: 2 }}>
                  <div className="label" style={{ fontSize: 9 }}>{k}</div>
                  <div className="value num" style={{ fontSize: 16 }}>{v}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Demand across the day" sub="Weekday mean per stop on this corridor">
            <div style={{ height: 168 }}>
              <ResponsiveContainer>
                <BarChart data={hourly} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                  <CartesianGrid {...chartGrid} vertical={false} />
                  <XAxis dataKey="h" {...axis} interval={2} />
                  <YAxis {...axis} width={40} />
                  <Tooltip content={<TipBox />} />
                  <Bar dataKey="demand" name="Demand" fill={active.color} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>

      <Card title="Route performance matrix" sub="Punctuality, speed, dwell and network load" style={{ marginTop: 14 }} pad={false}>
        <div className="table-wrap" style={{ maxHeight: 380 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Route</th><th>Corridor</th><th className="r">Stops</th><th className="r">km</th>
                <th className="r">Buses</th><th className="r">Riders/day</th><th className="r">Speed</th>
                <th className="r">Dwell</th><th style={{ width: 130 }}>On time</th><th className="r">Peak</th>
              </tr>
            </thead>
            <tbody>
              {[...routes].sort((a, b) => b.riders_day - a.riders_day).map((r) => (
                <tr key={r.route_id} className="clickable" onClick={() => setSel(r.route_id)}>
                  <td><span className="mono" style={{ color: r.color, fontWeight: 700 }}>{r.route_id}</span></td>
                  <td style={{ fontWeight: 600 }}>{r.route_name}</td>
                  <td className="r">{r.n_stops}</td>
                  <td className="r">{r.length_km}</td>
                  <td className="r">{r.buses}</td>
                  <td className="r">{num(r.riders_day)}</td>
                  <td className="r">{r.avg_speed}</td>
                  <td className="r">{r.avg_dwell}s</td>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <div className="grow"><MiniBar value={r.on_time_pct} max={100}
                        color={r.on_time_pct > 80 ? '#34d399' : r.on_time_pct > 60 ? '#f59e0b' : '#f43f5e'} /></div>
                      <span className="mono" style={{ fontSize: 10.5, width: 34 }}>{r.on_time_pct}%</span>
                    </div>
                  </td>
                  <td className="r">{hourLabel(r.peak_hour)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <Card title="Stop sequence" sub={`${active.stops.length} calls on ${active.route_id}`} pad={false}>
          <div style={{ maxHeight: 260, overflow: 'auto', padding: '6px 0' }}>
            {active.stops.map((s) => (
              <button key={s.stop_id} onClick={() => setStopId(s.stop_id)}
                className="row" style={{ width: '100%', padding: '6px 16px', background: 'none', border: 0, cursor: 'pointer', textAlign: 'left' }}>
                <span className="mono" style={{ width: 20, fontSize: 10, color: '#63748f' }}>{String(s.seq).padStart(2, '0')}</span>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: s.cluster_color, marginRight: 8 }} />
                <span style={{ fontSize: 12, color: '#dbe6f6' }}>{s.stop_name}</span>
                <Icon name="chevron" size={12} style={{ marginLeft: 'auto', opacity: .4 }} />
              </button>
            ))}
          </div>
        </Card>

        <Card title="Live vehicles on this corridor" sub="Positions from the replay stream" pad={false}>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {liveVehicles.slice(0, 20).map((b) => (
              <div key={b.bus_id} className="row" style={{ padding: '7px 14px', borderBottom: '1px solid rgba(148,163,184,.06)', fontSize: 11.5 }}>
                <span className="fleet-label route-fleet-label"><span className="mono">{displayBusId(b.bus_id)}</span><small>{displayBusName(b.bus_id)}</small></span>
                <span className="grow" style={{ color: '#dbe6f6' }}>{b.next_stop}</span>
                <span className="mono" style={{ color: '#93a4c1' }}>{b.speed_kmh}</span>
                <span className="mono" style={{ width: 42, textAlign: 'right', color: b.occupancy_pct > 80 ? '#f59e0b' : '#93a4c1' }}>{b.occupancy_pct}%</span>
              </div>
            ))}
            {liveRouteQ.loading && <div className="empty">Connecting to the replay stream…</div>}
            {!liveRouteQ.loading && liveRouteQ.error && <div className="empty">Live positions are temporarily unavailable.</div>}
            {!liveRouteQ.loading && !liveRouteQ.error && liveVehicles.length === 0 && <div className="empty">No live vehicle on this corridor right now</div>}
          </div>
        </Card>

        <Card title="Corridor composition" sub="Archetypes along the route">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 250, overflow: 'auto' }}>
            {Object.entries(active.stops.reduce((acc, s) => {
              acc[s.cluster_name] = (acc[s.cluster_name] || 0) + 1
              return acc
            }, {})).sort((a, b) => b[1] - a[1]).map(([name, count]) => {
              const c = active.stops.find((s) => s.cluster_name === name)
              return (
                <div key={name}>
                  <div className="row between" style={{ fontSize: 11, marginBottom: 4 }}>
                    <span>{name}</span><span className="dim mono">{count}</span>
                  </div>
                  <MiniBar value={count} max={active.stops.length} color={c?.cluster_color || '#4f8cff'} />
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      <StopDrawer stopId={stopId} onClose={() => setStopId(null)} />
    </>
  )
}
