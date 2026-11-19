"""
FleetSense API (v2).

Serves the trained unsupervised models, the processed panels, the route network
geometry, a smoothly interpolated live fleet replay and real-time inference.
"""

from __future__ import annotations

import asyncio
import json
import os
import pickle
import random
import time
from contextlib import asynccontextmanager
from datetime import datetime

import numpy as np
import pandas as pd
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "data", "artifacts")
PROC = os.path.join(ROOT, "data", "processed")
RAW = os.path.join(ROOT, "data", "raw")
MODELS = os.path.join(ROOT, "models")
DIST = os.path.join(ROOT, "frontend", "dist")

ROUTE_COLORS = [
    "#4f8cff", "#2dd4bf", "#f59e0b", "#a78bfa", "#f472b6", "#38bdf8",
    "#84cc16", "#fb923c", "#818cf8", "#f43f5e", "#14b8a6", "#eab308",
    "#c084fc", "#06b6d4", "#f97316", "#8b5cf6", "#22d3ee", "#facc15",
]


def _load_json(name: str):
    with open(os.path.join(ART, name)) as fh:
        return json.load(fh)


class State:
    stops = None
    summary = None
    summary_by_id = {}
    metrics = None
    meta = None
    rhythms = {}
    panel = None
    profiles = None
    daily = None
    heat = None
    routes = None
    route_geo = {}
    route_stop_rows = {}
    route_stats = {}
    route_hourly = {}
    zones = []
    top_stops = []
    kpis = {}
    hourly = []
    gps = None
    anomalies = None
    hourly_anomalies = None
    models = {}
    sim = None


S = State()


