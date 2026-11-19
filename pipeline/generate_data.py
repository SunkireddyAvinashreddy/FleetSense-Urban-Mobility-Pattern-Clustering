"""
FleetSense :: synthetic-but-realistic data generator (v2).

Simulates what a city bus fleet with GPS + on-board cameras would emit:

  data/raw/stops.csv            - 370 bus stops with location / zone / services
  data/raw/routes.csv           - 24 routes
  data/raw/route_stops.csv      - ordered stop sequence per route
  data/raw/fleet.csv            - 520 buses with camera + GPS hardware
  data/raw/stop_events.csv      - per-visit boarding / alighting / dwell / speed
  data/raw/camera_footfall.csv  - hourly pedestrian & vehicle counts from cameras
  data/raw/gps_pings.csv        - 3-day raw GPS trail (60 s cadence)
  data/raw/daily_context.csv    - weather / incidents / city speed per day

The generator plants 10 latent mobility archetypes per stop. Those archetypes are
NEVER given to the model -- they are only used afterwards to sanity-check that
the unsupervised clusters recovered something meaningful.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

SEED = 20261119
rng = np.random.default_rng(SEED)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
os.makedirs(RAW, exist_ok=True)

N_BUSES = 520
DAYS = 35
GPS_DAYS = 3
END_DATE = date(2026, 11, 18)
START_DATE = END_DATE - timedelta(days=DAYS - 1)

# --------------------------------------------------------------------------
# Latent archetypes (ground truth, hidden from the clustering model)
# --------------------------------------------------------------------------
ARCHETYPES = [
    "cbd_commuter",
    "residential_feeder",
    "nightlife_evening",
    "education_zone",
    "market_retail",
    "healthcare_institutional",
    "industrial_shift",
    "peripheral_low_activity",
    "airport_gateway",
    "event_venue",
]

# 24 hourly shape of *demand* (relative, 0..1)
PROFILES = {
    "cbd_commuter": [.05, .02, .02, .02, .05, .15, .45, .95, 1.00, .75, .50, .45,
                     .45, .45, .48, .55, .75, .95, 1.00, .80, .50, .30, .18, .10],
    "residential_feeder": [.03, .02, .02, .02, .06, .20, .70, 1.00, .90, .45, .30, .30,
                           .30, .30, .32, .42, .60, .90, 1.00, .85, .50, .28, .12, .06],
    "nightlife_evening": [.06, .04, .02, .01, .02, .05, .12, .20, .25, .25, .30, .35,
                          .40, .40, .42, .50, .65, .85, 1.00, .95, .85, .80, .70, .45],
    "education_zone": [.02, .01, .01, .02, .08, .30, .70, 1.00, .95, .50, .35, .35,
                       .45, .60, .85, .95, .80, .50, .30, .18, .10, .06, .03, .02],
    "market_retail": [.03, .02, .02, .02, .05, .12, .28, .45, .62, .80, .92, 1.00,
                      1.00, .95, .95, .98, 1.00, .98, .90, .75, .52, .32, .16, .07],
    "healthcare_institutional": [.05, .03, .03, .03, .06, .15, .35, .60, .85, 1.00, 1.00, .95,
                                 .90, .92, .95, .95, .90, .70, .45, .28, .16, .10, .07, .05],
    "industrial_shift": [.10, .08, .05, .05, .30, .90, 1.00, .60, .20, .12, .10, .12,
                         .15, .55, 1.00, .90, .30, .15, .12, .15, .25, .55, .85, .50],
    "peripheral_low_activity": [.12, .08, .06, .06, .10, .25, .45, .60, .55, .40, .35, .32,
                                .30, .30, .32, .40, .50, .60, .55, .40, .28, .20, .16, .14],
    "airport_gateway": [.50, .55, .45, .28, .14, .10, .14, .26, .38, .44, .45, .45,
                        .46, .46, .46, .48, .54, .60, .68, .76, .86, .92, .84, .64],
    "event_venue": [.02, .01, .01, .01, .02, .03, .05, .08, .12, .15, .18, .20,
                    .22, .25, .30, .38, .55, .80, 1.00, .95, .80, .55, .35, .15],
}

WEEKEND_MULT = {
    "cbd_commuter": 0.55, "residential_feeder": 0.80, "nightlife_evening": 1.50,
    "education_zone": 0.15, "market_retail": 1.25, "healthcare_institutional": 0.85,
    "industrial_shift": 0.35, "peripheral_low_activity": 0.70,
    "airport_gateway": 1.10, "event_venue": 1.65,
}

VOLUME_SCALE = 0.30

VOLUME = {
    "cbd_commuter": 420, "residential_feeder": 265, "nightlife_evening": 195,
    "education_zone": 215, "market_retail": 305, "healthcare_institutional": 175,
    "industrial_shift": 245, "peripheral_low_activity": 55,
    "airport_gateway": 235, "event_venue": 150,
}

PED_RATIO = {
    "cbd_commuter": 2.00, "residential_feeder": 0.90, "nightlife_evening": 2.20,
    "education_zone": 1.60, "market_retail": 2.60, "healthcare_institutional": 1.50,
    "industrial_shift": 0.70, "peripheral_low_activity": 0.50,
    "airport_gateway": 0.55, "event_venue": 3.10,
}

DIRECTION = {
    "cbd_commuter": -1.0, "residential_feeder": 1.0, "nightlife_evening": 0.2,
    "education_zone": 1.0, "market_retail": -0.3, "healthcare_institutional": -0.2,
    "industrial_shift": 1.0, "peripheral_low_activity": 0.2,
    "airport_gateway": 0.0, "event_venue": 0.1,
}

DWELL_BASE = {
    "cbd_commuter": 22, "residential_feeder": 18, "nightlife_evening": 26,
    "education_zone": 20, "market_retail": 46, "healthcare_institutional": 35,
    "industrial_shift": 24, "peripheral_low_activity": 31,
    "airport_gateway": 14, "event_venue": 33,
}

SPEED_BASE = {
    "cbd_commuter": 14, "residential_feeder": 19, "nightlife_evening": 16,
    "education_zone": 15, "market_retail": 11, "healthcare_institutional": 16,
    "industrial_shift": 24, "peripheral_low_activity": 33,
    "airport_gateway": 39, "event_venue": 13,
}

ROUTE_COUNT = {
    "cbd_commuter": 11, "residential_feeder": 5, "nightlife_evening": 7,
    "education_zone": 4, "market_retail": 8, "healthcare_institutional": 5,
    "industrial_shift": 6, "peripheral_low_activity": 2,
    "airport_gateway": 4, "event_venue": 3,
}

# --------------------------------------------------------------------------
# City layout
# --------------------------------------------------------------------------
ZONES = [
    # name, lat, lon, spread_km, stop_count, archetype weights
    ("Majestic",        12.9767, 77.5713, 1.4, 26, {"cbd_commuter": .62, "market_retail": .28, "nightlife_evening": .10}),
    ("MG Road",         12.9756, 77.6065, 1.2, 22, {"cbd_commuter": .55, "market_retail": .25, "nightlife_evening": .20}),
    ("Koramangala",     12.9352, 77.6245, 2.0, 26, {"nightlife_evening": .38, "residential_feeder": .32, "market_retail": .18, "cbd_commuter": .12}),
    ("Indiranagar",     12.9719, 77.6412, 1.8, 24, {"nightlife_evening": .40, "residential_feeder": .35, "market_retail": .15, "cbd_commuter": .10}),
    ("Jayanagar",       12.9250, 77.5838, 2.0, 24, {"residential_feeder": .48, "market_retail": .22, "education_zone": .20, "healthcare_institutional": .10}),
    ("Malleshwaram",    13.0035, 77.5709, 1.8, 22, {"residential_feeder": .45, "education_zone": .22, "healthcare_institutional": .18, "market_retail": .15}),
    ("Basavanagudi",    12.9417, 77.5738, 1.6, 18, {"residential_feeder": .42, "education_zone": .25, "healthcare_institutional": .20, "market_retail": .13}),
    ("HSR Layout",      12.9121, 77.6446, 2.2, 22, {"residential_feeder": .55, "nightlife_evening": .18, "market_retail": .17, "education_zone": .10}),
    ("Banashankari",    12.9255, 77.5468, 2.4, 20, {"residential_feeder": .52, "healthcare_institutional": .20, "education_zone": .16, "market_retail": .12}),
    ("Whitefield",      12.9698, 77.7499, 2.6, 22, {"industrial_shift": .38, "residential_feeder": .32, "peripheral_low_activity": .18, "cbd_commuter": .12}),
    ("Electronic City", 12.8452, 77.6602, 2.4, 22, {"industrial_shift": .50, "residential_feeder": .22, "peripheral_low_activity": .20, "cbd_commuter": .08}),
    ("Marathahalli",    12.9591, 77.6974, 2.2, 20, {"industrial_shift": .30, "residential_feeder": .30, "market_retail": .22, "nightlife_evening": .18}),
    ("Hebbal",          13.0358, 77.5970, 2.2, 18, {"residential_feeder": .40, "peripheral_low_activity": .28, "healthcare_institutional": .18, "industrial_shift": .14}),
    ("Yeshwanthpur",    13.0242, 77.5540, 1.8, 18, {"industrial_shift": .42, "market_retail": .26, "residential_feeder": .22, "peripheral_low_activity": .10}),
    ("Yelahanka",       13.1007, 77.5963, 2.8, 16, {"peripheral_low_activity": .46, "residential_feeder": .34, "industrial_shift": .20}),
    ("Kengeri",         12.9060, 77.4850, 2.6, 16, {"peripheral_low_activity": .52, "residential_feeder": .30, "industrial_shift": .18}),
    ("Airport Road",    13.1986, 77.7066, 3.0, 20, {"airport_gateway": .52, "peripheral_low_activity": .26, "industrial_shift": .22}),
    ("Cubbon Park",     12.9763, 77.5929, 1.0, 18, {"event_venue": .40, "cbd_commuter": .32, "market_retail": .16, "nightlife_evening": .12}),
]

LANDMARKS = [
    "Bus Stand", "Market", "Cross", "Circle", "Layout", "Extension", "Gate",
    "Temple", "Hospital", "School", "College", "Metro", "Industrial Area",
    "Tech Park", "Signal", "Junction", "Kalyana Mantapa", "Playground",
    "Flyover", "Terminal",
]


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


# --------------------------------------------------------------------------
# 1) Stops
# --------------------------------------------------------------------------
def build_stops() -> pd.DataFrame:
    rows, sid = [], 1
    for zone, lat, lon, spread, count, weights in ZONES:
        names = list(weights.keys())
        probs = np.array([weights[n] for n in names], dtype=float)
        probs /= probs.sum()
        for i in range(count):
            arch = str(rng.choice(names, p=probs))
            ang = rng.uniform(0, 2 * np.pi)
            rad = abs(rng.normal(0, spread / 2.2))
            dlat = rad * np.cos(ang) / 111.0
            dlon = rad * np.sin(ang) / (111.0 * np.cos(np.radians(lat)))
            rows.append({
                "stop_id": f"S{sid:03d}",
                "stop_name": f"{zone} {LANDMARKS[(i * 7 + sid) % len(LANDMARKS)]}",
                "zone": zone,
                "lat": round(lat + dlat + rng.normal(0, .0012), 6),
                "lon": round(lon + dlon + rng.normal(0, .0012), 6),
                "shelter": bool(rng.random() < 0.45),
                "archetype_true": arch,  # ground truth, dropped before modelling
            })
            sid += 1
    df = pd.DataFrame(rows)
    df["stop_factor"] = np.exp(rng.normal(0, 0.28, len(df)))   # stop personality
    return df


# --------------------------------------------------------------------------
# 2) Routes + ordered stop sequences
# --------------------------------------------------------------------------
ROUTE_PAIRS = [
    ("Majestic", "Whitefield"), ("Majestic", "Electronic City"), ("Majestic", "Yelahanka"),
    ("Majestic", "Kengeri"), ("MG Road", "Marathahalli"), ("Majestic", "Hebbal"),
    ("Koramangala", "Yeshwanthpur"), ("Indiranagar", "Banashankari"),
    ("Jayanagar", "Hebbal"), ("HSR Layout", "Majestic"), ("Whitefield", "Electronic City"),
    ("Malleshwaram", "Marathahalli"), ("Basavanagudi", "Whitefield"),
    ("Yelahanka", "Electronic City"), ("Kengeri", "MG Road"), ("Banashankari", "Indiranagar"),
    ("Airport Road", "Majestic"), ("Airport Road", "Yeshwanthpur"), ("Airport Road", "Electronic City"),
    ("Cubbon Park", "Whitefield"), ("Cubbon Park", "Electronic City"), ("Cubbon Park", "Hebbal"),
    ("Marathahalli", "Kengeri"), ("Electronic City", "Koramangala"),
]


def build_routes(stops: pd.DataFrame):
    zone_xy = {z[0]: (z[1], z[2]) for z in ZONES}
    routes, route_stops = [], []
    for idx, (z1, z2) in enumerate(ROUTE_PAIRS, start=1):
        route_id = f"R{idx:02d}"
        (a_lat, a_lon), (b_lat, b_lon) = zone_xy[z1], zone_xy[z2]

        lat = stops["lat"].to_numpy(); lon = stops["lon"].to_numpy()
        vx, vy = b_lon - a_lon, b_lat - a_lat
        denom = vx * vx + vy * vy
        t = np.clip(((lon - a_lon) * vx + (lat - a_lat) * vy) / denom, 0, 1)
        proj_lat = a_lat + t * vy
        proj_lon = a_lon + t * vx
        dist = _haversine_km(lat, lon, proj_lat, proj_lon)
        mask = dist < 1.6
        if mask.sum() < 10:
            mask = dist < 2.4
        chosen = stops[mask].copy()
        chosen["t"] = t[mask]
        chosen = chosen.sort_values("t")
        keep = min(len(chosen), int(rng.integers(13, 22)))
        pick_idx = np.linspace(0, len(chosen) - 1, keep).round().astype(int)
        seq = chosen.iloc[sorted(set(pick_idx.tolist()))]

        n = len(seq)
        routes.append({
            "route_id": route_id,
            "route_name": f"{z1} - {z2}",
            "origin": z1, "destination": z2,
            "n_stops": n,
            "length_km": round(float(_haversine_km(a_lat, a_lon, b_lat, b_lon)) * 1.28, 2),
            "service_start": "05:30", "service_end": "23:30",
            "headway_min": int(rng.choice([5, 6, 8, 10, 12, 15])),
        })
        prev = None
        for s_i, (_, r) in enumerate(seq.iterrows(), start=1):
            leg = 0.0 if prev is None else float(_haversine_km(prev[0], prev[1], r["lat"], r["lon"]))
            route_stops.append({
                "route_id": route_id, "stop_seq": s_i, "stop_id": r["stop_id"],
                "leg_km": round(leg, 3),
            })
            prev = (r["lat"], r["lon"])
    return pd.DataFrame(routes), pd.DataFrame(route_stops)


# --------------------------------------------------------------------------
# 3) Fleet
# --------------------------------------------------------------------------
def build_fleet(routes: pd.DataFrame) -> pd.DataFrame:
    models = ["Tata Starbus", "Ashok Leyland Viking", "Volvo 8400", "BYD K7", "Eicher Skyline"]
    cams = ["Axis P3265", "Hikvision DS-2CD", "CP Plus 4MP", "Bosch NBE-3503"]
    rows = []
    for i in range(1, N_BUSES + 1):
        rid = str(routes.iloc[i % len(routes)]["route_id"])
        rows.append({
            "bus_id": f"B{i:03d}", "route_id": rid,
            "registration": f"KA01F{i*7 % 9000 + 1000}",
            "model": str(rng.choice(models)),
            "capacity": int(rng.choice([45, 52, 60, 70])),
            "camera_model": str(rng.choice(cams)),
            "camera_fps": int(rng.choice([15, 25, 30])),
            "gps_hz": 0.2,
            "depot": str(rng.choice(["Depot-North", "Depot-South", "Depot-East", "Depot-West"])),
        })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# 4) Daily context (weather, incidents, congestion)
# --------------------------------------------------------------------------
def build_daily_context() -> pd.DataFrame:
    rows = []
    d = START_DATE
    while d <= END_DATE:
        weekend = d.weekday() >= 5
        holiday = (d.month, d.day) in {(11, 1), (11, 10), (1, 1)}
        weather = str(rng.choice(["clear", "clear", "clear", "cloudy", "rain"], p=[.5, .2, .1, .13, .07]))
        city_speed = 24.0 + (3 if weekend else 0) + (6 if weather == "clear" else -4 if weather == "rain" else 1)
        rows.append({
            "date": d.isoformat(), "weekday": d.strftime("%a"),
            "is_weekend": weekend, "is_holiday": holiday, "weather": weather,
            "incidents": int(rng.poisson(2.4)),
            "avg_city_speed_kmh": round(float(city_speed + rng.normal(0, 1.4)), 1),
            "day_factor": round(float(np.clip(rng.normal(1.0, .07), .78, 1.22)), 3),
        })
        d += timedelta(days=1)
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# 5) Stop events + camera footfall (the two core feeds)
# --------------------------------------------------------------------------
def build_feeds(stops: pd.DataFrame, route_stops: pd.DataFrame,
                fleet: pd.DataFrame, ctx: pd.DataFrame):
    routes_at_stop = route_stops.groupby("stop_id")["route_id"].apply(lambda s: sorted(set(s))).to_dict()
    buses_by_route = fleet.groupby("route_id")["bus_id"].apply(list).to_dict()

    event_rows, cam_rows = [], []
    dates = list(pd.to_datetime(ctx["date"]))

    for _, s in stops.iterrows():
        arch = s["archetype_true"]
        profile = np.asarray(PROFILES[arch], dtype=float)
        base = VOLUME[arch] * VOLUME_SCALE * s["stop_factor"]
        routes_here = routes_at_stop.get(s["stop_id"], [])
        ped_ratio = PED_RATIO[arch] * np.exp(rng.normal(0, .18))
        two_w_ratio = float(rng.uniform(.15, .42))
        dwell_base = DWELL_BASE[arch] * np.exp(rng.normal(0, .12))
        speed_base = SPEED_BASE[arch] * np.exp(rng.normal(0, .10))
        direction = DIRECTION[arch]

        for d_i, dt in enumerate(dates):
            c = ctx.iloc[d_i]
            weekend = bool(c["is_weekend"])
            mult = WEEKEND_MULT[arch] if weekend else 1.0
            if c["is_holiday"]:
                mult *= 0.7
            if c["weather"] == "rain":
                mult *= 1.08
            day_mean = base * mult * float(c["day_factor"])
            hourly_mean = profile * day_mean

            for h in range(24):
                ped_mean = hourly_mean[h] * ped_ratio
                peds = int(rng.poisson(max(ped_mean, 0.1)))
                two_w = int(rng.poisson(max(peds * two_w_ratio * rng.uniform(.8, 1.2), .05)))
                veh = int(rng.poisson(max(peds * rng.uniform(.05, .12), .02)))
                cam_rows.append({
                    "stop_id": s["stop_id"], "date": dt.date().isoformat(), "hour": h,
                    "pedestrians": peds, "two_wheelers": two_w, "vehicles_stopped": veh,
                    "crowd_density_index": round(float(min(1.0, peds / 420.0) * rng.uniform(.9, 1.1)), 3),
                    "camera_confidence": round(float(np.clip(rng.normal(.93, .035), .70, .99)), 3),
                })

            daily_riders = float(hourly_mean.sum())
            n_visits = int(np.clip(round(daily_riders / 62.0), 6, 80))
            hour_p = hourly_mean / hourly_mean.sum()
            visit_hours = rng.choice(24, size=n_visits, p=hour_p)
            visit_hours.sort()

            occ = 0
            for vh in visit_hours:
                bus_pool = []
                for r in routes_here[:4]:
                    bus_pool.extend(buses_by_route.get(r, []))
                bus_id = str(rng.choice(bus_pool)) if bus_pool else "B000"
                per_hour_riders = max(hourly_mean[vh], 0.4)
                visits_in_hour = max(1, int((visit_hours == vh).sum()))
                board = int(rng.poisson(per_hour_riders / visits_in_hour))
                if vh < 11:
                    b_share = 0.5 + 0.28 * direction
                elif vh >= 17:
                    b_share = 0.5 - 0.26 * direction
                else:
                    b_share = 0.5
                board = int(np.clip(round(board * b_share * 2), 0, 90))
                alight = int(np.clip(round(board * (1 - b_share) / max(b_share, .08)), 0, 90))
                occ = int(np.clip(occ + board - alight + rng.integers(-3, 4), 0, 70))
                ts = datetime(dt.year, dt.month, dt.day, int(vh), int(rng.integers(0, 59)))
                speed = max(6.0, speed_base + rng.normal(0, 3.2) - (2.5 if c["weather"] == "rain" else 0))
                dwell = max(8.0, dwell_base + rng.normal(0, 5.5) + board * 0.22)
                event_rows.append({
                    "event_id": len(event_rows) + 1,
                    "stop_id": s["stop_id"], "bus_id": bus_id,
                    "route_id": routes_here[0] if routes_here else "R01",
                    "timestamp": ts.isoformat(sep=" "),
                    "date": dt.date().isoformat(), "hour": int(vh),
                    "boardings": board, "alightings": alight, "occupancy": occ,
                    "dwell_seconds": round(float(dwell), 1),
                    "approach_speed_kmh": round(float(speed), 1),
                    "schedule_deviation_s": int(rng.normal(0, 78)),
                    "weather": c["weather"],
                    "is_weekend": weekend,
                })

    return pd.DataFrame(event_rows), pd.DataFrame(cam_rows)


# --------------------------------------------------------------------------
# 6) Raw GPS trail sample
# --------------------------------------------------------------------------
def build_gps(stops: pd.DataFrame, route_stops: pd.DataFrame,
              fleet: pd.DataFrame, ctx: pd.DataFrame) -> pd.DataFrame:
    stop_lookup = stops.set_index("stop_id")[["lat", "lon", "archetype_true"]]
    route_coords = {}
    for rid, g in route_stops.sort_values("stop_seq").groupby("route_id"):
        route_coords[rid] = [(r["stop_id"], float(stop_lookup.loc[r["stop_id"], "lat"]),
                              float(stop_lookup.loc[r["stop_id"], "lon"]))
                             for _, r in g.iterrows()]

    rows = []
    for d_i in range(GPS_DAYS):
        dt = pd.to_datetime(ctx["date"]).iloc[d_i]
        for _, bus in fleet.iterrows():
            rid = str(bus["route_id"])
            coords = route_coords.get(rid, [])
            if len(coords) < 3:
                continue
            for trip in range(5):
                start = datetime(dt.year, dt.month, dt.day, 6 + trip * 3, int(rng.integers(0, 40)))
                cur = start
                fwd = trip % 2 == 0
                path = coords if fwd else list(reversed(coords))
                for seq in range(1, len(path)):
                    sid, la1, lo1 = path[seq - 1]
                    _, la2, lo2 = path[seq]
                    arch = stop_lookup.loc[sid, "archetype_true"]
                    v = max(7.0, SPEED_BASE[arch] + rng.normal(0, 4))
                    leg_km = float(_haversine_km(la1, lo1, la2, lo2))
                    travel_min = (leg_km / v) * 60
                    dwell_min = DWELL_BASE[arch] / 60.0
                    steps = max(1, int(travel_min / 1.0))
                    for k in range(steps):
                        frac = k / steps
                        cur = cur + timedelta(minutes=1)
                        rows.append({
                            "bus_id": bus["bus_id"], "route_id": rid,
                            "trip_id": f"{bus['bus_id']}-{dt.date()}-{trip}",
                            "timestamp": cur.isoformat(sep=" "),
                            "lat": round(la1 + (la2 - la1) * frac, 6),
                            "lon": round(lo1 + (lo2 - lo1) * frac, 6),
                            "speed_kmh": round(float(max(0, v + rng.normal(0, 3))), 1),
                            "heading_deg": int((np.degrees(np.arctan2(lo2 - lo1, la2 - la1)) + 360) % 360),
                            "next_stop_id": sid,
                            "satellites": int(rng.integers(7, 13)),
                            "occupancy_pct": int(np.clip(
                                rng.normal(45, 18) + (18 if 8 <= cur.hour <= 10 or 17 <= cur.hour <= 19 else 0),
                                2, 100)),
                            "delay_s": int(rng.normal(15, 85)),
                            "door_cycles": int(rng.integers(0, 4)),
                        })
                    cur = cur + timedelta(minutes=dwell_min)
    df = pd.DataFrame(rows)
    if len(df) > 520_000:
        df = df.iloc[::2].reset_index(drop=True)
    return df


def main():
    stops = build_stops()
    routes, route_stops = build_routes(stops)
    fleet = build_fleet(routes)
    ctx = build_daily_context()

    cov = route_stops.groupby("stop_id")["route_id"].nunique().rename("routes_served")
    stops = stops.merge(cov, left_on="stop_id", right_index=True, how="left")
    stops["routes_served"] = stops["routes_served"].fillna(1).astype(int)

    print("generating feeds ...")
    events, cam = build_feeds(stops, route_stops, fleet, ctx)
    print("generating gps sample ...")
    gps = build_gps(stops, route_stops, fleet, ctx)

    for name, df in [("stops", stops), ("routes", routes), ("route_stops", route_stops),
                     ("fleet", fleet), ("stop_events", events), ("camera_footfall", cam),
                     ("gps_pings", gps), ("daily_context", ctx)]:
        path = os.path.join(RAW, f"{name}.csv")
        df.to_csv(path, index=False)
        print(f"  {name:18s} {len(df):>9,} rows -> {path}")

    print(f"\nwindow: {START_DATE} .. {END_DATE} ({DAYS} days), {len(stops)} stops, "
          f"{len(routes)} routes, {len(fleet)} buses")


if __name__ == "__main__":
    main()
