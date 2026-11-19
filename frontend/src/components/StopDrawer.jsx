import React from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Card, Drawer, ErrorBox, Icon, Loading, Tag, TipBox, axis, chartGrid, compact,
  hourLabel, num,
} from '../ui.jsx'

export default function StopDrawer({ stopId, onClose }) {
  const { data, loading, error } = useAsync(
    () => (stopId ? api.stop(stopId) : Promise.resolve(null)),
    [stopId],
  )

  if (!stopId) return null
  const s = data?.stop
  const p = data?.profile
  const rows = p ? p.hours.map((h, i) => ({
    h: hourLabel(h),
    riders: p.riders[i],
    peds: p.pedestrians[i],
    dwell: p.dwell[i],
  })) : []

  return (
    <Drawer open={!!stopId} onClose={onClose}
      title={s?.stop_name || 'Stop profile'}
      sub={s ? `${s.stop_id} · ${s.zone} · ${s.cluster_name}` : 'Loading telemetry…'}>
      {loading && <Loading height={220} label="Reading stop telemetry" />}
      {error && <ErrorBox error={error} />}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Tag color={s.cluster_color}>{s.cluster_name}</Tag>
            <Tag>{s.rhythm_name}</Tag>
            {s.outlier && <Tag tone="danger">spatial outlier</Tag>}
            {s.routes_served > 1 && <Tag tone="info">{s.routes_served} routes</Tag>}
          </div>

          <div className="grid g3" style={{ gap: 8 }}>
            {[
              ['Daily riders', num(s.riders_day)],
              ['Camera footfall', num(s.peds_day)],
              ['Dwell', `${num(s.dwell_mean_s, 1)}s`],
              ['Approach speed', `${num(s.speed_mean_kmh, 1)} km/h`],
              ['Anomaly score', num(s.anomaly_score, 2)],
              ['Routes served', s.routes_served],
            ].map(([k, v]) => (
              <div key={k} className="stat" style={{ padding: '10px 11px', gap: 3 }}>
                <div className="label" style={{ fontSize: 9.5 }}>{k}</div>
                <div className="value num" style={{ fontSize: 17 }}>{v}</div>
              </div>
            ))}
          </div>

          <Card title="24-hour demand" sub="Weekday mean riders and camera footfall" pad={false}>
            <div style={{ height: 190, padding: '4px 4px 0' }}>
              <ResponsiveContainer>
                <AreaChart data={rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sd-riders" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f8cff" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#4f8cff" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="sd-peds" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGrid} vertical={false} />
                  <XAxis dataKey="h" {...axis} interval={3} />
                  <YAxis {...axis} width={38} />
                  <Tooltip content={<TipBox />} />
                  <Area type="monotone" dataKey="riders" name="Riders" stroke="#4f8cff"
                    strokeWidth={2} fill="url(#sd-riders)" />
                  <Area type="monotone" dataKey="peds" name="Pedestrians" stroke="#2dd4bf"
                    strokeWidth={1.6} fill="url(#sd-peds)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Weekly rhythm" sub="Average riders by day of week" pad={false}>
            <div style={{ height: 130, padding: '0 4px 0' }}>
              <ResponsiveContainer>
                <BarChart data={data.week} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid {...chartGrid} vertical={false} />
                  <XAxis dataKey="dow" tickFormatter={(d) => ['M', 'T', 'W', 'T', 'F', 'S', 'S'][d]} {...axis} />
                  <YAxis {...axis} width={38} />
                  <Tooltip content={<TipBox />} />
                  <Bar dataKey="riders" name="Riders" fill="#4f8cff" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="peds" name="Pedestrians" fill="#2dd4bf" radius={[4, 4, 0, 0]} opacity={0.6} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {data.routes?.length > 0 && (
            <Card title="Corridors serving this stop" pad={false}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {data.routes.map((r) => (
                  <div key={r.route_id} className="row" style={{ padding: '9px 14px', borderBottom: '1px solid rgba(148,163,184,.07)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 3, background: r.color }} />
                    <div className="grow">
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.route_name}</div>
                      <div className="dim" style={{ fontSize: 10.5 }}>{r.route_id} · every {r.headway_min} min · {r.buses} buses</div>
                    </div>
                    <div className="right mono" style={{ fontSize: 11, color: '#93a4c1' }}>{compact(r.riders_day)}/day</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Nearby stops" pad={false}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {data.nearby.map((n) => (
                <div key={n.stop_id} className="row" style={{ padding: '8px 14px', borderBottom: '1px solid rgba(148,163,184,.06)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: n.cluster_color }} />
                  <div className="grow" style={{ fontSize: 12 }}>{n.stop_name}</div>
                  <span className="mono dim" style={{ fontSize: 10.5 }}>{num(n.d, 2)} km</span>
                  <span className="mono" style={{ fontSize: 10.5, color: '#93a4c1' }}>{compact(n.footfall_total)}</span>
                </div>
              ))}
            </div>
          </Card>

          <div className="insight">
            <Icon name="spark" size={15} />
            <span>
              Busiest hours are {data.peak_hours.map(hourLabel).join(', ')}. This stop behaves like a
              <b> {s.cluster_name.toLowerCase()}</b> location, averaging {num(s.dwell_mean_s, 1)}s dwell
              across {s.routes_served} route{s.routes_served > 1 ? 's' : ''}.
            </span>
          </div>
        </div>
      )}
    </Drawer>
  )
}