class LiveSim:
    """Replays the recorded GPS trail with interpolation between pings.

    A virtual clock advances `RATE` simulated seconds per real second, so every
    bus glides continuously along its route instead of jumping between samples.
    """

    RATE = 14.0          # simulated seconds per real second
    MAX_BUSES = 340

    def __init__(self, gps: pd.DataFrame, stops: pd.DataFrame, routes: pd.DataFrame):
        self.stop_meta = stops.set_index("stop_id")[
            ["stop_name", "zone", "cluster", "cluster_name", "cluster_color"]
        ].to_dict("index")
        self.route_meta = routes.set_index("route_id").to_dict("index")
        self.tracks = {}

        gps = gps.sort_values(["bus_id", "timestamp"])
        for bus_id, g in gps.groupby("bus_id", sort=False):
            if len(g) < 4:
                continue
            ts = pd.to_datetime(g["timestamp"]).astype("int64").to_numpy() / 1e9
            self.tracks[bus_id] = {
                "route_id": str(g["route_id"].iloc[0]),
                "t": ts,
                "lat": g["lat"].to_numpy(dtype=float),
                "lon": g["lon"].to_numpy(dtype=float),
                "speed": g["speed_kmh"].to_numpy(dtype=float),
                "heading": g["heading_deg"].to_numpy(dtype=float),
                "next": g["next_stop_id"].to_numpy(),
                "occ": g["occupancy_pct"].to_numpy(dtype=float),
                "delay": g["delay_s"].to_numpy(dtype=float),
                "cap": int(random.Random(bus_id).choice([45, 52, 60, 70])),
            }
        all_t = np.concatenate([tr["t"] for tr in self.tracks.values()]) if self.tracks else np.array([0.0])
        self.tmin = float(all_t.min())
        self.tmax = float(all_t.max())
        self.span = max(self.tmax - self.tmin, 1.0)
        self.started = time.time()

    def _clock(self) -> float:
        return self.tmin + ((time.time() - self.started) * self.RATE) % self.span

    def snapshot(self):
        now = self._clock()
        buses = []
        for bus_id, tr in self.tracks.items():
            t = tr["t"]
            if now < t[0] or now > t[-1]:
                continue
            i = int(np.searchsorted(t, now))
            if i <= 0:
                continue
            i = min(i, len(t) - 1)
            t0, t1 = t[i - 1], t[i]
            f = 0.0 if t1 <= t0 else (now - t0) / (t1 - t0)
            lat = tr["lat"][i - 1] + (tr["lat"][i] - tr["lat"][i - 1]) * f
            lon = tr["lon"][i - 1] + (tr["lon"][i] - tr["lon"][i - 1]) * f
            nxt = str(tr["next"][i - 1])
            meta = self.stop_meta.get(nxt, {})
            route = tr["route_id"]
            buses.append({
                "bus_id": bus_id,
                "route_id": route,
                "route_name": str(self.route_meta.get(route, {}).get("route_name", route)),
                "lat": round(float(lat), 6),
                "lon": round(float(lon), 6),
                "speed_kmh": round(float(tr["speed"][i - 1]), 1),
                "heading_deg": int(tr["heading"][i - 1]),
                "occupancy_pct": int(round(float(tr["occ"][i - 1]))),
                "capacity": tr["cap"],
                "delay_s": int(tr["delay"][i - 1]),
                "next_stop_id": nxt,
                "next_stop": meta.get("stop_name", nxt),
                "zone": meta.get("zone", "—"),
                "cluster": int(meta.get("cluster", 0)),
                "cluster_name": meta.get("cluster_name", ""),
                "cluster_color": meta.get("cluster_color", "#5b8cff"),
                "on_time": bool(abs(float(tr["delay"][i - 1])) <= 120),
            })
        buses.sort(key=lambda b: b["bus_id"])
        buses = buses[: self.MAX_BUSES]

        by_route = {}
        for b in buses:
            r = by_route.setdefault(b["route_id"], {"route_id": b["route_id"],
                                                    "route_name": b["route_name"],
                                                    "buses": 0, "speed": 0.0,
                                                    "occupancy": 0, "late": 0})
            r["buses"] += 1
            r["speed"] += b["speed_kmh"]
            r["occupancy"] += b["occupancy_pct"]
            r["late"] += 0 if b["on_time"] else 1
        for r in by_route.values():
            n = max(r["buses"], 1)
            r["speed"] = round(r["speed"] / n, 1)
            r["occupancy"] = round(r["occupancy"] / n)
            r["on_time_pct"] = round(100 * (1 - r["late"] / n), 1)

        hour = datetime.fromtimestamp(now).hour
        dets = []
        if S.panel is not None:
            sub = S.panel[(S.panel["hour"] == hour) & (S.panel["pedestrians"] > 0)]
            if len(sub):
                pick = sub.sample(min(10, len(sub)), random_state=int(now) % 99991)
                for _, row in pick.iterrows():
                    meta = self.stop_meta.get(row["stop_id"], {})
                    dets.append({
                        "stop_id": row["stop_id"],
                        "stop_name": meta.get("stop_name", row["stop_id"]),
                        "zone": meta.get("zone", "—"),
                        "lat": round(float(S.stops.set_index("stop_id").loc[row["stop_id"], "lat"]), 6),
                        "lon": round(float(S.stops.set_index("stop_id").loc[row["stop_id"], "lon"]), 6),
                        "riders": int(row["riders"]),
                        "pedestrians": int(row["pedestrians"]),
                        "two_wheelers": int(row["two_wheelers"]),
                        "cluster": int(meta.get("cluster", 0)),
                        "cluster_color": meta.get("cluster_color", "#5b8cff"),
                    })

        active = len(buses)
        return {
            "server_time": datetime.now().isoformat(timespec="seconds"),
            "sim_time": datetime.fromtimestamp(now).isoformat(timespec="seconds"),
            "sim_hour": hour,
            "active_buses": active,
            "avg_speed": round(float(np.mean([b["speed_kmh"] for b in buses])), 1) if buses else 0,
            "avg_occupancy": round(float(np.mean([b["occupancy_pct"] for b in buses]))) if buses else 0,
            "on_time_pct": round(100 * np.mean([b["on_time"] for b in buses]), 1) if buses else 0,
            "passengers": int(sum(b["occupancy_pct"] * b["capacity"] / 100 for b in buses)),
            "buses": buses,
            "routes": sorted(by_route.values(), key=lambda r: r["route_id"]),
            "detections": dets,
        }


def _route_geometry(route_stops: pd.DataFrame, stops: pd.DataFrame):
    geo, rows = {}, {}
    for rid, g in route_stops.sort_values("stop_seq").groupby("route_id"):
        g = g.merge(stops[["stop_id", "stop_name", "lat", "lon", "cluster",
                           "cluster_name", "cluster_color"]], on="stop_id", how="left")
        geo[rid] = [[round(float(r["lat"]), 6), round(float(r["lon"]), 6)]
                    for _, r in g.iterrows()]
        rows[rid] = [{
            "stop_id": r["stop_id"], "stop_name": r["stop_name"],
            "seq": int(r["stop_seq"]), "lat": round(float(r["lat"]), 6),
            "lon": round(float(r["lon"]), 6), "cluster": int(r["cluster"]),
            "cluster_name": r["cluster_name"], "cluster_color": r["cluster_color"],
        } for _, r in g.iterrows()]
    return geo, rows


