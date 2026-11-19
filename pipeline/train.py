"""
FleetSense :: unsupervised learning.

Models trained (no labels used anywhere in fitting):

  1. StandardScaler + PCA        -> dimensional reduction for the 2-D embedding
  2. KMeans (k chosen by silhouette / elbow)  -> stop mobility archetypes
  3. Agglomerative (Ward)        -> stability cross-check (ARI vs KMeans)
  4. DBSCAN (on PCA space)       -> spatially/temporally atypical stops
  5. IsolationForest             -> anomalous stop-hours in footfall
  6. KMeans on 24-dim demand curves -> recurring daily "rhythm" patterns

Outputs: models/*.pkl + data/artifacts/model_metrics.json + stop_clusters.csv
"""

from __future__ import annotations

import json
import os
import pickle
import time

import numpy as np
import pandas as pd
from sklearn.cluster import AgglomerativeClustering, DBSCAN, KMeans
from sklearn.decomposition import PCA
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (adjusted_rand_score, calinski_harabasz_score,
                             davies_bouldin_score, silhouette_score)
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROC = os.path.join(ROOT, "data", "processed")
ART = os.path.join(ROOT, "data", "artifacts")
MODELS = os.path.join(ROOT, "models")
os.makedirs(ART, exist_ok=True)
os.makedirs(MODELS, exist_ok=True)

SEED = 42

FEATURES = [
    "log_footfall",
    "morning_share", "midday_share", "afternoon_share", "evening_share", "night_share",
    "am_peak_ratio", "pm_peak_ratio",
    "peak_to_base", "temporal_entropy", "night_activity", "service_frequency",
    "weekend_ratio", "daily_volatility",
    "morning_balance", "dwell_mean_s", "dwell_per_boarding", "speed_mean_kmh",
    "speed_consistency", "occupancy_mean", "capacity_utilization",
    "schedule_delay_mean_s", "delay_index",
    "routes_served", "footfall_per_route",
    "ped_to_rider_ratio", "two_wheeler_share", "crowd_density", "crowd_pressure",
    "neighbour_demand_ratio", "network_degree",
]

FEATURE_LABELS = {
    "log_footfall": "Footfall volume (log)",
    "morning_share": "Morning demand share",
    "midday_share": "Midday demand share",
    "afternoon_share": "Afternoon demand share",
    "evening_share": "Evening demand share",
    "night_share": "Night demand share",
    "am_peak_ratio": "AM peak concentration",
    "pm_peak_ratio": "PM peak concentration",
    "peak_to_base": "Peak-to-median sharpness",
    "temporal_entropy": "Temporal entropy",
    "night_activity": "Night bus activity",
    "service_frequency": "Bus calls per day",
    "weekend_ratio": "Weekend / weekday ratio",
    "daily_volatility": "Day-to-day volatility",
    "morning_balance": "AM boarding balance",
    "dwell_mean_s": "Mean dwell (s)",
    "dwell_per_boarding": "Dwell per boarding (s)",
    "speed_mean_kmh": "Approach speed (km/h)",
    "speed_consistency": "Speed consistency",
    "occupancy_mean": "Mean occupancy",
    "capacity_utilization": "Capacity utilisation",
    "schedule_delay_mean_s": "Schedule deviation (s)",
    "delay_index": "Delay index",
    "routes_served": "Routes served",
    "footfall_per_route": "Footfall per route",
    "ped_to_rider_ratio": "Pedestrian : rider ratio",
    "two_wheeler_share": "Two-wheeler share",
    "crowd_density": "Camera crowd density",
    "crowd_pressure": "Crowd pressure",
    "neighbour_demand_ratio": "Neighbour demand ratio",
    "network_degree": "Network degree",
}

ALGORITHMS = {
    "clustering": "KMeans",
    "validation": "Ward agglomerative",
    "density": "DBSCAN",
    "anomaly": "Isolation Forest",
    "rhythm": "KMeans on 24-dim curves",
    "reduction": "StandardScaler -> PCA",
}

PALETTE = ["#5b8cff", "#22c7a9", "#f4a63a", "#c86bfa", "#ff6b81",
           "#3ec1f3", "#b6e05a", "#ff9f5a", "#8a93ff", "#f45d9c"]


def z(s: pd.Series) -> pd.Series:
    sd = s.std(ddof=0)
    return (s - s.mean()) / (sd if sd > 0 else 1.0)


