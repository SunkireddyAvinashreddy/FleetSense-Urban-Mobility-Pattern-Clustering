import React from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Bar as MiniBar, Card, ErrorBox, Heat, Icon, Loading, Tag, TipBox, axis,
  chartGrid, compact, hourLabel, num, pct,
} from '../ui.jsx'

const RHYTHM_COLORS = ['#4f8cff', '#2dd4bf', '#f59e0b', '#a78bfa']

export default function Model() {
  const { data, loading, error } = useAsync(() => api.model(), [])
  const [q, setQ] = React.useState('')
  const [heatFeatures, setHeatFeatures] = React.useState([
    'log_footfall', 'morning_share', 'evening_share', 'night_share',
    'dwell_mean_s', 'speed_mean_kmh', 'weekend_ratio', 'routes_served',
  ])

  if (loading) return <Loading height={460} label="Loading trained model" />
  if (error) return <ErrorBox error={error} />

  const m = data.metrics
  const labels = data.meta.feature_labels || {}
  const stats = m.feature_stats || {}
  const features = data.meta.features.filter((f) =>
    !q || f.includes(q.toLowerCase()) || (labels[f] || '').toLowerCase().includes(q.toLowerCase()))
  const kData = m.k_selection.map((t) => ({ k: t.k, silhouette: t.silhouette, db: t.davies_bouldin }))
  const pcaData = (m.pca_explained || []).map((v, i) => ({ pc: `PC${i + 1}`, variance: v * 100 }))
  const rhythmData = Array.from({ length: 24 }, (_, h) => {
    const row = { h: hourLabel(h) }
    data.rhythms.forEach((r) => { row[r.name] = r.curve[h] })
    return row
  })
  const heatMax = (f) => Math.max(1, ...data.clusters.map((c) => c.centroid[f] || 0))

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="label">Algorithm stack</div><div className="value" style={{ fontSize: 17, lineHeight: 1.35 }}>KMeans + Ward<br />DBSCAN + iForest</div><div className="foot">{m.n_features} features · 6 PCs</div></div>
        <div className="stat"><div className="label">Silhouette</div><div className="value num">{num(m.silhouette, 4)}</div><div className="foot">Davies–Bouldin {num(m.davies_bouldin, 3)}</div></div>
        <div className="stat"><div className="label">Clusters</div><div className="value num">{m.chosen_k}</div><div className="foot">ARI vs Ward {num(m.ari_kmeans_vs_ward, 3)}</div></div>
        <div className="stat"><div className="label">Training data</div><div className="value num">{compact(m.n_panel_rows)}</div><div className="foot">{compact(m.n_source_events)} bus calls · {m.train_seconds}s train</div></div>
      </div>

      <div className="grid g6" style={{ marginTop: 14 }}>
        {Object.entries(m.algorithms || {}).map(([k, v]) => (
          <div key={k} className="stat" style={{ padding: '11px 13px' }}>
            <div className="label" style={{ fontSize: 9, textTransform: 'uppercase' }}>{k}</div>
            <div style={{ fontSize: 12.5, fontWeight: 650, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Cluster-count selection" sub="Silhouette across k = 3…12, with the parsimony rule">
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={kData} margin={{ top: 10, right: 12, left: -14, bottom: 0 }}>
                <CartesianGrid {...chartGrid} vertical={false} />
                <XAxis dataKey="k" {...axis} />
                <YAxis {...axis} width={46} domain={['auto', 'auto']} />
                <Tooltip content={<TipBox formatter={(v) => num(v, 4)} />} />
                <ReferenceLine x={m.chosen_k} stroke="#34d399" strokeDasharray="4 4"
                  label={{ value: `k=${m.chosen_k}`, fill: '#6ee7b7', fontSize: 10, position: 'top' }} />
                <Line type="monotone" dataKey="silhouette" name="Silhouette" stroke="#4f8cff"
                  strokeWidth={2.4} dot={{ r: 3, fill: '#4f8cff' }} />
                <Line type="monotone" dataKey="db" name="Davies–Bouldin" stroke="#a78bfa"
                  strokeWidth={1.6} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Explained variance" sub={`${pct(m.pca2d_variance_explained)} captured by the first two components`}>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={pcaData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...chartGrid} vertical={false} />
                <XAxis dataKey="pc" {...axis} />
                <YAxis {...axis} width={40} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<TipBox formatter={(v) => `${num(v, 1)}%`} />} />
                <Bar dataKey="variance" name="Variance" radius={[4, 4, 0, 0]}>
                  {pcaData.map((d, i) => <Cell key={i} fill={i < 2 ? '#4f8cff' : '#31456b'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="split" style={{ marginTop: 14 }}>
        <Card title="Feature matrix" sub={`${data.meta.features.length} engineered features with training distribution statistics`}
          actions={
            <div className="row" style={{ background: 'rgba(148,163,184,.07)', border: '1px solid rgba(148,163,184,.14)', borderRadius: 9, padding: '5px 9px' }}>
              <Icon name="search" size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter features"
                style={{ background: 'none', border: 0, outline: 'none', color: '#e9effb', fontSize: 11.5, width: 130 }} />
            </div>
          } pad={false}>
          <div className="table-wrap" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead><tr><th>Feature</th><th className="r">Mean</th><th className="r">Median</th><th className="r">Std</th><th style={{ width: 150 }}>Range</th></tr></thead>
              <tbody>
                {features.map((f) => {
                  const s = stats[f] || {}
                  const r = data.meta.ranges?.[f] || [0, 1]
                  const span = r[1] - r[0] || 1
                  const spanPct = ((s.max ?? 1) - (s.min ?? 0)) / span
                  return (
                    <tr key={f}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 11.5 }}>{labels[f] || f}</div>
                        <div className="mono dim" style={{ fontSize: 9.5 }}>{f}</div>
                      </td>
                      <td className="r">{num(s.mean, 3)}</td>
                      <td className="r">{num(s.median, 3)}</td>
                      <td className="r">{num(s.std, 3)}</td>
                      <td>
                        <div className="bar-track" style={{ height: 5, position: 'relative' }}>
                          <div className="bar-fill" style={{
                            position: 'absolute',
                            left: `${((s.min ?? 0) - r[0]) / span * 100}%`,
                            width: `${Math.max(3, spanPct * 100)}%`,
                            background: 'linear-gradient(90deg, #4f8cff, #2dd4bf)',
                          }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card title="Centroid heatmap" sub="Mean feature value per archetype (raw units)">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ fontSize: 10.5 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 120 }}>Cluster</th>
                    {heatFeatures.map((f) => (
                      <th key={f} style={{ textAlign: 'center', fontSize: 8.5, padding: '6px 3px' }}>
                        {(labels[f] || f).split(' ')[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.clusters.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 2, background: c.color }} />
                          <span style={{ fontSize: 10.5 }}>{c.name}</span>
                        </div>
                      </td>
                      {heatFeatures.map((f) => (
                        <td key={f} style={{ padding: 2 }}>
                          <Heat value={c.centroid[f] || 0} max={heatMax(f)} color={c.color} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Rhythm layer" sub={`${data.rhythms.length} recurring daily shapes from a second KMeans`}>
            <div style={{ height: 200 }}>
              <ResponsiveContainer>
                <LineChart data={rhythmData} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid {...chartGrid} vertical={false} />
                  <XAxis dataKey="h" {...axis} interval={3} />
                  <YAxis {...axis} width={40} />
                  <Tooltip content={<TipBox formatter={(v) => num(v, 4)} />} />
                  {data.rhythms.map((r, i) => (
                    <Line key={r.name} type="monotone" dataKey={r.name} stroke={RHYTHM_COLORS[i % 4]}
                      strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="legend" style={{ marginTop: 8 }}>
              {data.rhythms.map((r, i) => (
                <span key={r.name} className="legend-item">
                  <span className="swatch" style={{ background: RHYTHM_COLORS[i % 4] }} />
                  {r.name} · {r.stops} stops
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Card title="Cluster integrity" sub="Dominant latent archetype recovered per cluster — labels were never used in fitting"
        style={{ marginTop: 14 }} pad={false}>
        <div className="table-wrap" style={{ maxHeight: 340 }}>
          <table className="table">
            <thead><tr><th>Cluster</th><th>Dominant truth</th><th className="r">Stops</th><th className="r">Share</th><th style={{ width: 160 }}>Purity</th><th className="r">Anomalies</th><th>Top zones</th></tr></thead>
            <tbody>
              {data.clusters.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 2, background: c.color }} />
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                    </div>
                  </td>
                  <td className="mono muted" style={{ fontSize: 10.5 }}>{c.dominant_archetype}</td>
                  <td className="r">{c.stops}</td>
                  <td className="r">{pct(c.share, 1)}</td>
                  <td>
                    <div className="row" style={{ gap: 7 }}>
                      <div className="grow"><MiniBar value={c.purity} max={1}
                        color={c.purity > 0.9 ? '#34d399' : c.purity > 0.7 ? '#f59e0b' : '#f43f5e'} /></div>
                      <span className="mono" style={{ fontSize: 10, width: 32 }}>{pct(c.purity, 0)}</span>
                    </div>
                  </td>
                  <td className="r">{c.anomalies}</td>
                  <td className="muted" style={{ fontSize: 10.5 }}>{c.top_zones.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <Card title="Reproducibility" sub="Everything needed to retrain identically">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
            {[
              ['Trained at', new Date(m.trained_at).toLocaleString('en-GB')],
              ['Random seed', '42'],
              ['Scaling', 'StandardScaler'],
              ['PCA components', m.pca_components],
              ['KMeans space', m.kmeans_space],
              ['DBSCAN space', m.dbscan_space],
            ].map(([a, b]) => (
              <div key={a} className="row between"><span className="muted">{a}</span><span className="mono" style={{ fontSize: 10.5 }}>{b}</span></div>
            ))}
          </div>
        </Card>
        <Card title="Evaluation set" sub="Held-out diagnostics">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 11.5 }}>
            {[
              ['Silhouette', num(m.silhouette, 4)],
              ['Calinski–Harabasz', num(m.calinski_harabasz, 1)],
              ['Davies–Bouldin', num(m.davies_bouldin, 4)],
              ['ARI (KMeans / Ward)', num(m.ari_kmeans_vs_ward, 4)],
              ['Label purity', pct(m.label_purity_mean)],
            ].map(([a, b]) => (
              <div key={a} className="row between"><span className="muted">{a}</span><span className="mono">{b}</span></div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
            <Tag tone="good">no labels used</Tag><Tag>k chosen by silhouette</Tag>
          </div>
        </Card>
        <Card title="What the model cannot do" sub="Honest limitations">
          <ul className="muted" style={{ fontSize: 11.5, lineHeight: 1.65, margin: 0, paddingLeft: 16 }}>
            <li>The feed is simulated, calibrated to plausible Bengaluru fleet volumes.</li>
            <li>KMeans assumes roughly spherical, similarly sized clusters.</li>
            <li>Archetype names are heuristic labels derived from centroids, not ground truth.</li>
            <li>HDBSCAN on stop-hour vectors is the natural next modelling step.</li>
          </ul>
        </Card>
      </div>
    </>
  )
}
