import React from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useStream } from '../api.js'
import {
  Bar as MiniBar, Card, Drawer, ErrorBox, Gauge, Icon, Loading, Segmented,
  Sparkline, Tag, TipBox, axis, chartGrid, compact, num,
} from '../ui.jsx'
import StopDrawer from '../components/StopDrawer.jsx'
import { busLabelSearchText, displayBusId, displayBusName } from '../fleetLabels.js'

const BUCKETS = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]]

export default function Live() {
  const [snap, setSnap] = React.useState(null)
  const [history, setHistory] = React.useState([])
  const [sort, setSort] = React.useState('speed')
  const [route, setRoute] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [bus, setBus] = React.useState(null)
  const [stopId, setStopId] = React.useState(null)
  const status = useStream('/api/live/stream', (payload) => {
    setSnap(payload)
    setHistory((h) => [...h.slice(-59), {
      t: payload.sim_time.slice(11, 16),
      speed: payload.avg_speed,
      occ: payload.avg_occupancy,
      buses: payload.active_buses,
    }])
  })

  if (!snap) {
    return (
      <div className="grid g4">
        {[0, 1, 2, 3].map((i) => <Loading key={i} height={90} label="Waiting for telemetry" />)}
      </div>
    )
  }

  const buses = snap.buses
    .filter((b) => (route === 'all' ? true : b.route_id === route))
    .filter((b) => !query || b.bus_id.toLowerCase().includes(query.toLowerCase())
      || busLabelSearchText(b.bus_id).includes(query.toLowerCase())
      || b.next_stop.toLowerCase().includes(query.toLowerCase())
      || b.route_name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'speed') return b.speed_kmh - a.speed_kmh
      if (sort === 'occupancy') return b.occupancy_pct - a.occupancy_pct
      return Math.abs(b.delay_s) - Math.abs(a.delay_s)
    })

  const occHist = BUCKETS.map(([lo, hi]) => ({
    range: `${lo}–${hi > 100 ? 100 : hi}%`,
    count: buses.filter((b) => b.occupancy_pct >= lo && b.occupancy_pct < hi).length,
  }))
  const late = buses.filter((b) => !b.on_time).length
  const full = buses.filter((b) => b.occupancy_pct >= 80)

  return (
    <>
      <div className="grid g6">
        <div className="stat"><div className="label">Active buses</div><div className="value num">{snap.active_buses}</div><div className="foot">{snap.routes.length} corridors</div></div>
        <div className="stat"><div className="label">Avg speed</div><div className="value num">{snap.avg_speed}<small>km/h</small></div>
          <div className="spark"><Sparkline data={history.map((h) => h.speed)} color="#4f8cff" height={24} /></div></div>
        <div className="stat"><div className="label">On time</div><div className="value num">{snap.on_time_pct}<small>%</small></div><div className="foot">{late} buses late</div></div>
        <div className="stat"><div className="label">Passengers</div><div className="value num">{compact(snap.passengers)}</div><div className="foot">on board right now</div></div>
        <div className="stat"><div className="label">Avg occupancy</div><div className="value num">{snap.avg_occupancy}<small>%</small></div><div className="foot">fleet load factor</div></div>
        <div className="stat"><div className="label">Near capacity</div><div className="value num">{full.length}</div><div className="foot">≥ 80% loaded</div></div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Vehicle stream" sub={`${buses.length} buses · sorted by ${sort} · updates every second`}
          actions={<span className="live-pill"><span className="dot" /> {status}</span>} pad={false}>
          <div className="row wrap" style={{ padding: '6px 16px 12px', gap: 8 }}>
            <Segmented value={sort} onChange={setSort}
              options={[{ value: 'speed', label: 'Speed' }, { value: 'occupancy', label: 'Load' }, { value: 'delay', label: 'Delay' }]} />
            <select value={route} onChange={(e) => setRoute(e.target.value)}
              style={{ background: 'rgba(8,13,24,.9)', color: '#cfdaea', border: '1px solid rgba(148,163,184,.2)', borderRadius: 9, padding: '6px 9px', fontSize: 11.5 }}>
              <option value="all">All routes</option>
              {snap.routes.map((r) => <option key={r.route_id} value={r.route_id}>{r.route_id} · {r.route_name}</option>)}
            </select>
            <div className="row grow" style={{ background: 'rgba(148,163,184,.07)', border: '1px solid rgba(148,163,184,.14)', borderRadius: 9, padding: '6px 9px' }}>
              <Icon name="search" size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Bus, route or next stop"
                style={{ background: 'none', border: 0, outline: 'none', color: '#e9effb', fontSize: 11.5, width: '100%' }} />
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: 470 }}>
            <table className="table">
              <thead>
                <tr><th>Bus</th><th>Route</th><th className="r">Speed</th><th style={{ width: 120 }}>Load</th>
                  <th>Next stop</th><th>Zone</th><th className="r">Delay</th></tr>
              </thead>
              <tbody>
                {buses.slice(0, 120).map((b) => (
                  <tr key={b.bus_id} className="clickable" onClick={() => setBus(b)}>
                    <td><div className="fleet-label"><span className="mono" style={{ fontWeight: 700 }}>{displayBusId(b.bus_id)}</span><span>{displayBusName(b.bus_id)}</span></div></td>
                    <td>
                      <span className="row" style={{ gap: 6, fontSize: 11.5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: b.cluster_color }} />
                        {b.route_id}
                      </span>
                    </td>
                    <td className="r">{b.speed_kmh}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <div className="grow"><MiniBar value={b.occupancy_pct} max={100}
                          color={b.occupancy_pct > 80 ? '#f43f5e' : b.occupancy_pct > 55 ? '#f59e0b' : '#34d399'} /></div>
                        <span className="mono" style={{ fontSize: 10, width: 30, textAlign: 'right' }}>{b.occupancy_pct}%</span>
                      </div>
                    </td>
                    <td style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.next_stop}</td>
                    <td className="muted">{b.zone}</td>
                    <td className="r" style={{ color: b.on_time ? '#6ee7b7' : '#fca5a5' }}>
                      {b.delay_s > 0 ? '+' : ''}{b.delay_s}s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Load distribution" sub="Buses per occupancy band">
            <div style={{ height: 168 }}>
              <ResponsiveContainer>
                <BarChart data={occHist} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid {...chartGrid} vertical={false} />
                  <XAxis dataKey="range" {...axis} />
                  <YAxis {...axis} width={34} />
                  <Tooltip content={<TipBox />} />
                  <Bar dataKey="count" name="Buses" fill="#2dd4bf" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Camera detections" sub={`Live footfall around ${snap.sim_hour}:00`} pad={false}>
            <div style={{ maxHeight: 236, overflow: 'auto' }}>
              {snap.detections.map((d, i) => (
                <button key={i} onClick={() => setStopId(d.stop_id)} className="row"
                  style={{ width: '100%', padding: '7px 14px', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid rgba(148,163,184,.06)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: d.cluster_color, marginRight: 8 }} />
                  <span className="grow" style={{ fontSize: 11.5, color: '#dbe6f6' }}>{d.stop_name}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: '#93a4c1' }}>{num(d.pedestrians)} peds</span>
                </button>
              ))}
              {snap.detections.length === 0 && <div className="empty">No camera detections in this hour</div>}
            </div>
          </Card>

          <Card title="Replay state" sub="Virtual clock over the recorded GPS trail">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
              <div className="row between"><span className="muted">Simulated time</span><span className="mono">{new Date(snap.sim_time).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span></div>
              <div className="row between"><span className="muted">Server time</span><span className="mono">{new Date(snap.server_time).toLocaleTimeString('en-GB')}</span></div>
              <div className="row between"><span className="muted">Stream</span><Tag tone="good">SSE · 1 Hz</Tag></div>
              <div className="row between"><span className="muted">Playback rate</span><span className="mono">×14 realtime</span></div>
            </div>
          </Card>
        </div>
      </div>

      <Drawer open={!!bus} onClose={() => setBus(null)}
        title={bus ? `${displayBusId(bus.bus_id)} · ${displayBusName(bus.bus_id)}` : ''} sub={bus ? `${bus.route_id} · ${bus.route_name}` : ''}>
        {bus && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="row" style={{ gap: 18, alignItems: 'center' }}>
              <Gauge value={bus.occupancy_pct} color={bus.cluster_color} size={104}
                label={`${bus.occupancy_pct}%`} sub="loaded" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <Tag tone={bus.on_time ? 'good' : 'warn'}>{bus.on_time ? 'on schedule' : `${bus.delay_s}s late`}</Tag>
                <div style={{ fontSize: 12.5 }}>
                  <div className="dim" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Next stop</div>
                  {bus.next_stop}
                </div>
                <div style={{ fontSize: 12.5 }}>
                  <div className="dim" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' }}>Archetype there</div>
                  <span style={{ color: bus.cluster_color }}>{bus.cluster_name}</span>
                </div>
              </div>
            </div>
            <div className="grid g2" style={{ gap: 8 }}>
              {[
                ['Speed', `${bus.speed_kmh} km/h`],
                ['Heading', `${bus.heading_deg}°`],
                ['Capacity', `${bus.capacity} seats`],
                ['Passengers', Math.round(bus.occupancy_pct * bus.capacity / 100)],
                ['Latitude', bus.lat.toFixed(5)],
                ['Longitude', bus.lon.toFixed(5)],
              ].map(([k, v]) => (
                <div key={k} className="stat" style={{ padding: '9px 11px', gap: 2 }}>
                  <div className="label" style={{ fontSize: 9 }}>{k}</div>
                  <div className="value num" style={{ fontSize: 15 }}>{v}</div>
                </div>
              ))}
            </div>
            <div className="insight">
              <Icon name="bus" size={15} />
              <span>Telemetry is replayed from the recorded GPS trail at 14× realtime, interpolated
                between one-minute pings so every vehicle moves continuously.</span>
            </div>
          </div>
        )}
      </Drawer>

      <StopDrawer stopId={stopId} onClose={() => setStopId(null)} />
    </>
  )
}