def name_clusters(centroids: pd.DataFrame) -> dict[int, str]:
    """Heuristic, data-driven naming of each cluster from its centroid profile."""
    zc = centroids.apply(z)
    scores = pd.DataFrame(index=centroids.index)
    scores["Commuter Interchange Hub"] = (1.3 * zc["morning_share"] + 1.2 * zc["log_footfall"]
                                          + 0.7 * zc["peak_to_base"] + 0.6 * zc["routes_served"]
                                          - 0.7 * zc["dwell_mean_s"] - 1.2 * zc["morning_balance"])
    scores["Residential Outbound Feeder"] = (1.3 * zc["morning_share"] + 1.1 * zc["morning_balance"]
                                             + 0.6 * zc["weekend_ratio"] - 0.6 * zc["log_footfall"]
                                             + 0.4 * zc["daily_volatility"])
    scores["Evening & Night Footfall"] = (1.7 * zc["night_share"] + 1.0 * zc["evening_share"]
                                          + 0.8 * zc["weekend_ratio"] + 0.5 * zc["ped_to_rider_ratio"])
    scores["Campus & College Zone"] = (1.1 * zc["afternoon_share"] + 0.9 * zc["morning_share"]
                                       - 1.3 * zc["weekend_ratio"] + 0.5 * zc["ped_to_rider_ratio"]
                                       - 0.5 * zc["speed_mean_kmh"])
    scores["Healthcare & Institutional"] = (1.1 * zc["midday_share"] + 0.9 * zc["dwell_mean_s"]
                                            + 0.6 * zc["temporal_entropy"]
                                            - 0.5 * zc["weekend_ratio"] + 0.3 * zc["routes_served"])
    scores["Market & Retail Footfall"] = (1.2 * zc["midday_share"] + 1.1 * zc["ped_to_rider_ratio"]
                                          + 0.8 * zc["dwell_mean_s"] + 0.7 * zc["weekend_ratio"]
                                          + 0.3 * zc["crowd_density"])
    scores["Shift-Work & Industrial"] = (1.4 * zc["speed_mean_kmh"] - 1.4 * zc["weekend_ratio"]
                                         + 1.0 * zc["night_share"] + 0.7 * zc["peak_to_base"]
                                         - 0.7 * zc["ped_to_rider_ratio"])
    scores["Low-Activity Peripheral"] = (-1.8 * zc["log_footfall"] - 1.0 * zc["routes_served"]
                                         + 1.0 * zc["speed_mean_kmh"] - 0.4 * zc["crowd_density"])
    scores["Airport & Gateway Transit"] = (1.5 * zc["speed_mean_kmh"] + 1.3 * zc["night_share"]
                                            + 0.8 * zc["speed_consistency"]
                                            - 1.0 * zc["ped_to_rider_ratio"]
                                            - 0.5 * zc["peak_to_base"])
    scores["Event & Leisure Venue"] = (1.4 * zc["evening_share"] + 1.1 * zc["peak_to_base"]
                                        + 0.9 * zc["weekend_ratio"] + 0.9 * zc["crowd_pressure"]
                                        + 0.5 * zc["ped_to_rider_ratio"] - 0.7 * zc["morning_share"])
    scores["Balanced Mixed-Use"] = (0.5 * zc["temporal_entropy"] + 0.3 * zc["midday_share"]
                                    - 0.4 * zc["peak_to_base"] - 0.15)
    labels = scores.idxmax(axis=1).to_dict()
    # disambiguate duplicates
    seen: dict[str, int] = {}
    for cid, lab in list(labels.items()):
        if lab in seen:
            seen[lab] += 1
            labels[cid] = f"{lab} #{seen[lab] + 1}"
        else:
            seen[lab] = 0
    return labels


def pick_k(X: np.ndarray) -> tuple[int, list[dict]]:
    trials = []
    for k in range(3, 13):
        km = KMeans(n_clusters=k, n_init=20, random_state=SEED).fit(X)
        trials.append({
            "k": k,
            "inertia": float(km.inertia_),
            "silhouette": float(silhouette_score(X, km.labels_)),
            "davies_bouldin": float(davies_bouldin_score(X, km.labels_)),
            "calinski_harabasz": float(calinski_harabasz_score(X, km.labels_)),
        })
    # parsimony rule: smallest k within 3% of the best silhouette
    best = max(t["silhouette"] for t in trials)
    near = [t for t in trials if t["silhouette"] >= best * 0.97]
    chosen = min(near, key=lambda t: t["k"])
    return int(chosen["k"]), trials


