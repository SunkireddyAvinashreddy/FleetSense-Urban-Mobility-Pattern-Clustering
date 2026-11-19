import React from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart,
  Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Bar as MiniBar, Card, ErrorBox, Icon, Loading, Tag, axis, chartGrid, compact, hourLabel, num,
} from '../ui.jsx'
import StopDrawer from '../components/StopDrawer.jsx'

function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div style={{ background: 'rgba(8,14,25,.97)', border: '1px solid rgba(148,163,184,.24)', borderRadius: 10, padding: '9px 11px', fontSize: 11.5 }}>
      <div style={{ fontWeight: 650 }}>{p.stop_name}</div>
      <div className="dim" style={{ fontSize: 10.5, marginBottom: 4 }}>{p.zone} · {p.cluster_name}</div>
      <div className="row between" style={{ gap: 16 }}><span className="muted">Anomaly score</span><span className="mono">{num(p.anomaly_score, 3)}</span></div>
      <div className="row between" style={{ gap: 16 }}><span className="muted">Footfall</span><span className="mono">{num(p.footfall_total)}</span></div>
    </div>
  )
}

export default function Anomalies() {
  const { data, loading, error } = useAsync(() => api.anomalies(), [])
  const scatterQ = useAsync(() => api.scatter(), [])
  const [stopId, setStopId] = React.useState(null)
  const [minScore, setMinScore] = React.useState(0.75)

  if (loading) return <Loading height={420} label="Scoring anomalies" />
  if (error) return <ErrorBox error={error} />

  const points = scatterQ.data?.points || []
  const flagged = data.stop_outliers.filter((s) => s.anomaly_score >= minScore)
  const hourly = data.hourly || []
  const byHour = Array.from({ length: 24 }, (_, h) => ({
    h: hourLabel(h),
    count: hourly.filter((r) => Number(r.hour) === h).length,
    demand: hourly.filter((r) => Number(r.hour) === h).reduce((a, r) => a + Number(r.demand || 0), 0),
  }))

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="label">DBSCAN spatial outliers</div><div className="value num">{data.dbscan_outliers}</div><div className="foot">density-based, 3 PCs</div></div>
        <div className="stat"><div className="label">Isolation Forest flags</div><div className="value num">{data.iso_anomalies}</div><div className="foot">multivariate stop profiles</div></div>
        <div className="stat"><div className="label">Anomalous stop-hours</div><div className="value num">{hourly.length}</div><div className="foot">from 314k panel rows</div></div>
        <div className="stat"><div className="label">Decision threshold</div><div className="value num">{data.threshold}</div><div className="foot">normalised anomaly score</div></div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Latent space" sub="PCA embedding — bubble size is total footfall, red points are flagged">
          <div style={{ height: 340 }}>
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 10, right: 14, left: -18, bottom: 0 }}>
                <CartesianGrid {...chartGrid} />
                <XAxis type="number" dataKey="pca_x" name="PC1" {...axis} />
                <YAxis type="number" dataKey="pca_y" name="PC2" {...axis} width={40} />
                <ZAxis type="number" dataKey="footfall_total" range={[24, 260]} />
                <Tooltip content={<ScatterTip />} />
                <Scatter data={points} isAnimationActive={false}>
                  {points.map((p, i) => (
                    <Cell key={i}
                      fill={p.outlier ? '#f43f5e' : p.anomaly_score > data.threshold ? '#f59e0b' : p.cluster_color}
                      fillOpacity={p.outlier || p.anomaly_score > data.threshold ? 0.95 : 0.4}
                      stroke={p.outlier ? '#fecdd3' : 'none'} strokeWidth={1} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="legend" style={{ marginTop: 6 }}>
            <span className="legend-item"><span className="swatch" style={{ background: '#f43f5e' }} /> DBSCAN outlier</span>
            <span className="legend-item"><span className="swatch" style={{ background: '#f59e0b' }} /> high IF score</span>
            <span className="legend-item"><span className="swatch" style={{ background: '#4f8cff' }} /> normal stop (coloured by cluster)</span>
          </div>
        </Card>

        <Card title="Anomalies by hour of day" sub="Stop-hours flagged by Isolation Forest">
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={byHour} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid {...chartGrid} vertical={false} />
                <XAxis dataKey="h" {...axis} interval={3} />
                <YAxis {...axis} width={34} />
                <Bar dataKey="count" name="Flags" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="insight">
            <Icon name="alert" size={15} />
            <span>Spikes cluster around late-evening hours, consistent with event traffic and
              night-shift departures exceeding the learned baseline.</span>
          </div>
        </Card>
      </div>

      <div className="split" style={{ marginTop: 14 }}>
        <Card title="Stop-level outliers" sub={`Stops with anomaly score ≥ ${minScore.toFixed(2)}`}
          actions={
            <div className="row" style={{ gap: 8 }}>
              <span className="dim" style={{ fontSize: 10.5 }}>{flagged.length} shown</span>
              <input type="range" min="0.5" max="0.95" step="0.01" value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))} style={{ width: 90, accentColor: '#f43f5e' }} />
            </div>
          } pad={false}>
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="table">
              <thead><tr><th>Stop</th><th>Zone</th><th>Archetype</th><th style={{ width: 110 }}>Score</th><th className="r">Dwell</th><th className="r">Routes</th><th /></tr></thead>
              <tbody>
                {flagged.map((s) => (
                  <tr key={s.stop_id} className="clickable" onClick={() => setStopId(s.stop_id)}>
                    <td style={{ fontWeight: 600 }}>{s.stop_name}</td>
                    <td className="muted">{s.zone}</td>
                    <td><Tag color={s.cluster_color}>{s.cluster_name}</Tag></td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <div className="grow"><MiniBar value={s.anomaly_score} max={1} color={s.anomaly_score > 0.8 ? '#f43f5e' : '#f59e0b'} /></div>
                        <span className="mono" style={{ fontSize: 10, width: 30, textAlign: 'right' }}>{num(s.anomaly_score, 2)}</span>
                      </div>
                    </td>
                    <td className="r">{num(s.dwell_mean_s, 1)}s</td>
                    <td className="r">{s.routes_served}</td>
                    <td>{s.outlier && <Tag tone="danger">spatial</Tag>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Anomalous stop-hours" sub="Highest-demand flagged intervals" pad={false}>
          <div className="table-wrap" style={{ maxHeight: 380 }}>
            <table className="table">
              <thead><tr><th>Stop</th><th>Date</th><th className="r">Hour</th><th className="r">Riders</th><th className="r">Peds</th><th className="r">Demand</th></tr></thead>
              <tbody>
                {hourly.slice(0, 40).map((r, i) => (
                  <tr key={i} className="clickable" onClick={() => setStopId(r.stop_id)}>
                    <td className="mono" style={{ fontSize: 11 }}>{r.stop_id}</td>
                    <td className="muted">{r.date}</td>
                    <td className="r">{String(r.hour).padStart(2, '0')}:00</td>
                    <td className="r">{num(r.riders)}</td>
                    <td className="r">{num(r.pedestrians)}</td>
                    <td className="r" style={{ color: '#fcd34d' }}>{compact(r.demand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <Card title="DBSCAN" sub="Spatial / density detector">
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 0 }}>
            Runs on the first three principal components with <b>eps = {num(0.85, 3)}</b> and
            <b> min_samples = 6</b>. It finds stops whose behaviour is genuinely isolated rather
            than merely at the edge of a cluster.
          </p>
          <div className="row between" style={{ fontSize: 11.5 }}><span className="muted">Noise rate</span><span className="mono">{((data.dbscan_outliers / points.length) * 100).toFixed(1)}%</span></div>
        </Card>
        <Card title="Isolation Forest" sub="Multivariate rarity">
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 0 }}>
            300 trees score each stop's 31-feature profile; the score is normalised to 0–1 and
            surfaced here so operations can inspect the extremes first.
          </p>
          <div className="row between" style={{ fontSize: 11.5 }}><span className="muted">Contamination</span><span className="mono">6%</span></div>
        </Card>
        <Card title="Stop-hour detector" sub="Second Isolation Forest">
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginTop: 0 }}>
            A separate forest runs over every stop-hour in the panel, catching demand spikes that
            a stop-level average would hide.
          </p>
          <div className="row between" style={{ fontSize: 11.5 }}><span className="muted">Scored rows</span><span className="mono">{compact(314160)}</span></div>
        </Card>
      </div>

      <StopDrawer stopId={stopId} onClose={() => setStopId(null)} />
    </>
  )
}
