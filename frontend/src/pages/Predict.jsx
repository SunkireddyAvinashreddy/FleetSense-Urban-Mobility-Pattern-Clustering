import React from 'react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, useAsync } from '../api.js'
import {
  Bar as MiniBar, Card, ErrorBox, Gauge, Icon, Loading, Tag, TipBox, axis,
  chartGrid, compact, hourLabel, num,
} from '../ui.jsx'

const SLIDERS = [
  ['log_footfall', 'Footfall volume (log)', 5.5, 11, 0.05],
  ['morning_share', 'Morning share', 0, 0.8, 0.005],
  ['midday_share', 'Midday share', 0, 0.7, 0.005],
  ['evening_share', 'Evening share', 0, 0.8, 0.005],
  ['night_share', 'Night share', 0, 0.45, 0.005],
  ['peak_to_base', 'Peak sharpness', 1, 12, 0.1],
  ['dwell_mean_s', 'Mean dwell (s)', 8, 80, 0.5],
  ['speed_mean_kmh', 'Approach speed (km/h)', 6, 45, 0.5],
  ['weekend_ratio', 'Weekend ratio', 0, 2.2, 0.01],
  ['ped_to_rider_ratio', 'Pedestrians per rider', 0, 6, 0.05],
  ['routes_served', 'Routes served', 1, 12, 1],
  ['occupancy_mean', 'Mean occupancy', 0, 65, 0.5],
]

const PRESETS = {
  'Residential feeder': { morning_share: 0.38, midday_share: 0.18, evening_share: 0.34, night_share: 0.07, dwell_mean_s: 20, speed_mean_kmh: 22, weekend_ratio: 0.9, ped_to_rider_ratio: 0.8, routes_served: 3, occupancy_mean: 35, log_footfall: 7.6, peak_to_base: 6 },
  'CBD interchange': { morning_share: 0.36, midday_share: 0.2, evening_share: 0.36, night_share: 0.08, dwell_mean_s: 24, speed_mean_kmh: 15, weekend_ratio: 0.55, ped_to_rider_ratio: 2.2, routes_served: 9, occupancy_mean: 46, log_footfall: 8.4, peak_to_base: 4 },
  'Evening / nightlife': { morning_share: 0.12, midday_share: 0.18, evening_share: 0.4, night_share: 0.3, dwell_mean_s: 28, speed_mean_kmh: 17, weekend_ratio: 1.5, ped_to_rider_ratio: 2.4, routes_served: 5, occupancy_mean: 40, log_footfall: 7.9, peak_to_base: 5 },
  'Airport gateway': { morning_share: 0.3, midday_share: 0.2, evening_share: 0.25, night_share: 0.25, dwell_mean_s: 14, speed_mean_kmh: 38, weekend_ratio: 1.1, ped_to_rider_ratio: 0.6, routes_served: 4, occupancy_mean: 55, log_footfall: 7.7, peak_to_base: 3 },
  'Market / retail': { morning_share: 0.12, midday_share: 0.45, evening_share: 0.35, night_share: 0.08, dwell_mean_s: 46, speed_mean_kmh: 12, weekend_ratio: 1.25, ped_to_rider_ratio: 3, routes_served: 6, occupancy_mean: 30, log_footfall: 8.2, peak_to_base: 3 },
}

