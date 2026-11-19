"""
FleetSense :: preprocessing + feature engineering (v2).

Turns the raw feeds into:

  dataset.csv                         - clean stop x date x hour panel used by the app
  data/processed/hourly_footfall.csv  - pipeline copy of the panel
  data/processed/stop_features.csv    - 29 engineered features per stop
  data/processed/hourly_profiles.csv  - 24-dim normalised daily demand curve per stop
  data/processed/data_quality.json    - QA report (missing, duplicates, outliers)
"""

from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
PROC = os.path.join(ROOT, "data", "processed")
ART = os.path.join(ROOT, "data", "artifacts")
os.makedirs(PROC, exist_ok=True)
os.makedirs(ART, exist_ok=True)


def load():
    stops = pd.read_csv(os.path.join(RAW, "stops.csv"))
    events = pd.read_csv(os.path.join(RAW, "stop_events.csv"), parse_dates=["timestamp", "date"])
    cam = pd.read_csv(os.path.join(RAW, "camera_footfall.csv"), parse_dates=["date"])
    route_stops = pd.read_csv(os.path.join(RAW, "route_stops.csv"))
    ctx = pd.read_csv(os.path.join(RAW, "daily_context.csv"), parse_dates=["date"])
    return stops, events, cam, route_stops, ctx


def quality_report(events, cam, stops) -> dict:
    return {
        "rows": {"stop_events": int(len(events)), "camera_footfall": int(len(cam)),
                 "stops": int(len(stops))},
        "duplicate_event_ids": int(events["event_id"].duplicated().sum()),
        "nulls": {c: int(events[c].isna().sum()) for c in events.columns if events[c].isna().any()},
        "nulls_camera": {c: int(cam[c].isna().sum()) for c in cam.columns if cam[c].isna().any()},
        "negative_values": {
            "boardings": int((events["boardings"] < 0).sum()),
            "alightings": int((events["alightings"] < 0).sum()),
            "dwell_seconds": int((events["dwell_seconds"] < 0).sum()),
            "pedestrians": int((cam["pedestrians"] < 0).sum()),
        },
        "outlier_dwell_p99_s": float(events["dwell_seconds"].quantile(.99)),
        "stops_without_camera": int(len(set(stops.stop_id) - set(cam.stop_id))),
        "date_range": [str(events["date"].min().date()), str(events["date"].max().date())],
        "avg_camera_confidence": float(cam["camera_confidence"].mean()),
    }


def build_hourly(events: pd.DataFrame, cam: pd.DataFrame) -> pd.DataFrame:
    ev = (events.groupby(["stop_id", "date", "hour"])
          .agg(boardings=("boardings", "sum"),
               alightings=("alightings", "sum"),
               visits=("event_id", "count"),
               dwell_mean=("dwell_seconds", "mean"),
               occupancy_mean=("occupancy", "mean"),
               speed_mean=("approach_speed_kmh", "mean"),
               delay_mean=("schedule_deviation_s", "mean"))
          .reset_index())

    panel = cam.copy()
    panel["hour"] = panel["hour"].astype(int)
    panel = panel.merge(ev, on=["stop_id", "date", "hour"], how="left")

    for c in ["boardings", "alightings", "visits"]:
        panel[c] = panel[c].fillna(0).astype(int)
    panel["riders"] = panel["boardings"] + panel["alightings"]
    for c in ["dwell_mean", "occupancy_mean", "speed_mean", "delay_mean"]:
        panel[c] = panel[c].fillna(0.0)
    panel["is_weekend"] = panel["date"].dt.weekday >= 5
    return panel


def build_profiles(panel: pd.DataFrame) -> pd.DataFrame:
    wk = panel[~panel["is_weekend"]]
    daily = (wk.groupby(["stop_id", "hour"])
             .agg(f=("riders", "mean"), p=("pedestrians", "mean")).reset_index())
    daily["demand"] = daily["f"] + 0.35 * daily["p"]
    mat = daily.pivot(index="stop_id", columns="hour", values="demand").fillna(0.0)
    mat = mat.reindex(columns=range(24), fill_value=0.0)
    norm = mat.div(mat.sum(axis=1).replace(0, 1.0), axis=0)
    prof = norm.copy()
    prof.columns = [f"h{h:02d}" for h in range(24)]
    prof["daily_demand"] = mat.sum(axis=1).values
    return prof.reset_index()