def main():
    t0 = time.time()
    feats = pd.read_csv(os.path.join(PROC, "stop_features.csv"))
    profiles = pd.read_csv(os.path.join(PROC, "hourly_profiles.csv"))
    panel = pd.read_csv(os.path.join(PROC, "hourly_footfall.csv"), parse_dates=["date"])

    missing = [c for c in FEATURES if c not in feats.columns]
    if missing:
        raise SystemExit(f"missing features: {missing}")

    X_raw = feats[FEATURES].to_numpy(dtype=float)
    scaler = StandardScaler().fit(X_raw)
    X = scaler.transform(X_raw)

    pca = PCA(n_components=min(8, X.shape[1]), random_state=SEED).fit(X)
    Xp = pca.transform(X)
    pca2 = PCA(n_components=2, random_state=SEED).fit(X)

    k, trials = pick_k(Xp[:, : min(6, Xp.shape[1])])
    kmeans = KMeans(n_clusters=k, n_init=50, random_state=SEED).fit(Xp[:, : min(6, Xp.shape[1])])
    labels = kmeans.labels_
    sil = float(silhouette_score(Xp[:, : min(6, Xp.shape[1])], labels))

    ward = AgglomerativeClustering(n_clusters=k, linkage="ward").fit(Xp[:, :4])
    ari = float(adjusted_rand_score(labels, ward.labels_))

    # DBSCAN on the first 3 PCs, eps from the k-distance knee
    nn = NearestNeighbors(n_neighbors=8).fit(Xp[:, :3])
    kdist = np.sort(nn.kneighbors(Xp[:, :3])[0][:, -1])
    eps = float(np.quantile(kdist, 0.90))
    db = DBSCAN(eps=eps, min_samples=6).fit(Xp[:, :3])
    noise = db.labels_ == -1

    # ---- engineered feature table with cluster assignment ------------------
    out = feats.copy()
    out["cluster"] = labels
    out["pca_x"] = Xp[:, 0]
    out["pca_y"] = Xp[:, 1]
    out["pc1"] = Xp[:, 0]
    out["pc2"] = Xp[:, 1]
    out["outlier"] = noise
    out["ward_label"] = ward.labels_

    # anomaly score from IsolationForest on scaled features
    iso = IsolationForest(n_estimators=300, contamination=0.06, random_state=SEED).fit(X)
    out["anomaly_raw"] = iso.score_samples(X)          # higher = more normal
    lo, hi = out["anomaly_raw"].min(), out["anomaly_raw"].max()
    out["anomaly_score"] = ((hi - out["anomaly_raw"]) / (hi - lo)).round(4)

    # ---- rhythm clustering on 24h curves ----------------------------------
    hcols = [f"h{h:02d}" for h in range(24)]
    P = profiles[hcols].to_numpy(dtype=float)
    Pn = StandardScaler().fit_transform(P)
    rhythm_k = 4
    rhythm = KMeans(n_clusters=rhythm_k, n_init=30, random_state=SEED).fit(Pn)
    rhythm_names = {}
    for c in range(rhythm_k):
        curve = P[rhythm.labels_ == c].mean(axis=0)
        peak = int(curve.argmax())
        if peak in (0, 1, 2, 3, 4, 5):
            nm = "Early Shift Ramp"
        elif peak in (6, 7, 8, 9):
            nm = "Morning Peak"
        elif peak in (10, 11, 12, 13, 14, 15):
            nm = "Midday Plateau"
        elif peak in (16, 17, 18, 19):
            nm = "Evening Peak"
        else:
            nm = "Late Night"
        late = float(curve[20:24].sum() + curve[0:6].sum())
        if nm == "Evening Peak" and late > 0.34:
            nm = "Late Evening"
        rhythm_names[c] = f"{nm} - {peak:02d}h"
    # make names unique (the chart keys off them)
    seen_r: dict[str, int] = {}
    for c in sorted(rhythm_names):
        nm = rhythm_names[c]
        if nm in seen_r:
            seen_r[nm] += 1
            rhythm_names[c] = f"{nm} #{seen_r[nm] + 1}"
        else:
            seen_r[nm] = 0

    rhythm_map = pd.Series(rhythm.labels_, index=profiles["stop_id"]).to_dict()
    out["rhythm_id"] = out["stop_id"].map(rhythm_map).fillna(0).astype(int)
    out["rhythm_name"] = out["rhythm_id"].map(rhythm_names)
    rhythm_curves = {}
    for c in range(rhythm_k):
        curve = P[rhythm.labels_ == c].mean(axis=0)
        rhythm_curves[str(c)] = {
            "id": c, "name": rhythm_names[c],
            "curve": [round(float(v), 5) for v in curve],
            "stops": int((rhythm.labels_ == c).sum()),
            "peak_hour": int(curve.argmax()),
        }

    names = name_clusters(out.groupby("cluster")[FEATURES].mean())
    out["cluster_name"] = out["cluster"].map(names)
    out["cluster_color"] = out["cluster"].map(lambda c: PALETTE[c % len(PALETTE)])

    # ---- cluster demand curves (mean weekday shape, normalised + absolute) --
    hcols = [f"h{h:02d}" for h in range(24)]
    prof_with = profiles.merge(out[["stop_id", "cluster"]], on="stop_id", how="left")
    panel_with = panel[~panel["is_weekend"]].merge(
        out[["stop_id", "cluster"]], on="stop_id", how="left")
    panel_with["demand"] = panel_with["riders"] + 0.35 * panel_with["pedestrians"]
    cluster_curves = {}
    for c in sorted(out["cluster"].unique()):
        norm_curve = prof_with[prof_with["cluster"] == c][hcols].mean(axis=0)
        abs_curve = (panel_with[panel_with["cluster"] == c]
                     .groupby("hour")["demand"].mean().reindex(range(24)).fillna(0))
        cluster_curves[str(int(c))] = {
            "norm": [round(float(v), 5) for v in norm_curve.to_numpy()],
            "abs": [round(float(v), 2) for v in abs_curve.to_numpy()],
        }

    # ---- cluster summary ---------------------------------------------------
    summary = []
    for c in sorted(out["cluster"].unique()):
        g = out[out["cluster"] == c]
        share = len(g) / len(out)
        top_zones = g["zone"].value_counts().head(3).to_dict()
        purity = float(g["archetype_true"].value_counts(normalize=True).iloc[0])
        summary.append({
            "id": int(c), "name": names[c], "color": PALETTE[c % len(PALETTE)],
            "stops": int(len(g)), "share": round(float(share), 4),
            "avg_footfall": round(float(g["footfall_total"].mean()), 1),
            "avg_riders_day": round(float(g["riders_day"].mean()), 1),
            "avg_peds_day": round(float(g["peds_day"].mean()), 1),
            "avg_dwell_s": round(float(g["dwell_mean_s"].mean()), 1),
            "avg_speed": round(float(g["speed_mean_kmh"].mean()), 1),
            "avg_routes": round(float(g["routes_served"].mean()), 1),
            "ped_to_rider": round(float(g["ped_to_rider_ratio"].mean()), 2),
            "weekend_ratio": round(float(g["weekend_ratio"].mean()), 2),
            "anomalies": int(g["outlier"].sum()),
            "purity": round(purity, 3),
            "dominant_archetype": str(g["archetype_true"].value_counts().index[0]),
            "top_zones": list(top_zones.keys()),
            "centroid": {f: round(float(g[f].mean()), 3) for f in FEATURES},
            "curve_norm": cluster_curves[str(int(c))]["norm"],
            "curve_abs": cluster_curves[str(int(c))]["abs"],
        })

    # ---- global metrics ----------------------------------------------------
    metrics = {
        "n_stops": int(len(out)),
        "n_features": len(FEATURES),
        "features": FEATURES,
        "chosen_k": int(k),
        "silhouette": round(sil, 4),
        "davies_bouldin": round(float(davies_bouldin_score(
            Xp[:, : min(6, Xp.shape[1])], labels)), 4),
        "calinski_harabasz": round(float(calinski_harabasz_score(
            Xp[:, : min(6, Xp.shape[1])], labels)), 2),
        "ari_kmeans_vs_ward": round(ari, 4),
        "pca_variance_ratio": [round(float(v), 4) for v in pca2.explained_variance_ratio_],
        "pca2_variance_ratio": [round(float(v), 4) for v in pca2.explained_variance_ratio_],
        "pca_explained": [round(float(v), 4) for v in pca.explained_variance_ratio_],
        "pca_components": int(pca.n_components_),
        "pca2d_variance_explained": round(float(pca2.explained_variance_ratio_.sum()), 4),
        "dbscan_eps": round(eps, 4),
        "dbscan_outliers": int(noise.sum()),
        "dbscan_noise_rate": round(float(noise.mean()), 4),
        "isolation_forest_anomalies": int((out["anomaly_score"] > 0.75).sum()),
        "rhythm_k": rhythm_k,
        "k_selection": trials,
        "algorithms": ALGORITHMS,
        "feature_labels": FEATURE_LABELS,
        "feature_stats": {
            f: {"mean": round(float(feats[f].mean()), 4),
                "std": round(float(feats[f].std()), 4),
                "min": round(float(feats[f].min()), 4),
                "median": round(float(feats[f].median()), 4),
                "max": round(float(feats[f].max()), 4)}
            for f in FEATURES
        },
        "dbscan_min_samples": 6,
        "dbscan_space": "first 3 principal components",
        "iso_contamination": 0.06,
        "kmeans_space": f"first {min(6, Xp.shape[1])} principal components",
        "n_panel_rows": int(len(panel)),
        "n_source_events": int(panel["visits"].sum()),
        "n_rhythm_profiles": int(len(profiles)),
        "train_seconds": round(time.time() - t0, 2),
        "label_purity_mean": round(float(np.mean([s["purity"] for s in summary])), 4),
        "trained_at": pd.Timestamp.now("UTC").isoformat(),
    }

    # ---- anomaly table (stop-hours) ---------------------------------------
    ph = panel.copy()
    ph["demand"] = ph["riders"] + 0.35 * ph["pedestrians"]
    iso_hour = IsolationForest(n_estimators=300, contamination=0.01, random_state=SEED)
    ph["anom"] = iso_hour.fit_predict(ph[["demand", "riders", "pedestrians"]].to_numpy())
    hourly_anoms = (ph[ph["anom"] == -1]
                    .sort_values("demand", ascending=False)
                    .head(200)[["stop_id", "date", "hour", "riders", "pedestrians", "demand"]])
    hourly_anoms["date"] = hourly_anoms["date"].dt.strftime("%Y-%m-%d")
    hourly_anoms.to_csv(os.path.join(ART, "hourly_anomalies.csv"), index=False)

    # ---- persist -----------------------------------------------------------
    out.to_csv(os.path.join(ART, "stop_clusters.csv"), index=False)
    profiles.to_csv(os.path.join(ART, "rhythm_profiles.csv"), index=False)
    with open(os.path.join(ART, "model_metrics.json"), "w") as fh:
        json.dump(metrics, fh, indent=2)
    with open(os.path.join(ART, "cluster_summary.json"), "w") as fh:
        json.dump({"clusters": summary, "rhythms": rhythm_curves}, fh, indent=2)

    artifacts = {
        "scaler.pkl": scaler, "pca.pkl": pca, "pca2.pkl": pca2,
        "kmeans.pkl": kmeans, "iso.pkl": iso, "ward.pkl": ward,
        "dbscan.pkl": db, "rhythm_kmeans.pkl": rhythm,
    }
    for fn, obj in artifacts.items():
        with open(os.path.join(MODELS, fn), "wb") as fh:
            pickle.dump(obj, fh)

    with open(os.path.join(MODELS, "metadata.json"), "w") as fh:
        json.dump({"features": FEATURES, "k": int(k),
                   "feature_labels": FEATURE_LABELS,
                   "algorithms": ALGORITHMS,
                   "cluster_names": {str(a): b for a, b in names.items()},
                   "rhythm_names": {str(a): b for a, b in rhythm_names.items()},
                   "medians": {c: float(feats[c].median()) for c in FEATURES},
                   "ranges": {c: [float(feats[c].min()), float(feats[c].max())] for c in FEATURES},
                   "palette": PALETTE,
                   "trained_at": metrics["trained_at"]}, fh, indent=2)

    print(f"k = {k} | silhouette = {sil:.4f} | ARI vs Ward = {ari:.4f}")
    print(f"PCA 2-D variance = {metrics['pca2d_variance_explained']:.3f}")
    print(f"DBSCAN outliers = {noise.sum()} ({noise.mean():.1%})")
    print("\nclusters:")
    for s in summary:
        print(f"  [{s['id']}] {s['name']:32s} n={s['stops']:3d} "
              f"footfall={s['avg_footfall']:7.0f} purity={s['purity']:.2f} "
              f"(dominant truth: {s['dominant_archetype']})")
    print("\nrhythms:")
    for r in rhythm_curves.values():
        print(f"  [{r['id']}] {r['name']:18s} peak={r['peak_hour']:02d}:00 stops={r['stops']}")


if __name__ == "__main__":
    main()