export default function Predict() {
  const modelQ = useAsync(() => api.model(), [])
  const [vals, setVals] = React.useState(null)
  const [res, setRes] = React.useState(null)
  const [err, setErr] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const seq = React.useRef(0)

  React.useEffect(() => {
    if (!modelQ.data) return
    setVals(modelQ.data.meta.medians)
  }, [modelQ.data])

  React.useEffect(() => {
    if (!vals) return
    const t = setTimeout(() => {
      const id = ++seq.current
      setBusy(true)
      api.predict(vals)
        .then((r) => { if (id === seq.current) { setRes(r); setErr(null) } })
        .catch((e) => { if (id === seq.current) setErr(e) })
        .finally(() => { if (id === seq.current) setBusy(false) })
    }, 320)
    return () => clearTimeout(t)
  }, [vals])

  if (modelQ.loading) return <Loading height={460} label="Loading inference pipeline" />
  if (modelQ.error) return <ErrorBox error={modelQ.error} />

  const labels = modelQ.data.meta.feature_labels || {}
  const curve = (res?.curve_abs || []).map((v, h) => ({ h: hourLabel(h), demand: v }))
  const maxProb = Math.max(...(res?.probabilities || [{ p: 1 }]).map((p) => p.p))

  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }))
  const applyPreset = (name) => setVals((s) => ({ ...s, ...PRESETS[name] }))

  return (
    <>
      <div className="grid g4">
        <div className="stat"><div className="label">Inference source</div><div className="value" style={{ fontSize: 17 }}>kmeans.pkl</div><div className="foot">31-feature scaler + PCA → KMeans</div></div>
        <div className="stat"><div className="label">Live inference</div><div className="value num">{busy ? '…' : res ? num(res.confidence * 100, 1) : '—'}<small>%</small></div><div className="foot">confidence of the top cluster</div></div>
        <div className="stat"><div className="label">Predicted archetype</div><div className="value" style={{ fontSize: 15, color: res?.color }}>{res?.name || '—'}</div><div className="foot">cluster C{res?.cluster ?? '—'}</div></div>
        <div className="stat"><div className="label">Anomaly score</div><div className="value num">{res ? num(res.anomaly_score, 1) : '—'}</div><div className="foot">Isolation Forest, 50 = typical</div></div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <Card title="Design a stop profile" sub="Drag any lever — the trained model re-scores instantly"
          actions={<Tag tone="info">{busy ? 'scoring…' : 'live'}</Tag>}>
          <div className="row wrap" style={{ gap: 7, marginBottom: 14 }}>
            {Object.keys(PRESETS).map((p) => (
              <button key={p} className="chip" onClick={() => applyPreset(p)}>{p}</button>
            ))}
            <button className="chip" onClick={() => setVals(modelQ.data.meta.medians)}>Reset to medians</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 22px' }}>
            {SLIDERS.map(([key, label, lo, hi, step]) => {
              const v = vals?.[key] ?? lo
              return (
                <div key={key}>
                  <div className="row between" style={{ marginBottom: 3 }}>
                    <span style={{ fontSize: 11, color: '#93a4c1' }}>{labels[key] || label}</span>
                    <span className="mono" style={{ fontSize: 11, color: '#e9effb' }}>
                      {key === 'routes_served' || key === 'log_footfall' || key === 'dwell_mean_s'
                        ? num(v, key === 'log_footfall' ? 2 : 0) : num(v, 2)}
                    </span>
                  </div>
                  <input type="range" min={lo} max={hi} step={step} value={v}
                    onChange={(e) => set(key, Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#4f8cff' }} />
                </div>
              )
            })}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {err && <ErrorBox error={err} />}
          {res && (
            <>
              <Card title="Prediction" sub={`Nearest learned archetype for this profile`}>
                <div className="row" style={{ gap: 18, alignItems: 'center' }}>
                  <Gauge value={res.confidence * 100} color={res.color} size={112}
                    label={`${num(res.confidence * 100, 1)}%`} sub="confidence" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 750, color: res.color, letterSpacing: '-.4px' }}>{res.name}</div>
                    <div className="dim" style={{ fontSize: 11.5, marginTop: 3 }}>Cluster C{res.cluster} · {res.cluster_profile?.stops ?? '—'} stops in training</div>
                    <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <Tag tone="info">{num(res.cluster_profile?.avg_dwell_s, 1)}s dwell</Tag>
                      <Tag>{num(res.cluster_profile?.avg_routes, 1)} routes</Tag>
                      <Tag>{res.cluster_profile?.weekend_ratio}× weekend</Tag>
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {res.probabilities.map((p) => (
                    <div key={p.cluster}>
                      <div className="row between" style={{ fontSize: 10.5, marginBottom: 3 }}>
                        <span className="row" style={{ gap: 6 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 2, background: p.color }} />
                          <span style={{ color: p.cluster === res.cluster ? '#e9effb' : '#93a4c1' }}>{p.name}</span>
                        </span>
                        <span className="mono">{num(p.p * 100, 1)}%</span>
                      </div>
                      <MiniBar value={p.p} max={Math.max(maxProb, 0.001)} color={p.color} height={5} />
                    </div>
                  ))}
                </div>
              </Card>

              <Card title="Expected daily curve" sub="Mean weekday demand profile of the matched archetype">
                <div style={{ height: 170 }}>
                  <ResponsiveContainer>
                    <AreaChart data={curve} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pr-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={res.color} stopOpacity={0.5} />
                          <stop offset="100%" stopColor={res.color} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...chartGrid} vertical={false} />
                      <XAxis dataKey="h" {...axis} interval={3} />
                      <YAxis {...axis} width={38} tickFormatter={compact} />
                      <Tooltip content={<TipBox formatter={(v) => num(v, 1)} />} />
                      <Area type="monotone" dataKey="demand" name="Demand" stroke={res.color}
                        strokeWidth={2.2} fill="url(#pr-grad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card title="Closest real stops" sub="Nearest training examples in feature space">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {res.nearest_stops.map((s) => (
                    <div key={s.stop_id} className="row" style={{ fontSize: 11.5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: s.cluster_color }} />
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{s.stop_name}</div>
                        <div className="dim" style={{ fontSize: 10 }}>{s.zone} · {s.cluster_name}</div>
                      </div>
                      <span className="mono dim" style={{ fontSize: 10 }}>{num(s.d, 2)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 14 }}>
        <Card title="How inference works" pad={false}>
          <div style={{ padding: '2px 18px 16px' }}>
            <ol className="muted" style={{ fontSize: 11.5, lineHeight: 1.7, paddingLeft: 16, margin: 0 }}>
              <li>Your 12 inputs are merged with the training medians for the other 19 features.</li>
              <li>The stored <b>StandardScaler</b> standardises all 31 features.</li>
              <li>The stored <b>PCA</b> projects them onto the first 6 principal components.</li>
              <li>The stored <b>KMeans</b> assigns the nearest centroid; distances become the confidence bars.</li>
            </ol>
          </div>
        </Card>
        <Card title="Why this is genuinely unsupervised">
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.65, marginTop: 0 }}>
            No stop ever carried a label during training. The archetype names shown are generated
            afterwards from the cluster centroids by a rule set, purely so the clusters are readable
            to a human. The model itself only knows geometry in feature space.
          </p>
        </Card>
        <Card title="Try the edge cases">
          <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.65, marginTop: 0 }}>
            Set footfall low, routes to 1 and speed high to find the peripheral cluster. Push night
            share and weekend ratio up to reach the evening economy archetype. Watch the confidence
            drop when a profile sits between two archetypes — that is the model being honest.
          </p>
          <div className="row" style={{ marginTop: 8 }}>
            <Tag tone="warn">confidence = softmax over centroid distances</Tag>
          </div>
        </Card>
      </div>
    </>
  )
}