def load_state():
    S.stops = pd.read_csv(os.path.join(ART, "stop_clusters.csv"))
    S.metrics = _load_json("model_metrics.json")
    summary = _load_json("cluster_summary.json")
    S.summary = summary["clusters"]
    S.summary_by_id = {c["id"]: c for c in S.summary}
    S.rhythms = summary.get("rhythms", {})

    S.panel = pd.read_csv(
        os.path.join(ROOT, "dataset.csv"), parse_dates=["date"],
        usecols=["stop_id", "date", "hour", "riders", "pedestrians", "two_wheelers",
                 "vehicles_stopped", "crowd_density_index", "camera_confidence",
                 "visits", "boardings", "alightings", "dwell_mean", "occupancy_mean", "speed_mean",
                 "delay_mean", "is_weekend"])
    S.panel = S.panel.merge(S.stops[["stop_id", "cluster", "zone"]], on="stop_id", how="left")
    S.profiles = pd.read_csv(os.path.join(ART, "rhythm_profiles.csv"))
    S.routes = pd.read_csv(os.path.join(RAW, "routes.csv"))
    route_stops = pd.read_csv(os.path.join(RAW, "route_stops.csv"))
    S.route_geo, S.route_stop_rows = _route_geometry(route_stops, S.stops)
    S.gps = pd.read_csv(
        os.path.join(RAW, "gps_pings.csv"),
        usecols=["bus_id", "route_id", "timestamp", "lat", "lon", "speed_kmh",
                 "heading_deg", "next_stop_id", "occupancy_pct", "delay_s"])
    S.hourly_anomalies = pd.read_csv(os.path.join(ART, "hourly_anomalies.csv"))

    S.daily = (S.panel.groupby("date")
               .agg(riders=("riders", "sum"), peds=("pedestrians", "sum"),
                    visits=("visits", "sum"))
               .reset_index())
    S.daily["date"] = S.daily["date"].dt.strftime("%Y-%m-%d")
    S.daily["demand"] = (S.daily["riders"] + 0.35 * S.daily["peds"]).round(0)

    demand = S.panel["riders"] + 0.35 * S.panel["pedestrians"]
    S.hourly = (S.panel.assign(demand=demand)
                .groupby("hour")["demand"].mean().reindex(range(24)).fillna(0)
                .round(1).tolist())

    wk = S.panel[~S.panel["is_weekend"]].assign(
        demand=S.panel[~S.panel["is_weekend"]]["riders"] +
        0.35 * S.panel[~S.panel["is_weekend"]]["pedestrians"])
    S.heat = (wk.groupby(["cluster", "hour"])["demand"].mean()
              .unstack(fill_value=0).reindex(columns=range(24)))

    # ---- route analytics -------------------------------------------------
    stop_routes = route_stops.groupby("stop_id")["route_id"].apply(list).to_dict()
    n_routes = {k: len(v) for k, v in stop_routes.items()}
    route_panel = S.panel.copy()
    route_panel["n_routes"] = route_panel["stop_id"].map(n_routes).fillna(1)
    route_panel = route_panel.merge(route_stops[["route_id", "stop_id"]],
                                    on="stop_id", how="inner")
    route_panel["demand"] = (route_panel["riders"] + 0.35 * route_panel["pedestrians"]) / route_panel["n_routes"]
    wk_rp = route_panel[~route_panel["is_weekend"]]
    hours = wk_rp.groupby(["route_id", "hour"])["demand"].mean().unstack(fill_value=0)
    n_days = max(S.panel["date"].dt.date.nunique(), 1)
    buses_per_route = S.gps.groupby("route_id")["bus_id"].nunique().to_dict()

    for idx, r in S.routes.iterrows():
        rid = r["route_id"]
        h = hours.loc[rid].reindex(range(24)).fillna(0) if rid in hours.index else pd.Series(0, index=range(24))
        S.route_hourly[rid] = [round(float(v), 1) for v in h]
        riders_day = float(wk_rp[wk_rp["route_id"] == rid]["riders"].sum() / max(
            wk_rp[wk_rp["route_id"] == rid]["date"].dt.date.nunique(), 1))
        sub = S.panel[S.panel["stop_id"].isin(route_stops[route_stops["route_id"] == rid]["stop_id"])]
        wk_sub = sub[~sub["is_weekend"] & (sub["visits"] > 0)]
        S.route_stats[rid] = {
            "route_id": rid,
            "route_name": r["route_name"],
            "origin": r["origin"],
            "destination": r["destination"],
            "n_stops": int(r["n_stops"]),
            "length_km": float(r["length_km"]),
            "headway_min": int(r["headway_min"]),
            "service_start": r["service_start"],
            "service_end": r["service_end"],
            "color": ROUTE_COLORS[idx % len(ROUTE_COLORS)],
            "buses": int(buses_per_route.get(rid, 0)),
            "riders_day": round(riders_day),
            "avg_speed": round(float(wk_sub["speed_mean"].mean()) if len(wk_sub) else 0, 1),
            "avg_dwell": round(float(wk_sub["dwell_mean"].mean()) if len(wk_sub) else 0, 1),
            "on_time_pct": round(float(100 * (wk_sub["delay_mean"].abs() <= 120).mean())
                                 if len(wk_sub) else 0, 1),
            "peak_hour": int(np.argmax(S.route_hourly[rid])) if any(S.route_hourly[rid]) else 0,
            "geometry": S.route_geo.get(rid, []),
            "stops": S.route_stop_rows.get(rid, []),
            "hourly": S.route_hourly[rid],
        }

    # ---- zone roll-up ----------------------------------------------------
    zone_agg = (S.stops.groupby("zone")
                .agg(stops=("stop_id", "count"), lat=("lat", "mean"),
                     lon=("lon", "mean"), footfall=("footfall_total", "mean"),
                     riders=("riders_day", "sum"), peds=("peds_day", "sum"),
                     dwell=("dwell_mean_s", "mean"), speed=("speed_mean_kmh", "mean"),
                     routes=("routes_served", "sum"))
                .reset_index())
    S.zones = [{
        "zone": z["zone"], "stops": int(z["stops"]),
        "lat": round(float(z["lat"]), 5), "lon": round(float(z["lon"]), 5),
        "footfall": round(float(z["footfall"])),
        "riders": round(float(z["riders"]), 1), "peds": round(float(z["peds"]), 1),
        "dwell": round(float(z["dwell"]), 1), "speed": round(float(z["speed"]), 1),
        "routes": int(z["routes"]),
    } for _, z in zone_agg.iterrows()]

    top = S.stops.nlargest(10, "footfall_total")
    S.top_stops = [{
        "stop_id": t["stop_id"], "stop_name": t["stop_name"], "zone": t["zone"],
        "cluster": int(t["cluster"]), "cluster_name": t["cluster_name"],
        "cluster_color": t["cluster_color"],
        "footfall": round(float(t["footfall_total"])),
        "riders": round(float(t["riders_day"])),
        "peds": round(float(t["peds_day"])),
        "dwell": round(float(t["dwell_mean_s"]), 1),
        "routes": int(t["routes_served"]),
        "anomaly": round(float(t["anomaly_score"]), 2),
    } for _, t in top.iterrows()]

    wk_all = S.panel[~S.panel["is_weekend"]]
    visited = wk_all[wk_all["visits"] > 0]
    S.kpis = {
        "stops": int(len(S.stops)),
        "clusters": int(S.metrics["chosen_k"]),
        "vehicles": int(S.gps["bus_id"].nunique()),
        "routes": int(len(S.routes)),
        "daily_riders": round(float(wk_all["riders"].sum() / n_days)),
        "daily_pedestrians": round(float(wk_all["pedestrians"].sum() / n_days)),
        "daily_boardings": round(float(wk_all["boardings"].sum() / n_days)),
        "daily_visits": round(float(wk_all["visits"].sum() / n_days)),
        "avg_dwell_s": round(float(visited["dwell_mean"].mean()), 1),
        "avg_speed": round(float(visited["speed_mean"].mean()), 1),
        "avg_occupancy": round(float(visited["occupancy_mean"].mean()), 1),
        "avg_vehicles_stopped": round(float(wk_all["vehicles_stopped"].mean()), 1),
        "avg_crowd_density": round(float(wk_all["crowd_density_index"].mean()), 3),
        "avg_camera_confidence": round(float(wk_all["camera_confidence"].mean()) * 100, 1),
        "on_time_pct": round(float(100 * (visited["delay_mean"].abs() <= 120).mean()), 1),
        "silhouette": S.metrics["silhouette"],
        "anomaly_stops": int(S.stops["outlier"].sum()),
        "purity": S.metrics["label_purity_mean"],
        "data_points": int(len(S.panel)),
        "features": int(S.metrics["n_features"]),
    }

    with open(os.path.join(MODELS, "metadata.json")) as fh:
        S.meta = json.load(fh)
    for fn in ["scaler", "pca", "pca2", "kmeans", "iso", "ward", "rhythm_kmeans"]:
        with open(os.path.join(MODELS, f"{fn}.pkl"), "rb") as fh:
            S.models[fn] = pickle.load(fh)

    S.sim = LiveSim(S.gps, S.stops, S.routes)
    print(f"[fleet-sense] {len(S.stops)} stops | k={S.metrics['chosen_k']} | "
          f"{len(S.gps):,} gps pings | {len(S.panel):,} panel rows | "
          f"{len(S.routes)} routes | {S.kpis['vehicles']} buses")


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_state()
    yield


