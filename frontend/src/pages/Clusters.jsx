import React from 'react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Bar as MiniBar, Card, Donut, ErrorBox, Icon, Loading, Sparkline, Tag, TipBox,
  axis, chartGrid, compact, hourLabel, num, pct,
} from '../ui.jsx'
import StopDrawer from '../components/StopDrawer.jsx'

const KEY = [
  ['log_footfall', 'Footfall volume'],
  ['morning_share', 'Morning share'],
  ['evening_share', 'Evening share'],
  ['night_share', 'Night share'],
  ['dwell_mean_s', 'Mean dwell'],
  ['speed_mean_kmh', 'Approach speed'],
  ['weekend_ratio', 'Weekend ratio'],
  ['routes_served', 'Routes served'],
]

export default function Clusters() {
  const clustersQ = useAsync(() => api.clusters(), [])
  const metricsQ = useAsync(() => api.metrics(), [])
  const heatQ = useAsync(() => api.heatmap(), [])
  const [sel, setSel] = React.useState(null)
  const [stopId, setStopId] = React.useState(null)

  const clusters = clustersQ.data?.clusters || []
  const activeId = sel ?? clusters[0]?.id
  const active = clusters.find((c) => c.id === activeId)
  const stopsQ = useAsync(() => (activeId == null ? Promise.resolve({ stops: [] }) : api.stops({ cluster: activeId })), [activeId])

  if (clustersQ.loading) return <Loading height={420} label="Loading cluster model" />
  if (clustersQ.error) return <ErrorBox error={clustersQ.error} />

  const m = metricsQ.data
  const heatRow = (heatQ.data?.rows || []).find((r) => r.id === activeId)
  const maxHeat = Math.max(1, ...(heatRow?.values || [1]))
  const curve = (active?.curve_abs || []).map((v, h) => ({ h: hourLabel(h), demand: v, norm: (active.curve_norm?.[h] || 0) * 1000 }))

  // feature position of this cluster relative to all clusters (0..1)
  const featureRank = (f) => {
    if (!m?.centroids?.length) return 0
    const vals = m.centroids.map((c) => c.centroid[f])
    const v = active?.centroid?.[f] ?? 0
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return hi > lo ? (v - lo) / (hi - lo) : 0.5
  }

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="label">Archetypes</div><div className="value num">{clusters.length}</div><div className="foot">selected by silhouette + parsimony</div></div>
        <div className="stat"><div className="label">Silhouette</div><div className="value num">{num(m?.silhouette ?? 0, 3)}</div><div className="foot">on 6 principal components</div></div>
        <div className="stat"><div className="label">ARI vs Ward</div><div className="value num">{num(m?.ari_kmeans_vs_ward ?? 0, 3)}</div><div className="foot">partition stability check</div></div>
        <div className="stat"><div className="label">Dominant-label purity</div><div className="value num">{pct(m?.label_purity_mean ?? 0)}</div><div className="foot">post-hoc check only, never trained on</div></div>
      </div>

      <div className="grid g4" style={{ marginTop: 14 }}>
        {clusters.map((c) => (
          <button key={c.id} onClick={() => setSel(c.id)}
            className="card" style={{ padding: 14, textAlign: 'left', cursor: 'pointer',
              borderColor: activeId === c.id ? `${c.color}88` : undefined,
              boxShadow: activeId === c.id ? `0 0 0 1px ${c.color}44, 0 20px 40px -30px ${c.color}` : undefined }}>
            <div className="row between">
              <span className="row" style={{ gap: 7, fontSize: 12, fontWeight: 650 }}>
                <span className="swatch" style={{ background: c.color, width: 9, height: 9, borderRadius: 3 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              </span>
              <span className="mono dim" style={{ fontSize: 10.5 }}>C{c.id}</span>
            </div>
            <div className="row between" style={{ marginTop: 8, fontSize: 10.5, color: '#63748f' }}>
              <span>{c.stops} stops · {pct(c.share, 1)}</span>
              <span className="mono">{compact(c.avg_footfall)}/day</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <Sparkline data={c.curve_norm || []} color={c.color} height={34} />
            </div>
            <div className="row between" style={{ marginTop: 6, fontSize: 10, color: '#63748f' }}>
              <span>dwell {c.avg_dwell_s}s</span>
              <span>{c.avg_routes} routes</span>
              <span>{c.weekend_ratio}× weekend</span>
            </div>
          </button>
        ))}
      </div>

      {active && (
        <div className="split" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card title={active.name} sub={`Cluster C${active.id} · ${active.stops} stops · dominant latent type ${active.dominant_archetype}`}
              actions={<Tag color={active.color}>{pct(active.share, 1)} of network</Tag>}>
              <div style={{ height: 250 }}>
                <ResponsiveContainer>
                  <AreaChart data={curve} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="cl-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={active.color} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={active.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...chartGrid} vertical={false} />
                    <XAxis dataKey="h" {...axis} interval={2} />
                    <YAxis {...axis} width={44} tickFormatter={compact} />
                    <Tooltip content={<TipBox formatter={(v) => num(v, 1)} />} />
                    <Area type="monotone" dataKey="demand" name="Demand" stroke={active.color}
                      strokeWidth={2.4} fill="url(#cl-grad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Demand heat by hour" sub="Weekday mean demand for every archetype">
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: '6px 10px', alignItems: 'center' }}>
                {(heatQ.data?.rows || []).map((r) => (
                  <React.Fragment key={r.id}>
                    <span className="row" style={{ gap: 6, fontSize: 10.5, color: r.id === activeId ? '#e9effb' : '#93a4c1' }}>
                      <span className="swatch" style={{ background: r.color, width: 6, height: 6 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: 2 }}>
                      {r.values.map((v, h) => (
                        <div key={h} title={`${hourLabel(h)} · ${num(v)}`} style={{
                          height: 16, borderRadius: 3,
                          background: `color-mix(in srgb, ${r.color} ${Math.round(10 + (v / maxHeat) * 80)}%, rgba(9,15,27,.9))`,
                          outline: r.id === activeId ? '1px solid rgba(148,163,184,.18)' : 'none',
                        }} />
                      ))}
                    </div>
                  </React.Fragment>
                ))}
              </div>
              <div className="row between" style={{ marginTop: 8, fontSize: 9.5, color: '#4b5a72' }}>
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
              </div>
            </Card>

            <Card title="Stops in this archetype" sub="Sorted by total footfall" pad={false}
              actions={<span className="tag">{stopsQ.data?.count ?? 0} stops</span>}>
              <div className="table-wrap" style={{ maxHeight: 300 }}>
                <table className="table">
                  <thead><tr><th>Stop</th><th>Zone</th><th className="r">Riders</th><th className="r">Footfall</th><th className="r">Dwell</th><th className="r">Anomaly</th></tr></thead>
                  <tbody>
                    {[...(stopsQ.data?.stops || [])].sort((a, b) => b.footfall_total - a.footfall_total).slice(0, 40).map((s) => (
                      <tr key={s.stop_id} className="clickable" onClick={() => setStopId(s.stop_id)}>
                        <td style={{ fontWeight: 600 }}>{s.stop_name}</td>
                        <td className="muted">{s.zone}</td>
                        <td className="r">{num(s.riders_day)}</td>
                        <td className="r">{num(s.footfall_total)}</td>
                        <td className="r">{num(s.dwell_mean_s, 1)}s</td>
                        <td className="r">{num(s.anomaly_score, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card title="Cluster fingerprint" sub="Position relative to every other archetype">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                {KEY.map(([f, label]) => (
                  <div key={f}>
                    <div className="row between" style={{ fontSize: 11, marginBottom: 4 }}>
                      <span className="muted">{label}</span>
                      <span className="mono" style={{ fontSize: 10.5 }}>
                        {f.includes('share') ? pct(active.centroid[f]) : num(active.centroid[f], 1)}
                      </span>
                    </div>
                    <MiniBar value={featureRank(f)} max={1} color={active.color} />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Footfall split" sub="Riders vs camera pedestrians">
              <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                <Donut size={124} thickness={12} center={compact(active.avg_footfall)} sub="footfall"
                  segments={[
                    { value: active.avg_riders_day, color: active.color },
                    { value: active.avg_peds_day, color: '#2dd4bf' },
                  ]} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                  <div>
                    <div className="row between" style={{ fontSize: 11 }}><span className="muted">Riders</span><span className="mono">{compact(active.avg_riders_day)}</span></div>
                    <MiniBar value={active.avg_riders_day} max={active.avg_footfall} color={active.color} />
                  </div>
                  <div>
                    <div className="row between" style={{ fontSize: 11 }}><span className="muted">Pedestrians</span><span className="mono">{compact(active.avg_peds_day)}</span></div>
                    <MiniBar value={active.avg_peds_day} max={active.avg_footfall} color="#2dd4bf" />
                  </div>
                  <div className="row between" style={{ fontSize: 11 }}>
                    <span className="muted">Ped : rider</span><span className="mono">{active.ped_to_rider}×</span>
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Where it lives" sub="Top zones for this archetype">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {active.top_zones.map((z) => {
                  const count = (stopsQ.data?.stops || []).filter((s) => s.zone === z).length
                  return (
                    <div key={z}>
                      <div className="row between" style={{ fontSize: 11.5, marginBottom: 4 }}>
                        <span>{z}</span><span className="dim mono">{count} stops</span>
                      </div>
                      <MiniBar value={count} max={active.stops} color={active.color} />
                    </div>
                  )
                })}
              </div>
              <div className="insight" style={{ marginTop: 14 }}>
                <Icon name="layers" size={15} />
                <span>
                  This cluster is {pct(active.share, 1)} of the network, averages
                  {' '}{num(active.avg_dwell_s, 1)}s dwell and {active.avg_speed} km/h approach speed.
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}

      <StopDrawer stopId={stopId} onClose={() => setStopId(null)} />
    </>
  )
}
