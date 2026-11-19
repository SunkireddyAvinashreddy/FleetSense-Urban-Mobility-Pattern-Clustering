import React from 'react'

const BASE = import.meta.env.VITE_API ?? ''

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`)
  return res.json()
}

export const api = {
  overview: () => req('/api/overview'),
  stops: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString()
    return req(`/api/stops${qs ? `?${qs}` : ''}`)
  },
  stop: (id) => req(`/api/stops/${encodeURIComponent(id)}`),
  clusters: () => req('/api/clusters'),
  scatter: () => req('/api/scatter'),
  metrics: () => req('/api/metrics'),
  model: () => req('/api/model'),
  anomalies: () => req('/api/anomalies'),
  heatmap: () => req('/api/heatmap'),
  routes: () => req('/api/routes'),
  route: (id) => req(`/api/routes/${encodeURIComponent(id)}`),
  network: () => req('/api/network'),
  rhythms: () => req('/api/rhythms'),
  live: () => req('/api/live'),
  predict: (body) => req('/api/predict', { method: 'POST', body: JSON.stringify(body) }),
}

export function useAsync(fn, deps = []) {
  const [state, setState] = React.useState({ loading: true, data: null, error: null })
  const fnRef = React.useRef(fn)
  fnRef.current = fn

  React.useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    fnRef.current()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: null, error }))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return state
}

/**
 * Server-Sent Events subscription with automatic reconnection.
 * With ?snapshot=1 in the URL it fetches a single frame instead, which keeps
 * deterministic renders (screenshots, kiosk displays) free of an open stream.
 */
export function useStream(path, onMessage) {
  const [status, setStatus] = React.useState('connecting')
  const handler = React.useRef(onMessage)
  handler.current = onMessage
  const snapshot = typeof location !== 'undefined' && new URLSearchParams(location.search).has('snapshot')

  React.useEffect(() => {
    if (snapshot) {
      let alive = true
      fetch(BASE + path.replace('/stream', ''))
        .then((r) => r.json())
        .then((d) => { if (alive) { handler.current(d); setStatus('snapshot') } })
        .catch(() => alive && setStatus('offline'))
      return () => { alive = false }
    }

    let es = null
    let retry = null
    let closed = false

    const connect = () => {
      es = new EventSource(BASE + path)
      es.onopen = () => setStatus('live')
      es.onerror = () => {
        setStatus('reconnecting')
        es.close()
        if (!closed) retry = setTimeout(connect, 1500)
      }
      es.onmessage = (ev) => {
        try { handler.current(JSON.parse(ev.data)) } catch { /* ignore bad frame */ }
      }
    }
    connect()

    return () => {
      closed = true
      clearTimeout(retry)
      if (es) es.close()
    }
  }, [path, snapshot])

  return status
}