app = FastAPI(title="FleetSense API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


def records(df: pd.DataFrame):
    return json.loads(df.to_json(orient="records"))


# ---------------------------------------------------------------- core ----
@app.get("/api/health")
def health():
    ready = S.stops is not None
    return {"status": "ok" if ready else "loading",
            "stops": int(len(S.stops)) if ready else 0,
            "version": "2.0.0"}


@app.get("/api/overview")
def overview():
    top = max(S.summary, key=lambda c: c["stops"])
    return {
        "kpis": S.kpis,
        "window": {
            "start": str(S.panel["date"].min().date()),
            "end": str(S.panel["date"].max().date()),
            "days": int(S.panel["date"].dt.date.nunique()),
        },
        "top_cluster": top,
        "daily": records(S.daily),
        "hourly": S.hourly,
        "clusters": S.summary,
        "rhythms": list(S.rhythms.values()),
        "top_stops": S.top_stops,
        "zones": S.zones,
        "routes": [S.route_stats[r] for r in S.route_stats],
    }


@app.get("/api/stops")
def stops(cluster: int | None = None, zone: str | None = None,
          q: str | None = None, anomaly: bool = False,
          limit: int = Query(5000, le=5000)):
    df = S.stops
    if cluster is not None:
        df = df[df["cluster"] == cluster]
    if zone:
        df = df[df["zone"] == zone]
    if q:
        m = (df["stop_name"].str.contains(q, case=False, na=False)
             | df["stop_id"].str.contains(q, case=False, na=False)
             | df["zone"].str.contains(q, case=False, na=False))
        df = df[m]
    if anomaly:
        df = df[df["outlier"] | (df["anomaly_score"] > 0.75)]
    cols = ["stop_id", "stop_name", "zone", "lat", "lon", "cluster", "cluster_name",
            "cluster_color", "rhythm_name", "footfall_total", "riders_day", "peds_day",
            "dwell_mean_s", "speed_mean_kmh", "routes_served", "anomaly_score",
            "outlier", "pca_x", "pca_y"]
    return {"count": int(len(df)), "stops": records(df[cols].head(limit))}


@app.get("/api/stops/{stop_id}")
def stop_detail(stop_id: str):
    row = S.stops[S.stops["stop_id"] == stop_id]
    if row.empty:
        raise HTTPException(404, "unknown stop")
    r = row.iloc[0]
    sub = S.panel[S.panel["stop_id"] == stop_id]
    wk = sub[~sub["is_weekend"]].groupby("hour").agg(
        riders=("riders", "mean"), peds=("pedestrians", "mean"),
        dwell=("dwell_mean", "mean"), occupancy=("occupancy_mean", "mean"),
        speed=("speed_mean", "mean"), visits=("visits", "mean"),
    ).reindex(range(24)).fillna(0)
    we = sub[sub["is_weekend"]].groupby("hour").agg(
        riders=("riders", "mean"), peds=("pedestrians", "mean"),
    ).reindex(range(24)).fillna(0)

    by_day = (sub.assign(dow=sub["date"].dt.dayofweek)
              .groupby("dow").agg(riders=("riders", "mean"),
                                  peds=("pedestrians", "mean")).reindex(range(7)).fillna(0))

    nearby = S.stops[S.stops["stop_id"] != stop_id].copy()
    nearby["d"] = (((nearby["lat"] - r["lat"]) * 111) ** 2 +
                   ((nearby["lon"] - r["lon"]) * 111 * np.cos(np.radians(r["lat"]))) ** 2) ** .5
    nearby = nearby.nsmallest(5, "d")

    routes_here = [rid for rid, stops in S.route_stop_rows.items()
                   if any(s["stop_id"] == stop_id for s in stops)]
    summary = S.summary_by_id.get(int(r["cluster"]), {})

    return {
        "stop": records(row)[0],
        "cluster": summary,
        "profile": {
            "hours": list(range(24)),
            "riders": [round(float(v), 2) for v in wk["riders"]],
            "pedestrians": [round(float(v), 2) for v in wk["peds"]],
            "dwell": [round(float(v), 1) for v in wk["dwell"]],
            "occupancy": [round(float(v), 1) for v in wk["occupancy"]],
            "speed": [round(float(v), 1) for v in wk["speed"]],
            "visits": [round(float(v), 2) for v in wk["visits"]],
            "weekend_riders": [round(float(v), 2) for v in we["riders"]],
            "weekend_peds": [round(float(v), 2) for v in we["peds"]],
        },
        "week": [{"dow": d, "riders": round(float(by_day.loc[d, "riders"]), 1),
                  "peds": round(float(by_day.loc[d, "peds"]), 1)} for d in range(7)],
        "peak_hours": [int(h) for h in wk["riders"].sort_values(ascending=False).head(3).index],
        "nearby": records(nearby[["stop_id", "stop_name", "zone", "cluster",
                                  "cluster_name", "cluster_color", "footfall_total", "d"]].head(5)),
        "routes": [S.route_stats[r] for r in routes_here if r in S.route_stats],
    }


@app.get("/api/clusters")
def clusters():
    return {"clusters": S.summary, "k": S.metrics["chosen_k"],
            "silhouette": S.metrics["silhouette"],
            "ari": S.metrics["ari_kmeans_vs_ward"]}


@app.get("/api/scatter")
def scatter():
    df = S.stops[["stop_id", "stop_name", "zone", "cluster", "cluster_name",
                  "cluster_color", "pca_x", "pca_y", "anomaly_score", "outlier",
                  "footfall_total", "riders_day"]]
    return {"points": records(df),
            "variance_explained": S.metrics["pca2d_variance_explained"]}


@app.get("/api/metrics")
def metrics():
    m = dict(S.metrics)
    confusion = []
    for c in sorted(S.stops["cluster"].unique()):
        g = S.stops[S.stops["cluster"] == c]
        confusion.append({
            "cluster": int(c), "name": S.summary_by_id[int(c)]["name"],
            "color": S.summary_by_id[int(c)]["color"],
            "truth": records(g["archetype_true"].value_counts().rename_axis("archetype")
                             .reset_index(name="stops")),
        })
    m["confusion"] = confusion
    m["rhythms"] = list(S.rhythms.values())
    m["features"] = S.meta["features"]
    m["medians"] = S.meta["medians"]
    m["centroids"] = [{"cluster": c["id"], "name": c["name"], "color": c["color"],
                       "centroid": c["centroid"]} for c in S.summary]
    return m


@app.get("/api/model")
def model():
    return {
        "metrics": S.metrics,
        "meta": {
            "features": S.meta["features"],
            "feature_labels": S.meta.get("feature_labels", {}),
            "medians": S.meta["medians"],
            "ranges": S.meta.get("ranges", {}),
            "palette": S.meta["palette"],
            "k": S.meta["k"],
            "trained_at": S.meta.get("trained_at"),
        },
        "clusters": S.summary,
        "rhythms": list(S.rhythms.values()),
        "confusion": metrics()["confusion"],
        "heatmap": [
            {"id": c["id"], "name": c["name"], "color": c["color"],
             "values": [round(float(v), 1) for v in S.heat.loc[c["id"]]]}
            for c in S.summary if c["id"] in S.heat.index
        ],
    }


@app.get("/api/anomalies")
def anomalies(limit: int = 40):
    outlier_stops = S.stops.sort_values("anomaly_score", ascending=False).head(limit)
    return {
        "stop_outliers": records(outlier_stops[[
            "stop_id", "stop_name", "zone", "cluster", "cluster_name", "cluster_color",
            "anomaly_score", "outlier", "footfall_total", "dwell_mean_s",
            "speed_mean_kmh", "routes_served"]]),
        "hourly": records(S.hourly_anomalies.head(limit)),
        "dbscan_outliers": int(S.metrics["dbscan_outliers"]),
        "iso_anomalies": int(S.metrics["isolation_forest_anomalies"]),
        "threshold": 0.75,
    }


@app.get("/api/heatmap")
def heatmap():
    return {"hours": list(range(24)),
            "rows": [{"id": c["id"], "name": c["name"], "color": c["color"],
                      "values": [round(float(v), 1) for v in S.heat.loc[c["id"]]]}
                     for c in S.summary if c["id"] in S.heat.index]}


@app.get("/api/routes")
def routes():
    return {"routes": [S.route_stats[r] for r in S.route_stats]}


@app.get("/api/routes/{route_id}")
def route_detail(route_id: str):
    if route_id not in S.route_stats:
        raise HTTPException(404, "unknown route")
    r = S.route_stats[route_id]
    snap = S.sim.snapshot()
    return {**r, "live": [b for b in snap["buses"] if b["route_id"] == route_id]}


@app.get("/api/network")
def network():
    return {"zones": S.zones, "routes": [
        {"route_id": r["route_id"], "route_name": r["route_name"],
         "color": r["color"], "geometry": r["geometry"], "buses": r["buses"],
         "riders_day": r["riders_day"], "n_stops": r["n_stops"]}
        for r in S.route_stats.values()]}


@app.get("/api/rhythms")
def rhythms():
    return {"rhythms": list(S.rhythms.values())}


# ---------------------------------------------------------------- live ----
@app.get("/api/live")
def live():
    return S.sim.snapshot()


@app.get("/api/live/stream")
async def live_stream():
    async def gen():
        for _ in range(3600):
            yield f"data: {json.dumps(S.sim.snapshot())}\n\n"
            await asyncio.sleep(1)
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})