def build_features(panel: pd.DataFrame, stops: pd.DataFrame,
                   route_stops: pd.DataFrame) -> pd.DataFrame:
    wk = panel[~panel["is_weekend"]]
    we = panel[panel["is_weekend"]]

    daily = panel.groupby(["stop_id", "date", "is_weekend"]).agg(
        riders=("riders", "sum"), peds=("pedestrians", "sum")).reset_index()
    wk_daily = daily[~daily["is_weekend"]].groupby("stop_id")["riders"].agg(["mean", "std"])
    we_daily = daily[daily["is_weekend"]].groupby("stop_id")["riders"].mean().rename("we_mean")

    hprof = (wk.groupby(["stop_id", "hour"])
             .agg(riders=("riders", "mean"), peds=("pedestrians", "mean"),
                  visits=("visits", "mean"))
             .reset_index())
    hprof["demand"] = hprof["riders"] + 0.35 * hprof["peds"]

    def band(df, lo, hi, col="demand"):
        return (df[(df["hour"] >= lo) & (df["hour"] <= hi)]
                .groupby("stop_id")[col].sum())

    total = hprof.groupby("stop_id")["demand"].sum().replace(0, 1.0)
    morning = band(hprof, 6, 9)
    midday = band(hprof, 10, 15)
    afternoon = band(hprof, 12, 16)
    evening = band(hprof, 16, 19)
    night = band(hprof, 20, 23) + band(hprof, 0, 5)

    visited = wk[wk["visits"] > 0]
    agg = visited.groupby("stop_id").agg(
        boardings=("boardings", "mean"), alightings=("alightings", "mean"),
        dwell=("dwell_mean", "mean"), speed=("speed_mean", "mean"),
        occ=("occupancy_mean", "mean"), delay=("delay_mean", "mean"),
    )
    camagg = panel.groupby("stop_id").agg(
        peds_day=("pedestrians", "mean"), two_w_day=("two_wheelers", "mean"),
        crowd=("crowd_density_index", "mean"), conf=("camera_confidence", "mean"),
    )

    peak = hprof.groupby("stop_id")["demand"].agg(["max", "median"])

    piv = hprof.pivot(index="stop_id", columns="hour", values="demand").fillna(0.0)
    piv = piv.reindex(columns=range(24), fill_value=0.0)
    p = piv.div(piv.sum(axis=1).replace(0, 1), axis=0).to_numpy()
    ent = -np.nansum(np.where(p > 0, p * np.log(p + 1e-12), 0), axis=1) / np.log(24)
    entropy = pd.Series(ent, index=piv.index, name="entropy")

    routes_served = (route_stops.groupby("stop_id")["route_id"].nunique()
                     .rename("routes_served").reindex(stops["stop_id"]).fillna(1))

    # visit volume: how many bus calls per day, and how many happen at night
    visits_daily = panel.groupby(["stop_id", "date"])["visits"].sum().groupby("stop_id").mean()
    night_visits = band(hprof, 20, 23, "visits") + band(hprof, 0, 5, "visits")
    total_visits = hprof.groupby("stop_id")["visits"].sum().replace(0, 1.0)

    # speed variability across the day (only visited hours)
    sp = visited.pivot_table(index="stop_id", columns="hour", values="speed_mean", aggfunc="mean")
    speed_cv = (sp.std(axis=1) / sp.mean(axis=1).replace(0, np.nan)).fillna(0)

    f = pd.DataFrame(index=stops["stop_id"].values)
    f.index.name = "stop_id"
    s_idx = stops.set_index("stop_id")
    f["stop_name"] = s_idx["stop_name"]
    f["zone"] = s_idx["zone"]
    f["lat"] = s_idx["lat"]
    f["lon"] = s_idx["lon"]
    f["shelter"] = s_idx["shelter"]
    f["archetype_true"] = s_idx["archetype_true"]

    f["riders_day"] = wk_daily["mean"].reindex(f.index).fillna(0)
    f["peds_day"] = camagg["peds_day"].reindex(f.index).fillna(0) * 24
    f["footfall_total"] = f["riders_day"] + f["peds_day"]
    f["log_footfall"] = np.log1p(f["footfall_total"])

    f["morning_share"] = (morning / total).reindex(f.index).fillna(0)
    f["midday_share"] = (midday / total).reindex(f.index).fillna(0)
    f["afternoon_share"] = (afternoon / total).reindex(f.index).fillna(0)
    f["evening_share"] = (evening / total).reindex(f.index).fillna(0)
    f["night_share"] = (night / total).reindex(f.index).fillna(0)
    f["am_peak_ratio"] = (morning / total).reindex(f.index).fillna(0)
    f["pm_peak_ratio"] = (band(hprof, 17, 20) / total).reindex(f.index).fillna(0)

    f["peak_to_base"] = (peak["max"] / peak["median"].replace(0, np.nan)).reindex(f.index).fillna(1.0).clip(1, 14)
    f["temporal_entropy"] = entropy.reindex(f.index).fillna(0)
    f["night_activity"] = (night_visits / total_visits).reindex(f.index).fillna(0)
    f["service_frequency"] = visits_daily.reindex(f.index).fillna(0)

    f["weekend_ratio"] = (we_daily.reindex(f.index) /
                          wk_daily["mean"].reindex(f.index).replace(0, np.nan)).fillna(1.0).clip(0, 3)
    f["daily_volatility"] = (wk_daily["std"] /
                             wk_daily["mean"].replace(0, np.nan)).reindex(f.index).fillna(0).clip(0, 2)

    b = agg["boardings"].reindex(f.index).fillna(0)
    a = agg["alightings"].reindex(f.index).fillna(0)
    f["boarding_balance"] = ((b - a) / (b + a).replace(0, np.nan)).fillna(0)

    am = wk[(wk["hour"] >= 6) & (wk["hour"] <= 9) & (wk["visits"] > 0)]
    amb = am.groupby("stop_id").agg(b=("boardings", "sum"), a=("alightings", "sum"))
    f["morning_balance"] = ((amb["b"] - amb["a"]) /
                            (amb["b"] + amb["a"]).replace(0, np.nan)
                            ).reindex(f.index).fillna(0)

    f["dwell_mean_s"] = agg["dwell"].reindex(f.index).fillna(0)
    f["dwell_per_boarding"] = (f["dwell_mean_s"] / (b + 1)).clip(0, 12)
    f["speed_mean_kmh"] = agg["speed"].reindex(f.index).fillna(0)
    f["speed_consistency"] = (1 / (1 + speed_cv.reindex(f.index).fillna(0))).clip(0, 1)
    f["occupancy_mean"] = agg["occ"].reindex(f.index).fillna(0)
    f["capacity_utilization"] = (f["occupancy_mean"] / 60).clip(0, 1.5)
    f["schedule_delay_mean_s"] = agg["delay"].reindex(f.index).fillna(0)
    f["delay_index"] = (f["schedule_delay_mean_s"].abs() / 120).clip(0, 3)

    f["routes_served"] = routes_served.reindex(f.index).fillna(1).astype(int)
    f["route_diversity"] = f["routes_served"] / f["routes_served"].max()
    f["footfall_per_route"] = (f["footfall_total"] / f["routes_served"].replace(0, 1)).clip(0, 6000)

    f["ped_to_rider_ratio"] = (f["peds_day"] / f["riders_day"].replace(0, np.nan)).fillna(0).clip(0, 14)
    f["two_wheeler_share"] = (camagg["two_w_day"].reindex(f.index) /
                              (camagg["two_w_day"].reindex(f.index) + f["peds_day"]).replace(0, np.nan)).fillna(0)
    f["crowd_density"] = camagg["crowd"].reindex(f.index).fillna(0)
    f["crowd_pressure"] = (f["crowd_density"] * f["peds_day"] / 1000).clip(0, 3)
    f["camera_confidence"] = camagg["conf"].reindex(f.index).fillna(0)

    # spatial context: neighbours within 350 m and 600 m
    coords = f[["lat", "lon"]].to_numpy()
    lat_r, lon_r = np.radians(coords[:, 0]), np.radians(coords[:, 1])
    dlat = lat_r[:, None] - lat_r[None, :]
    dlon = lon_r[:, None] - lon_r[None, :]
    h = (np.sin(dlat / 2) ** 2 +
         np.cos(lat_r)[:, None] * np.cos(lat_r)[None, :] * np.sin(dlon / 2) ** 2)
    dist_km = 2 * 6371 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))
    np.fill_diagonal(dist_km, np.inf)
    near = dist_km < 0.35
    ft = f["footfall_total"].to_numpy()
    neigh_ratio = np.array([ft[i] / max(ft[near[i]].mean(), 1) if near[i].any() else 1.0
                            for i in range(len(f))])
    f["neighbour_demand_ratio"] = np.clip(neigh_ratio, 0.05, 20)
    f["network_degree"] = (int(0) + f["routes_served"] + (dist_km < 0.6).sum(axis=1))

    f = f.reset_index()
    return f


