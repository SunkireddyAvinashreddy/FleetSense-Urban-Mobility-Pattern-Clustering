import React from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker } from 'react-leaflet'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api, useAsync, useStream } from '../api.js'
import {
  Card, Drawer, Gauge, Icon, Loading, Segmented, Tag, Toggle, compact, num,
} from '../ui.jsx'
import StopDrawer from '../components/StopDrawer.jsx'
import { displayBusId, displayBusName } from '../fleetLabels.js'

const CENTER = [12.9716, 77.62]
const iconCache = new Map()

function busIcon(color, heading, selected) {
  const bucket = Math.round(heading / 20) * 20
  const key = `${color}|${bucket}|${selected ? 1 : 0}`
  if (iconCache.has(key)) return iconCache.get(key)
  const icon = divIcon({
    className: 'bus-wrap',
    html: `<div class="bus ${selected ? 'selected' : ''}" style="--c:${color};--rot:${bucket}deg">
      <span class="halo"></span>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="${color}">
        <path d="M12 2 20 20 12 16.5 4 20z"/>
      </svg></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
  iconCache.set(key, icon)
  return icon
}

const StopsLayer = React.memo(function StopsLayer({ stops, onPick }) {
  return stops.map((s) => (
    <CircleMarker key={s.stop_id} center={[s.lat, s.lon]} radius={3.4}
      pathOptions={{ color: s.cluster_color, fillColor: s.cluster_color, fillOpacity: .8, weight: 0 }}
      eventHandlers={{ click: () => onPick(s.stop_id) }} />
  ))
})

const RoutesLayer = React.memo(function RoutesLayer({ routes, selected, hovered, onPick, onHover }) {
  return routes.map((r) => {
    const active = selected === r.route_id
    const hot = hovered === r.route_id
    return (
      <Polyline key={r.route_id} positions={r.geometry}
        pathOptions={{
          color: r.color,
          weight: active ? 5 : hot ? 3.5 : 1.7,
          opacity: active ? 0.98 : hot ? 0.75 : selected ? 0.12 : 0.32,
          lineCap: 'round',
          lineJoin: 'round',
        }}
        eventHandlers={{ click: () => onPick(r.route_id), mouseover: () => onHover(r.route_id), mouseout: () => onHover(null) }} />
    )
  })
})

export default function MapView() {
  const [snap, setSnap] = React.useState(null)
  const status = useStream('/api/live/stream', setSnap)
  const stopsQ = useAsync(() => api.stops({ limit: 5000 }), [])
  const netQ = useAsync(() => api.network(), [])
  const [selRoute, setSelRoute] = React.useState(null)
  const [hoverRoute, setHoverRoute] = React.useState(null)
  const [selBus, setSelBus] = React.useState(null)
  const [selStop, setSelStop] = React.useState(null)
  const [follow, setFollow] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [layers, setLayers] = React.useState({ buses: true, routes: true, stops: true, cameras: true })
  const mapRef = React.useRef(null)

  const routes = netQ.data?.routes || []
  const stops = stopsQ.data?.stops || []

  React.useEffect(() => {
    if (!selRoute || !mapRef.current) return
    const r = routes.find((x) => x.route_id === selRoute)
    if (r?.geometry?.length) {
      mapRef.current.fitBounds(r.geometry, { padding: [70, 70], maxZoom: 13.5 })
    }
  }, [selRoute, routes])

  React.useEffect(() => {
    if (!follow || !selBus || !snap || !mapRef.current) return
    const b = snap.buses.find((x) => x.bus_id === selBus.bus_id)
    if (b) mapRef.current.panTo([b.lat, b.lon], { animate: true, duration: 0.8 })
  }, [snap, follow, selBus])

  React.useEffect(() => {
    if (selBus) {
      const fresh = snap?.buses.find((x) => x.bus_id === selBus.bus_id)
      if (fresh) setSelBus(fresh)
    }
  }, [snap]) // eslint-disable-line react-hooks/exhaustive-deps

  const visible = (snap?.buses || []).filter((b) => (selRoute ? b.route_id === selRoute : true))
  const filteredRoutes = routes.filter((r) =>
    !query || r.route_name.toLowerCase().includes(query.toLowerCase()) || r.route_id.toLowerCase().includes(query.toLowerCase()))
  const selectedRoute = routes.find((r) => r.route_id === selRoute)
  const clusters = [...new Map(stops.map((s) => [s.cluster, s])).values()]
  const pickStop = React.useCallback((id) => setSelStop(id), [])
  const pickRoute = React.useCallback((id) => setSelRoute((cur) => (cur === id ? null : id)), [])
  const hoverRouteFn = React.useCallback((id) => setHoverRoute(id), [])

  return (
    <>
      <div className="map-shell" style={{ height: 'calc(100vh - 178px)', minHeight: 640 }}>
        <MapContainer ref={mapRef} center={CENTER} zoom={11.3} zoomControl={false}
          className="map-canvas" style={{ height: '100%' }} preferCanvas>
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution='Tiles &copy; <a href="https://www.esri.com/">Esri</a> and imagery providers'
            maxZoom={19} />
          {/* fallback: OpenStreetMap (no key required) */}
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            alt="OSM fallback"
            style={{ display: 'none' }}
            maxZoom={19} />

          {layers.routes && <RoutesLayer routes={routes} selected={selRoute} hovered={hoverRoute}
            onPick={pickRoute} onHover={hoverRouteFn} />}
          {layers.stops && <StopsLayer stops={stops} onPick={pickStop} />}

          {layers.cameras && (snap?.detections || []).map((d) => (
            <CircleMarker key={d.stop_id + d.stop_name + d.pedestrians} center={[d.lat, d.lon]} radius={7}
              pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: .2, weight: 1 }}
              eventHandlers={{ click: () => setSelStop(d.stop_id) }} />
          ))}

          {layers.buses && visible.map((b) => (
            <Marker key={b.bus_id} position={[b.lat, b.lon]}
              icon={busIcon(b.cluster_color, b.heading_deg, selBus?.bus_id === b.bus_id)}
              zIndexOffset={selBus?.bus_id === b.bus_id ? 1200 : 0}
              eventHandlers={{ click: () => { setSelBus(b); setFollow(true) } }} />
          ))}
        </MapContainer>

        {/* live KPI strip */}
        <div className="map-overlay map-top">
          <div className="map-panel">
            <div className="map-kpi-row">
              <div className="map-kpi"><div className="k">Buses</div><div className="v">{snap?.active_buses ?? '—'}</div></div>
              <div className="map-kpi"><div className="k">Avg speed</div><div className="v">{snap?.avg_speed ?? '—'} <small>km/h</small></div></div>
              <div className="map-kpi"><div className="k">On time</div><div className="v">{snap?.on_time_pct ?? '—'}<small>%</small></div></div>
              <div className="map-kpi"><div className="k">Passengers</div><div className="v">{snap ? compact(snap.passengers) : '—'}</div></div>
              <div className="map-kpi"><div className="k">Sim clock</div>
                <div className="v" style={{ fontSize: 14 }}>
                  {snap ? new Date(snap.sim_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* control panel */}
        <div className="map-overlay map-side map-panel">
          <div className="row between">
            <h4>Layers</h4>
            <span className={`live-pill`} style={{ padding: '2px 7px', fontSize: 9 }}>
              <span className="dot" /> {status}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[['buses', 'Vehicles'], ['routes', 'Routes'], ['stops', 'Stops'], ['cameras', 'Camera events']].map(([key, label]) => (
              <Toggle key={key} on={layers[key]} onChange={(v) => setLayers((l) => ({ ...l, [key]: v }))}>{label}</Toggle>
            ))}
          </div>

          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost grow" onClick={() => mapRef.current?.zoomIn()}>+</button>
            <button className="btn ghost grow" onClick={() => mapRef.current?.zoomOut()}>−</button>
            <button className="btn ghost" onClick={() => { setSelRoute(null); mapRef.current?.setView(CENTER, 11.3) }}>Reset</button>
          </div>

          <div style={{ height: 1, background: 'rgba(148,163,184,.13)' }} />

          <h4>Routes {selRoute && <button className="btn ghost" style={{ padding: '1px 7px', fontSize: 10, marginLeft: 6 }} onClick={() => setSelRoute(null)}>clear</button>}</h4>
          <div className="row" style={{ background: 'rgba(148,163,184,.07)', border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: '5px 8px' }}>
            <Icon name="search" size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a route"
              style={{ background: 'none', border: 0, outline: 'none', color: '#e9effb', fontSize: 11.5, width: '100%' }} />
          </div>
          <div style={{ maxHeight: 232, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 3, paddingRight: 2 }}>
            {filteredRoutes.map((r) => (
              <button key={r.route_id} onClick={() => setSelRoute((cur) => (cur === r.route_id ? null : r.route_id))}
                className={`chip ${selRoute === r.route_id ? 'active' : ''}`}
                style={{ justifyContent: 'flex-start', borderRadius: 8, padding: '5px 8px', fontSize: 11 }}>
                <span className="swatch" style={{ background: r.color, height: 10, width: 3, borderRadius: 2 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.route_name}</span>
                <span className="mono dim" style={{ marginLeft: 'auto', fontSize: 10 }}>{r.buses}</span>
              </button>
            ))}
          </div>

          <div style={{ height: 1, background: 'rgba(148,163,184,.13)' }} />
          <h4>Archetype overlay</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {clusters.map((c) => (
              <div key={c.cluster} className="legend-item">
                <span className="swatch" style={{ background: c.cluster_color }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.cluster_name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* status / selected route */}
        <div className="map-overlay map-bottom">
          <div className="map-panel" style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 12, maxWidth: 560 }}>
            {selectedRoute ? (
              <>
                <span style={{ width: 4, height: 30, borderRadius: 3, background: selectedRoute.color }} />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{selectedRoute.route_name}</div>
                  <div className="dim" style={{ fontSize: 10.5 }}>
                    {selectedRoute.n_stops} stops · {selectedRoute.buses} buses · {compact(selectedRoute.riders_day)} riders/day
                  </div>
                </div>
                <span className="tag info" style={{ marginLeft: 'auto' }}>{visible.length} live</span>
              </>
            ) : (
              <>
                <span className="live-pill"><span className="dot" /> replay ×14</span>
                <span className="dim" style={{ fontSize: 11 }}>
                  {snap ? `${num(snap.active_buses)} vehicles moving on ${snap.routes.length} corridors — click a bus, a route or a stop` : 'Connecting to the live stream…'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* bus detail */}
        {selBus && (
          <div className="bus-card">
            <div className="row between">
              <div className="title">
                <span style={{ width: 8, height: 8, borderRadius: 3, background: selBus.cluster_color }} />
                {displayBusId(selBus.bus_id)} · {displayBusName(selBus.bus_id)}
                <Tag tone={selBus.on_time ? 'good' : 'warn'}>{selBus.on_time ? 'on time' : `${selBus.delay_s}s late`}</Tag>
              </div>
              <button className="drawer-close" style={{ width: 24, height: 24 }} onClick={() => { setSelBus(null); setFollow(false) }}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="route">{selBus.route_id} · {selBus.route_name}</div>
            <div className="metrics">
              <div className="metric"><div className="k">Speed</div><div className="v">{selBus.speed_kmh} km/h</div></div>
              <div className="metric"><div className="k">Occupancy</div><div className="v">{selBus.occupancy_pct}%</div></div>
              <div className="metric"><div className="k">Next stop</div><div className="v" style={{ fontSize: 11, fontWeight: 600 }}>{selBus.next_stop}</div></div>
              <div className="metric"><div className="k">Zone</div><div className="v" style={{ fontSize: 11, fontWeight: 600 }}>{selBus.zone}</div></div>
            </div>
            <div className="row" style={{ marginTop: 10, gap: 10 }}>
              <Gauge value={selBus.occupancy_pct} color={selBus.cluster_color} size={72}
                label={selBus.capacity} sub="seats" />
              <div className="grow" style={{ fontSize: 11, color: '#93a4c1', lineHeight: 1.5 }}>
                Camera at next stop sees a <b>{selBus.cluster_name.toLowerCase()}</b> profile.
                <div style={{ marginTop: 6 }}>
                  <Toggle on={follow} onChange={setFollow}>Follow this bus</Toggle>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid g4" style={{ marginTop: 14 }}>
        {(snap?.routes || []).slice(0, 4).map((r) => {
          const meta = routes.find((x) => x.route_id === r.route_id)
          return (
            <button key={r.route_id} className="card" style={{ padding: 12, textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setSelRoute(r.route_id)}>
              <div className="row between">
                <span className="row" style={{ gap: 7, fontSize: 12, fontWeight: 650 }}>
                  <span className="swatch" style={{ background: meta?.color || '#4f8cff', width: 8, height: 8, borderRadius: 3 }} />
                  {r.route_name}
                </span>
                <span className="tag">{r.buses} buses</span>
              </div>
              <div className="row between" style={{ marginTop: 8, fontSize: 11, color: '#93a4c1' }}>
                <span className="mono">{r.speed} km/h</span>
                <span className="mono">occ {r.occupancy}%</span>
                <span className="mono">{r.on_time_pct}% on time</span>
              </div>
            </button>
          )
        })}
      </div>

      <StopDrawer stopId={selStop} onClose={() => setSelStop(null)} />
    </>
  )
}