# ------------------------------------------------------------- inference ----
@app.post("/api/predict")
def predict(payload: dict = Body(...)):
    """Real-time inference: score a hypothetical stop profile with the trained KMeans."""
    feats = S.meta["features"]
    medians = S.meta["medians"]
    vec = np.array([[float(payload.get(f, medians[f])) for f in feats]])
    Xs = S.models["scaler"].transform(vec)
    Xp = S.models["pca"].transform(Xs)
    km = S.models["kmeans"]
    dims = km.cluster_centers_.shape[1]
    cid = int(km.predict(Xp[:, :dims])[0])

    d = np.linalg.norm(km.cluster_centers_ - Xp[:, :dims], axis=1)
    w = np.exp(-(d ** 2) / (2 * (d.std() + 1e-6) ** 2))
    conf = w / w.sum()

    names = S.meta["cluster_names"]
    nearest = S.stops[S.stops["cluster"] == cid].copy()
    nearest["d"] = (((nearest[feats] - vec[0]) ** 2).sum(axis=1)) ** 0.5
    nearest = nearest.nsmallest(4, "d")

    summary = S.summary_by_id.get(cid, {})
    return {
        "cluster": cid,
        "name": names.get(str(cid), f"Cluster {cid}"),
        "color": S.meta["palette"][cid % len(S.meta["palette"])],
        "confidence": round(float(conf[cid]), 4),
        "probabilities": [
            {"cluster": int(i), "name": names.get(str(int(i)), f"Cluster {int(i)}"),
             "p": round(float(conf[i]), 4),
             "color": S.meta["palette"][int(i) % len(S.meta["palette"])]}
            for i in np.argsort(-conf) if i < len(names)
        ],
        "curve_abs": summary.get("curve_abs", []),
        "curve_norm": summary.get("curve_norm", []),
        "cluster_profile": summary,
        "nearest_stops": records(nearest[["stop_id", "stop_name", "zone",
                                          "cluster_name", "cluster_color",
                                          "footfall_total", "d"]].head(4)),
        "anomaly_score": round(float(S.models["iso"].decision_function(Xs)[0] * -100 + 50), 2),
        "input": {f: float(v) for f, v in zip(feats, vec[0])},
    }


@app.get("/api/export/clusters.csv")
def export_clusters():
    path = os.path.join(ART, "stop_clusters.csv")
    return FileResponse(path, media_type="text/csv", filename="fleetsense_stops_clustered.csv")


# ------------------------------------------------------------- frontend ----
if os.path.isdir(DIST):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