def main():
    stops, events, cam, route_stops, ctx = load()
    print("raw:", len(stops), "stops |", len(events), "events |", len(cam), "camera rows")

    report = quality_report(events, cam, stops)
    panel = build_hourly(events, cam)
    report["panel_rows"] = int(len(panel))

    panel["pedestrians"] = panel["pedestrians"].clip(lower=0)
    panel["riders"] = panel["riders"].clip(lower=0)
    report["panel_null_rate"] = float(panel.isna().mean().mean())

    features = build_features(panel, stops, route_stops)
    profiles = build_profiles(panel)

    panel.to_csv(os.path.join(PROC, "hourly_footfall.csv"), index=False)
    panel.to_csv(os.path.join(ROOT, "dataset.csv"), index=False)
    features.to_csv(os.path.join(PROC, "stop_features.csv"), index=False)
    profiles.to_csv(os.path.join(PROC, "hourly_profiles.csv"), index=False)
    with open(os.path.join(PROC, "data_quality.json"), "w") as fh:
        json.dump(report, fh, indent=2)

    print("\nprocessed shapes:")
    print("  hourly_footfall", panel.shape)
    print("  stop_features  ", features.shape)
    print("  hourly_profiles", profiles.shape)

    cols = [c for c in features.columns if features[c].dtype != object]
    print(features[cols].describe().T[["mean", "std", "min", "max"]].round(2).to_string())


if __name__ == "__main__":
    main()
