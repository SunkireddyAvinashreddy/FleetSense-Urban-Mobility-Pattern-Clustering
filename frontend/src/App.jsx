import React from 'react'
import { Icon } from './ui.jsx'
import { api, useAsync } from './api.js'
import Overview from './pages/Overview.jsx'
import MapView from './pages/MapView.jsx'
import RoutesPage from './pages/Routes.jsx'
import Clusters from './pages/Clusters.jsx'
import Live from './pages/Live.jsx'
import Anomalies from './pages/Anomalies.jsx'
import Model from './pages/Model.jsx'
import Predict from './pages/Predict.jsx'

const PAGES = {
  overview: { label: 'Overview', icon: 'grid', title: 'City mobility overview', sub: 'Every stop, route and footfall pattern the fleet sees — in one view', el: Overview, group: 'Analyse' },
  map: { label: 'Live Map', icon: 'map', title: 'Live fleet map', sub: 'Animated buses on the real network, streaming from the replay engine', el: MapView, group: 'Operate', badge: 'LIVE' },
  routes: { label: 'Routes', icon: 'route', title: 'Route network', sub: '24 corridors: geometry, demand curves, punctuality and live vehicles', el: RoutesPage, group: 'Operate' },
  fleet: { label: 'Fleet Live', icon: 'bus', title: 'Fleet control', sub: 'Every vehicle, occupancy, delay and camera detection in real time', el: Live, group: 'Operate' },
  clusters: { label: 'Clusters', icon: 'layers', title: 'Mobility archetypes', sub: 'What the unsupervised model discovered about how places behave', el: Clusters, group: 'Analyse' },
  anomalies: { label: 'Anomalies', icon: 'alert', title: 'Anomaly explorer', sub: 'DBSCAN spatial outliers and Isolation Forest stop-hour spikes', el: Anomalies, group: 'Analyse' },
  model: { label: 'Model', icon: 'cpu', title: 'Model diagnostics', sub: 'Features, k-selection, PCA, centroids and evaluation of the trained clusterer', el: Model, group: 'Model' },
  predict: { label: 'Scenario Lab', icon: 'spark', title: 'Scenario lab', sub: 'Design a stop profile and watch the trained model classify it live', el: Predict, group: 'Model' },
}

const NAV = [
  { group: 'Analyse', keys: ['overview', 'clusters', 'anomalies'] },
  { group: 'Operate', keys: ['map', 'routes', 'fleet'] },
  { group: 'Model', keys: ['model', 'predict'] },
]

const useHashRoute = () => {
  const read = () => (location.hash.replace('#', '') || 'map')
  const [route, setRoute] = React.useState(read)
  React.useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = (key) => { location.hash = key }
  return [PAGES[route] ? route : 'overview', go]
}

function Clock() {
  const [now, setNow] = React.useState(new Date())
  React.useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="clock">{now.toLocaleTimeString('en-GB')} IST</span>
}

export default function App() {
  const [route, go] = useHashRoute()
  const page = PAGES[route]
  const Page = page.el
  const modelInfo = useAsync(() => api.clusters(), [])

  return (
    <div className={`shell shell-${route}`}>
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="bolt" size={20} stroke={2} />
          </div>
          <div>
            <div className="brand-name">FleetSense</div>
            <div className="brand-sub">Mobility Intelligence</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="nav-label">{group.group}</div>
              {group.keys.map((key) => (
                <button key={key}
                  className={`nav-item ${route === key ? 'active' : ''}`}
                  onClick={() => go(key)} title={PAGES[key].label}>
                  <Icon name={PAGES[key].icon} size={16} />
                  <span>{PAGES[key].label}</span>
                  {PAGES[key].badge && <span className="nav-badge">{PAGES[key].badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail-foot">
          <div className="rail-status">
            <div className="row"><span>Model</span><b>k={modelInfo.data?.k ?? '—'} · KMeans</b></div>
            <div className="row"><span>Pipeline</span><b style={{ color: '#5eead4' }}>● healthy</b></div>
            <div className="row"><span>Stream</span><b>SSE · 1 Hz</b></div>
          </div>
          <div className="row" style={{ padding: '0 4px', fontSize: 10.5, color: '#4b5a72' }}>
            <span>Unsupervised · no labels</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="workspace-bar">
        </div>
        <header className="topbar">
          <div>
            <h1>{page.title}</h1>
            <div className="sub">{page.sub}</div>
          </div>
          <div className="topbar-right">
            <span className="live-pill"><span className="dot" /> Live</span>
            <Clock />
            <a className="btn ghost" href="/docs" target="_blank" rel="noreferrer">
              <Icon name="cpu" size={14} /> API
            </a>
          </div>
        </header>

        <div className="content">
          <Page go={go} />
        </div>
      </main>
    </div>
  )
}
