#!/usr/bin/env python3
"""Pull 2026 MLB stats and write src/data.js for Full Count.

Sources: the MLB Stats API (statsapi.mlb.com) and Baseball Savant CSV
leaderboards. Raw responses are cached in data/raw/ so a rebuild works
offline; pass --refresh to download again.

Usage: python3 data/build_data.py [--refresh] [--season 2026]
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "src", "data.js")
API = "https://statsapi.mlb.com/api/v1/"
SAVANT = "https://baseballsavant.mlb.com/leaderboard/"

# Team colors (primary, secondary). Colors only: no logos or marks.
COLORS = {
    "ATH": ("#003831", "#EFB21E"), "PIT": ("#27251F", "#FDB827"), "SD": ("#2F241D", "#FFC425"),
    "SEA": ("#0C2C56", "#005C5C"), "SF": ("#FD5A1E", "#27251F"), "STL": ("#C41E3A", "#0C2340"),
    "TB": ("#092C5C", "#8FBCE6"), "TEX": ("#003278", "#C0111F"), "TOR": ("#134A8E", "#E8291C"),
    "MIN": ("#002B5C", "#D31145"), "PHI": ("#E81828", "#002D72"), "ATL": ("#CE1141", "#13274F"),
    "CWS": ("#27251F", "#C4CED4"), "MIA": ("#00A3E0", "#EF3340"), "NYY": ("#0C2340", "#C4CED3"),
    "MIL": ("#12284B", "#FFC52F"), "LAA": ("#BA0021", "#003263"), "AZ": ("#A71930", "#E3D4AD"),
    "BAL": ("#DF4601", "#27251F"), "BOS": ("#BD3039", "#0C2340"), "CHC": ("#0E3386", "#CC3433"),
    "CIN": ("#C6011F", "#27251F"), "CLE": ("#00385D", "#E50022"), "COL": ("#333366", "#C4CED4"),
    "DET": ("#0C2340", "#FA4616"), "HOU": ("#002D62", "#EB6E1F"), "KC": ("#004687", "#BD9B60"),
    "LAD": ("#005A9C", "#EF3E42"), "WSH": ("#AB0003", "#14225A"), "NYM": ("#002D72", "#FF5910"),
}

# Stabilization samples used to regress rates toward the league (PA or BF).
REG_HIT = {"k": 60, "bb": 120, "hbp": 240, "hr": 170, "babip": 820, "xbh": 600, "single": 300}
REG_PIT = {"k": 70, "bb": 170, "hbp": 300, "hr": 1300, "babip": 2000, "gb": 100}

PITCH_NAMES = {
    "FF": "4-Seam", "SI": "Sinker", "FC": "Cutter", "SL": "Slider", "ST": "Sweeper",
    "CU": "Curveball", "KC": "Knuckle Curve", "CS": "Slow Curve", "CH": "Changeup",
    "FS": "Splitter", "FO": "Forkball", "SC": "Screwball", "KN": "Knuckleball",
    "SV": "Slurve", "EP": "Eephus",
}
FAMILY = {"FF": "FB", "SI": "FB", "FC": "FB", "SL": "BR", "ST": "BR", "CU": "BR", "KC": "BR",
          "CS": "BR", "SV": "BR", "CH": "OS", "FS": "OS", "FO": "OS", "SC": "OS", "KN": "OS", "EP": "OS"}
TWO_WAY_OFFSET = 10_000_000  # a two-way player's pitching half: id + offset, linked by "twoWay"
SPEED_COL = {"FF": "ff", "SI": "si", "FC": "fc", "SL": "sl", "ST": "st", "CU": "cu", "KC": "cu",
             "CH": "ch", "FS": "fs", "FO": "fs", "KN": "kn", "SV": "sv"}


# ---------------------------------------------------------------- fetching

def fetch(url, name, refresh):
    path = os.path.join(RAW, name)
    if os.path.exists(path) and not refresh:
        with open(path, "rb") as f:
            return f.read()
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "full-count-data/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
            os.makedirs(RAW, exist_ok=True)
            with open(path, "wb") as f:
                f.write(body)
            return body
        except Exception as e:  # network hiccup: back off and retry
            last = e
            time.sleep(2 ** attempt)
    raise SystemExit(f"Could not fetch {url}: {last}")


def api(path, name, refresh):
    return json.loads(fetch(API + path, name, refresh))


def savant(path, name, refresh):
    text = fetch(SAVANT + path, name, refresh).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def num(x, default=0.0):
    try:
        if x is None or x == "" or x in (".---", "-.--"):
            return default
        return float(x)
    except ValueError:
        return default


def ip_to_float(s):
    whole, _, part = str(s).partition(".")
    return int(whole or 0) + int(part or 0) / 3


# ---------------------------------------------------------------- helpers

def regress(count, n, lg, prior):
    """Rate with `prior` league-average observations mixed in."""
    return (count + lg * prior) / (n + prior) if n + prior > 0 else lg


def percentile_rank(values, x):
    """Fraction of values below x (ties count half), in 0..1."""
    if not values:
        return 0.5
    lo = sum(1 for v in values if v < x)
    eq = sum(1 for v in values if v == x)
    return (lo + 0.5 * eq) / len(values)


def quantiles(values, invert=False):
    """101 points: value at percentile 0..100. invert: high rating = low value."""
    v = sorted(values)
    if invert:
        v = v[::-1]
    out = []
    for i in range(101):
        pos = i / 100 * (len(v) - 1)
        a = int(math.floor(pos))
        b = min(a + 1, len(v) - 1)
        out.append(round(v[a] + (v[b] - v[a]) * (pos - a), 5))
    return out


def rating_from(values, x, invert=False):
    p = percentile_rank(values, x)
    if invert:
        p = 1 - p
    return max(1.0, min(99.0, 1 + 98 * p))


def iv_for(pid, stat):
    h = hashlib.sha256(f"{pid}:{stat}".encode()).digest()
    return h[0] % 32


def blend(a, b, wa=1.0, wb=0.5):
    """Blend two (count, n) pairs as weighted sums."""
    return a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb


# ---------------------------------------------------------------- main build

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="download again instead of using data/raw")
    ap.add_argument("--season", type=int, default=2026)
    args = ap.parse_args()
    S, P = args.season, args.season - 1
    R = args.refresh

    print(f"Pulling {S} (blended with {P})...")
    season_info = api(f"seasons/{S}?sportId=1", f"season_{S}.json", R)["seasons"][0]
    teams_raw = api(f"teams?sportId=1&season={S}", f"teams_{S}.json", R)["teams"]

    def season_stats(group, year):
        d = api(f"stats?stats=season&group={group}&season={year}&sportId=1&playerPool=all&limit=5000",
                f"{group}_{year}.json", R)
        return {s["player"]["id"]: s for s in d["stats"][0]["splits"]}

    hit = {S: season_stats("hitting", S), P: season_stats("hitting", P)}
    pit = {S: season_stats("pitching", S), P: season_stats("pitching", P)}
    fld = api(f"stats?stats=season&group=fielding&season={S}&sportId=1&playerPool=all&limit=8000",
              f"fielding_{S}.json", R)["stats"][0]["splits"]
    sprp = {}
    for year in (S, P):
        d = api(f"stats?stats=statSplits&sitCodes=sp,rp&group=pitching&season={year}&sportId=1&playerPool=all&limit=5000",
                f"sprp_{year}.json", R)
        for s in d["stats"][0]["splits"]:
            sprp.setdefault((year, s["player"]["id"]), {})[s["split"]["code"]] = s["stat"]
    team_hit = api(f"teams/stats?stats=season&group=hitting&season={S}&sportId=1", f"teamhit_{S}.json", R)

    def sv_year(year):
        q = "&csv=true"
        return {
            "speed": savant(f"pitch-arsenals?year={year}&min=1&type=avg_speed&hand={q}", f"sv_speed_{year}.csv", R),
            "pas": savant(f"pitch-arsenal-stats?type=pitcher&pitchType=&year={year}&team=&min=1{q}", f"sv_pas_{year}.csv", R),
            "sprint": savant(f"sprint_speed?year={year}&position=&team=&min=0{q}", f"sv_sprint_{year}.csv", R),
            "oaa": savant(f"outs_above_average?type=Fielder&startYear={year}&endYear={year}&split=no&team=&range=year&min=0&pos=&roles=&viz=hide{q}",
                          f"sv_oaa_{year}.csv", R),
            "xbat": savant(f"expected_statistics?type=batter&year={year}&position=&team=&min=1{q}", f"sv_xbat_{year}.csv", R),
            "xpit": savant(f"expected_statistics?type=pitcher&year={year}&position=&team=&min=1{q}", f"sv_xpit_{year}.csv", R),
            "cbat": savant(f"custom?year={year}&type=batter&filter=&min=1&selections=pa,barrel_batted_rate,groundballs_percent,"
                           f"flyballs_percent,linedrives_percent,popups_percent,pull_percent,hard_hit_percent&chart=false&x=pa&y=pa"
                           f"&r=no&chartType=beeswarm&sort=pa&sortDir=desc{q}", f"sv_cbat_{year}.csv", R),
            "cpit": savant(f"custom?year={year}&type=pitcher&filter=&min=1&selections=pa,groundballs_percent,flyballs_percent,"
                           f"linedrives_percent,popups_percent,hard_hit_percent&chart=false&x=pa&y=pa&r=no&chartType=beeswarm"
                           f"&sort=pa&sortDir=desc{q}", f"sv_cpit_{year}.csv", R),
            "pop": savant(f"poptime?year={year}&team=&min2b=1&min3b=0{q}", f"sv_pop_{year}.csv", R),
        }

    sv = {S: sv_year(S), P: sv_year(P)}

    def by_id(rows, key="player_id"):
        out = {}
        for r in rows:
            try:
                out[int(r[key])] = r
            except (KeyError, ValueError):
                pass
        return out

    svi = {}
    for y in (S, P):
        svi[y] = {
            "speed": by_id(sv[y]["speed"], "pitcher"),
            "sprint": by_id(sv[y]["sprint"]),
            "oaa": by_id(sv[y]["oaa"]),
            "xbat": by_id(sv[y]["xbat"]),
            "xpit": by_id(sv[y]["xpit"]),
            "cbat": by_id(sv[y]["cbat"]),
            "cpit": by_id(sv[y]["cpit"]),
            "pop": by_id(sv[y]["pop"], "entity_id"),
        }
        pas = {}
        for r in sv[y]["pas"]:
            pas.setdefault(int(r["player_id"]), []).append(r)
        svi[y]["pas"] = pas

    # Rosters: the 40-man roster of each team now (offseason-safe).
    teams = []
    roster = {}
    for t in sorted(teams_raw, key=lambda t: t["abbreviation"]):
        ab = t["abbreviation"]
        r = api(f"teams/{t['id']}/roster?rosterType=40Man&season={S}", f"roster_{ab}_{S}.json", R).get("roster", [])
        for e in r:
            roster[e["person"]["id"]] = t["id"]
        teams.append({
            "id": t["id"], "abbr": ab, "name": t["name"], "short": t["clubName"] if t.get("clubName") else t["teamName"],
            "city": t.get("franchiseName", t["name"]), "league": t["league"]["name"].replace(" League", ""),
            "division": t["division"]["name"], "colors": list(COLORS.get(ab, ("#334155", "#cbd5e1"))),
        })
    team_by_id = {t["id"]: t for t in teams}

    # People: handedness and primary position.
    ids = set(hit[S]) | set(pit[S]) | set(hit[P]) | set(pit[P]) | set(roster)
    people = {}
    idl = sorted(ids)
    for i in range(0, len(idl), 150):
        chunk = idl[i:i + 150]
        d = api("people?personIds=" + ",".join(map(str, chunk)), f"people_{i // 150}.json", R)
        for p in d.get("people", []):
            people[p["id"]] = p

    # Positions played (games by position) for the current season.
    pos_games = {}
    for s in fld:
        pid = s["player"]["id"]
        ab = s["position"]["abbreviation"]
        pos_games.setdefault(pid, {})
        pos_games[pid][ab] = pos_games[pid].get(ab, 0) + int(s["stat"].get("games", 0) or 0)

    # ------------------------------------------------------------ league
    lg_tot = {}
    for s in hit[S].values():
        st = s["stat"]
        for k in ("plateAppearances", "atBats", "hits", "doubles", "triples", "homeRuns", "strikeOuts", "baseOnBalls",
                  "intentionalWalks", "hitByPitch", "sacFlies", "sacBunts", "stolenBases", "caughtStealing",
                  "numberOfPitches", "groundIntoDoublePlay", "totalBases"):
            lg_tot[k] = lg_tot.get(k, 0) + num(st.get(k))
    PA = lg_tot["plateAppearances"]
    singles = lg_tot["hits"] - lg_tot["doubles"] - lg_tot["triples"] - lg_tot["homeRuns"]
    bip = lg_tot["atBats"] - lg_tot["strikeOuts"] - lg_tot["homeRuns"] + lg_tot["sacFlies"]
    tg = team_hit["stats"][0]["splits"]
    games = sum(x["stat"]["gamesPlayed"] for x in tg)
    runs = sum(x["stat"]["runs"] for x in tg)
    lg = {
        "pa": PA,
        "k": lg_tot["strikeOuts"] / PA,
        "bb": lg_tot["baseOnBalls"] / PA,
        "ibb": lg_tot["intentionalWalks"] / PA,
        "hbp": lg_tot["hitByPitch"] / PA,
        "hr": lg_tot["homeRuns"] / PA,
        "single": singles / PA,
        "double": lg_tot["doubles"] / PA,
        "triple": lg_tot["triples"] / PA,
        "babip": (lg_tot["hits"] - lg_tot["homeRuns"]) / bip,
        "avg": lg_tot["hits"] / lg_tot["atBats"],
        "obp": (lg_tot["hits"] + lg_tot["baseOnBalls"] + lg_tot["hitByPitch"]) /
               (lg_tot["atBats"] + lg_tot["baseOnBalls"] + lg_tot["hitByPitch"] + lg_tot["sacFlies"]),
        "slg": lg_tot["totalBases"] / lg_tot["atBats"],
        "sbPct": lg_tot["stolenBases"] / max(1, lg_tot["stolenBases"] + lg_tot["caughtStealing"]),
        "sbAtt": (lg_tot["stolenBases"] + lg_tot["caughtStealing"]) / max(1, singles + lg_tot["baseOnBalls"] + lg_tot["hitByPitch"]),
        "pitchesPerPA": lg_tot["numberOfPitches"] / PA,
        "runsPerGame": runs / games,
        "runsPer6": runs / games * 6 / 9,
        "gidp": lg_tot["groundIntoDoublePlay"] / PA,
        "sbAttPerG": (lg_tot["stolenBases"] + lg_tot["caughtStealing"]) / games,
        "sf": lg_tot["sacFlies"] / PA,
    }
    # Batted-ball mix and wOBA from Savant, weighted by PA.
    def wavg(rows, field, wfield="pa"):
        sw = sum(num(r.get(wfield)) for r in rows if r.get(field) not in (None, ""))
        return sum(num(r.get(field)) * num(r.get(wfield)) for r in rows if r.get(field) not in (None, "")) / max(1, sw)
    cb = sv[S]["cbat"]
    for f, k in (("groundballs_percent", "gb"), ("flyballs_percent", "fb"), ("linedrives_percent", "ld"), ("popups_percent", "pu")):
        lg[k] = wavg(cb, f) / 100
    tot = lg["gb"] + lg["fb"] + lg["ld"] + lg["pu"]
    for k in ("gb", "fb", "ld", "pu"):
        lg[k] /= tot
    lg["woba"] = wavg(sv[S]["xbat"], "woba")
    lg["xwoba"] = wavg(sv[S]["xbat"], "est_woba")
    lg["pull"] = wavg(cb, "pull_percent") / 100
    lg["barrel"] = wavg(cb, "barrel_batted_rate") / 100
    sp_vals = [num(r.get("sprint_speed")) for r in sv[S]["sprint"] if r.get("sprint_speed")]
    lg["sprint"] = sum(sp_vals) / max(1, len(sp_vals))
    # Pitcher-side extras.
    ptot = {"wp": 0, "bk": 0, "bf": 0, "pk": 0, "sb": 0, "cs": 0}
    for s in pit[S].values():
        st = s["stat"]
        ptot["wp"] += num(st.get("wildPitches")); ptot["bk"] += num(st.get("balks"))
        ptot["bf"] += num(st.get("battersFaced")); ptot["pk"] += num(st.get("pickoffs"))
    lg["wp"] = ptot["wp"] / ptot["bf"]
    lg["balk"] = ptot["bk"] / ptot["bf"]
    lg["pickoff"] = ptot["pk"] / ptot["bf"]
    pas_all = [r for rows in svi[S]["pas"].values() for r in rows]
    lg["whiff"] = sum(num(r["whiff_percent"]) * num(r["pitches"]) for r in pas_all) / max(1, sum(num(r["pitches"]) for r in pas_all)) / 100

    # ------------------------------------------------------------ hitters
    def hit_counts(st):
        pa = num(st.get("plateAppearances"))
        h, d2, d3, hr = num(st.get("hits")), num(st.get("doubles")), num(st.get("triples")), num(st.get("homeRuns"))
        ab, so, sf = num(st.get("atBats")), num(st.get("strikeOuts")), num(st.get("sacFlies"))
        return {
            "pa": pa, "k": so, "bb": num(st.get("baseOnBalls")), "hbp": num(st.get("hitByPitch")), "hr": hr,
            "single": h - d2 - d3 - hr, "double": d2, "triple": d3, "h": h, "ab": ab, "sf": sf,
            "bip": max(0.0, ab - so - hr + sf), "sb": num(st.get("stolenBases")), "cs": num(st.get("caughtStealing")),
            "ibb": num(st.get("intentionalWalks")), "g": num(st.get("gamesPlayed")), "tb": num(st.get("totalBases")),
            "rbi": num(st.get("rbi")),
        }

    hitters = {}
    hitter_ids = set()
    for pid in set(hit[S]) | set(roster):
        if pid in hit[S] and num(hit[S][pid]["stat"].get("plateAppearances")) >= 150:
            hitter_ids.add(pid)
    # Injured: on a 40-man roster, under 150 PA this year but 150+ last year.
    injured_h = set()
    for pid, tid in roster.items():
        if pid in hitter_ids:
            continue
        pa26 = num(hit[S].get(pid, {}).get("stat", {}).get("plateAppearances")) if pid in hit[S] else 0
        if pid in hit[P] and num(hit[P][pid]["stat"].get("plateAppearances")) >= 150 and pa26 < 150:
            pos = people.get(pid, {}).get("primaryPosition", {}).get("abbreviation", "")
            if pos not in ("P",):
                hitter_ids.add(pid)
                injured_h.add(pid)

    def hitter_rates(pid):
        c26 = hit_counts(hit[S][pid]["stat"]) if pid in hit[S] else hit_counts({})
        c25 = hit_counts(hit[P][pid]["stat"]) if pid in hit[P] else hit_counts({})
        w26, w25 = 1.0, 0.5
        if pid in injured_h:
            w26, w25 = 0.5, 1.0
        def bl(k, nk="pa"):
            return c26[k] * w26 + c25[k] * w25, c26[nk] * w26 + c25[nk] * w25
        k, n = bl("k"); kr = regress(k, n, lg["k"], REG_HIT["k"])
        b, n = bl("bb"); bbr = regress(b, n, lg["bb"], REG_HIT["bb"])
        h_, n = bl("hbp"); hbpr = regress(h_, n, lg["hbp"], REG_HIT["hbp"])
        hr, n = bl("hr"); hrr = regress(hr, n, lg["hr"], REG_HIT["hr"])
        s1, n = bl("single"); s1r = regress(s1, n, lg["single"], REG_HIT["single"])
        d2, n = bl("double"); d2r = regress(d2, n, lg["double"], REG_HIT["xbh"])
        d3, n = bl("triple"); d3r = regress(d3, n, lg["triple"], REG_HIT["xbh"])
        hb, nb = bl("h", "bip")
        hb = hb - (c26["hr"] * w26 + c25["hr"] * w25)
        babip = regress(hb, nb, lg["babip"], REG_HIT["babip"])
        sb, _ = bl("sb"); cs, _ = bl("cs")
        on1 = (c26["single"] + c26["bb"] + c26["hbp"]) * w26 + (c25["single"] + c25["bb"] + c25["hbp"]) * w25
        att = regress(sb + cs, on1, lg["sbAtt"], 60)
        sbp = regress(sb, sb + cs, lg["sbPct"], 20)
        return {
            "k": kr, "bb": bbr, "hbp": hbpr, "hr": hrr, "single": s1r, "double": d2r, "triple": d3r, "babip": babip,
            "sbAtt": att, "sbPct": sbp, "pa26": c26["pa"], "pa25": c25["pa"], "c26": c26,
        }

    def sv_get(kind, pid, field, default=None):
        for y in (S, P):
            r = svi[y][kind].get(pid)
            if r and r.get(field) not in (None, ""):
                return num(r[field])
        return default

    hrows = {}
    for pid in hitter_ids:
        hr = hitter_rates(pid)
        c = hr["c26"] if pid not in injured_h else hit_counts(hit[P][pid]["stat"])
        bb_mix = {}
        for f, k in (("groundballs_percent", "gb"), ("flyballs_percent", "fb"), ("linedrives_percent", "ld"), ("popups_percent", "pu")):
            v = sv_get("cbat", pid, f)
            bb_mix[k] = (v / 100) if v is not None else lg[k]
        t = sum(bb_mix.values()) or 1
        for k in bb_mix:  # regress batted-ball mix lightly toward league
            bb_mix[k] = 0.85 * bb_mix[k] / t + 0.15 * lg[k]
        hrows[pid] = {
            **hr, "mix": bb_mix,
            "pull": (sv_get("cbat", pid, "pull_percent", lg["pull"] * 100) or lg["pull"] * 100) / 100,
            "barrel": (sv_get("cbat", pid, "barrel_batted_rate", lg["barrel"] * 100) or 0) / 100,
            "sprint": sv_get("sprint", pid, "sprint_speed", None),
            "oaa": sv_get("oaa", pid, "outs_above_average", None),
            "woba": sv_get("xbat", pid, "woba", None),
            "xwoba": sv_get("xbat", pid, "est_woba", None),
            "pop": sv_get("pop", pid, "pop_2b_sba", None),
            "disp": c,
        }

    # Hitter rating pools (qualified hitters only).
    pool = [hrows[p] for p in hrows]
    def col(f):
        return [f(h) for h in pool]
    sprint_default = lambda h: h["sprint"] if h["sprint"] is not None else max(24.5, min(29.5, lg["sprint"] + (h["sbAtt"] - lg["sbAtt"]) * 25))
    H_STATS = {
        "contact": (lambda h: h["k"], True),
        "power": (lambda h: h["hr"], False),
        "eye": (lambda h: h["bb"], False),
        "gap": (lambda h: h["double"] + h["triple"], False),
        "speed": (sprint_default, False),
        "fielding": (lambda h: h["oaa"] if h["oaa"] is not None else 0.0, False),
    }
    hq = {k: quantiles(col(f), inv) for k, (f, inv) in H_STATS.items()}
    hvals = {k: col(f) for k, (f, inv) in H_STATS.items()}
    # Catchers: fielding from pop time (lower is better) since OAA skips them.
    pops = [h["pop"] for h in pool if h["pop"]]

    # ------------------------------------------------------------ pitchers
    def pit_counts(st):
        bf = num(st.get("battersFaced"))
        h, hr, so = num(st.get("hits")), num(st.get("homeRuns")), num(st.get("strikeOuts"))
        ab, sf = num(st.get("atBats")), num(st.get("sacFlies"))
        return {
            "bf": bf, "k": so, "bb": num(st.get("baseOnBalls")), "hbp": num(st.get("hitBatsmen")), "hr": hr,
            "h": h, "bip": max(0.0, ab - so - hr + sf), "ip": ip_to_float(st.get("inningsPitched", "0")),
            "g": num(st.get("gamesPitched")), "gs": num(st.get("gamesStarted")), "sv": num(st.get("saves")),
            "hld": num(st.get("holds")), "np": num(st.get("numberOfPitches")), "go": num(st.get("groundOuts")),
            "ao": num(st.get("airOuts")), "w": num(st.get("wins")), "l": num(st.get("losses")),
            "er": num(st.get("earnedRuns")), "sb": num(st.get("stolenBases")), "cs": num(st.get("caughtStealing")),
            "pk": num(st.get("pickoffs")), "wp": num(st.get("wildPitches")),
        }

    def qualifies_p(st):
        c = pit_counts(st)
        return c["ip"] >= 30 or (c["g"] - c["gs"]) >= 20

    pitcher_ids = {pid for pid in pit[S] if qualifies_p(pit[S][pid]["stat"])}
    injured_p = set()
    for pid in roster:
        if pid in pitcher_ids:
            continue
        if pid in pit[P] and qualifies_p(pit[P][pid]["stat"]):
            c26 = pit_counts(pit[S][pid]["stat"]) if pid in pit[S] else None
            if not c26 or c26["ip"] < 30:
                pitcher_ids.add(pid)
                injured_p.add(pid)
    # Two-way players stay hitters too; a pure position player who pitched mop-up is not a pitcher.
    pitcher_ids = {p for p in pitcher_ids if people.get(p, {}).get("primaryPosition", {}).get("abbreviation") in ("P", "TWP")
                   or p not in hitter_ids}

    def pitch_list(pid):
        rows = None
        year = None
        for y in (S, P):
            if svi[y]["pas"].get(pid):
                rows, year = svi[y]["pas"][pid], y
                break
        if not rows:
            return []
        sp = svi[year]["speed"].get(pid, {})
        out = []
        for r in rows:
            code = r["pitch_type"]
            col_ = SPEED_COL.get(code)
            velo = num(sp.get(f"{col_}_avg_speed")) if col_ else 0
            if not velo:
                velo = {"FF": 94, "SI": 93.5, "FC": 89, "SL": 85, "ST": 82, "CU": 79, "KC": 82, "CH": 86, "FS": 87,
                        "FO": 85, "KN": 76, "SV": 81, "SC": 80, "EP": 60, "CS": 72}.get(code, 85)
            out.append({
                "code": code, "usage": num(r["pitch_usage"]) / 100, "velo": round(velo, 1),
                "whiff": num(r["whiff_percent"]) / 100, "rv100": num(r["run_value_per_100"]),
                "pitches": num(r["pitches"]), "woba": num(r["woba"], 0.32),
            })
        out.sort(key=lambda x: -x["usage"])
        return out

    prows = {}
    for pid in pitcher_ids:
        w26, w25 = (0.5, 1.0) if pid in injured_p else (1.0, 0.5)
        c26 = pit_counts(pit[S][pid]["stat"]) if pid in pit[S] else pit_counts({})
        c25 = pit_counts(pit[P][pid]["stat"]) if pid in pit[P] else pit_counts({})
        def bl(k, nk="bf"):
            return c26[k] * w26 + c25[k] * w25, c26[nk] * w26 + c25[nk] * w25
        k, n = bl("k"); kr = regress(k, n, lg["k"], REG_PIT["k"])
        b, n = bl("bb"); bbr = regress(b, n, lg["bb"], REG_PIT["bb"])
        h_, n = bl("hbp"); hbpr = regress(h_, n, lg["hbp"], REG_PIT["hbp"])
        hr, n = bl("hr"); hrr = regress(hr, n, lg["hr"], REG_PIT["hr"])
        hb, nb = bl("h", "bip")
        hb -= c26["hr"] * w26 + c25["hr"] * w25
        babip = regress(hb, nb, lg["babip"], REG_PIT["babip"])
        wp, n = bl("wp"); wpr = regress(wp, n, lg["wp"], 400)
        mix = {}
        for f, kk in (("groundballs_percent", "gb"), ("flyballs_percent", "fb"), ("linedrives_percent", "ld"), ("popups_percent", "pu")):
            v = None
            for y in (S, P):
                r = svi[y]["cpit"].get(pid)
                if r and r.get(f) not in (None, ""):
                    v = num(r[f]) / 100
                    break
            mix[kk] = v if v is not None else lg[kk]
        t = sum(mix.values()) or 1
        for kk in mix:
            mix[kk] = 0.8 * mix[kk] / t + 0.2 * lg[kk]
        # Pitches per start and per relief appearance.
        def per(code):
            tot_np, tot_g = 0.0, 0.0
            for y, w in ((S, w26), (P, w25)):
                s = sprp.get((y, pid), {}).get(code)
                if s:
                    gcount = num(s.get("gamesStarted")) if code == "sp" else num(s.get("gamesPitched"))
                    tot_np += num(s.get("numberOfPitches")) * w
                    tot_g += gcount * w
            return tot_np / tot_g if tot_g >= 2 else None
        pps, ppr = per("sp"), per("rp")
        disp = c26 if pid not in injured_p else c25
        gs_share = (c26["gs"] * w26 + c25["gs"] * w25) / max(1, c26["g"] * w26 + c25["g"] * w25)
        role = "SP" if gs_share >= 0.5 and (pps or 0) >= 60 else "RP"
        if role == "RP" and disp["sv"] >= 10:
            role = "CL"
        if pps is None and ppr is None:
            npg = (c26["np"] * w26 + c25["np"] * w25) / max(1, c26["g"] * w26 + c25["g"] * w25)
            pps = ppr = npg
        budget = pps if role == "SP" else (ppr or pps)
        budget = max(12, min(105, budget or 18))
        pitches = pitch_list(pid)
        prows[pid] = {
            "k": kr, "bb": bbr, "hbp": hbpr, "hr": hrr, "babip": babip, "wp": wpr, "mix": mix,
            "role": role, "budget": budget, "pps": pps, "ppr": ppr, "pitches": pitches, "disp": disp,
            "woba": sv_get("xpit", pid, "woba", None), "xwoba": sv_get("xpit", pid, "est_woba", None),
            "hold": regress(c26["sb"] + c25["sb"] * 0.5, (c26["sb"] + c26["cs"] + c26["pk"]) + (c25["sb"] + c25["cs"] + c25["pk"]) * 0.5, lg["sbPct"], 25),
        }

    ppool = list(prows.values())
    P_STATS = {
        "stuff": (lambda p: p["k"], False),
        "control": (lambda p: p["bb"], True),
        "movement": (lambda p: 0.5 * (p["mix"]["gb"] - lg["gb"]) / 0.06 - 0.5 * (p["hr"] - lg["hr"]) / 0.008, False),
        "stamina": (lambda p: p["budget"], False),
    }
    pq = {k: quantiles([f(p) for p in ppool], inv) for k, (f, inv) in P_STATS.items()}
    pvals = {k: [f(p) for p in ppool] for k, (f, inv) in P_STATS.items()}
    pq["gb"] = quantiles([p["mix"]["gb"] for p in ppool])
    pq["hrAllowed"] = quantiles([p["hr"] for p in ppool], True)
    # Per-pitch stuff: whiff and run value against all pitches with 150+ thrown.
    all_p = [x for p in ppool for x in p["pitches"] if x["pitches"] >= 150]
    wmean = sum(x["whiff"] for x in all_p) / len(all_p)
    wsd = (sum((x["whiff"] - wmean) ** 2 for x in all_p) / len(all_p)) ** 0.5
    rmean = sum(x["rv100"] for x in all_p) / len(all_p)
    rsd = (sum((x["rv100"] - rmean) ** 2 for x in all_p) / len(all_p)) ** 0.5
    def pscore(x):
        return 0.6 * (x["whiff"] - wmean) / wsd + 0.4 * (x["rv100"] - rmean) / rsd
    pscores = [pscore(x) for x in all_p]
    pq["pitchWhiff"] = quantiles([x["whiff"] for x in all_p])

    # ------------------------------------------------------------ types
    TYPE_ORDER = ["Grinder", "Fireballer", "Table Setter", "Speedster", "Spray Hitter", "Closer", "Slugger",
                  "Junkballer", "Gold Glove", "Launcher", "Crafty", "Pest", "Curveballer", "Knuckleballer",
                  "Franchise", "Intimidator", "Workhorse", "Lucky Charm"]
    woba_q = sorted([h["woba"] for h in pool if h["woba"] is not None and h["pa26"] + h["pa25"] * 0.5 >= 400])
    woba_cut = woba_q[int(len(woba_q) * 0.94)] if woba_q else 1
    kbb_pool = [(p["k"] - p["bb"]) for pid, p in prows.items()
                if p["disp"]["ip"] >= 60 or (p["disp"]["g"] - p["disp"]["gs"]) >= 40]
    kbb_cut = sorted(kbb_pool)[int(len(kbb_pool) * 0.94)] if kbb_pool else 1
    hbp_cut = sorted([p["hbp"] for p in ppool])[int(len(ppool) * 0.90)]
    pps_cut = sorted([p["pps"] for p in ppool if p["role"] == "SP" and p["pps"]])
    pps_cut = pps_cut[int(len(pps_cut) * 0.85)] if pps_cut else 100

    def top_types(cands):
        cands = [c for c in cands if c[1] > 0]
        cands.sort(key=lambda c: -c[1])
        picked = cands[:2]
        if not picked:
            return ["Grinder"], ["Grinder · no standout tool"]
        return [c[0] for c in picked], [f"{c[0]} · {c[2]}" for c in picked]

    def hitter_types(pid, h, ratings):
        d = h["disp"]
        c = []
        obp = (d["h"] + d["bb"] + d["hbp"]) / max(1, d["ab"] + d["bb"] + d["hbp"] + d["sf"])
        bbp = d["bb"] / max(1, d["pa"])
        if bbp >= 0.11 and obp >= 0.340:
            c.append(("Table Setter", (bbp - 0.11) / 0.03 + (obp - 0.34) / 0.03 + 0.2, f"{bbp:.1%} BB, .{int(round(obp * 1000)):03d} OBP"))
        spd = h["sprint"] or 0
        if spd >= 29.0 or d["sb"] >= 25:
            c.append(("Speedster", max((spd - 29.0) / 0.6, (d["sb"] - 25) / 10) + 0.2, f"{spd:.1f} ft/s, {int(d['sb'])} SB" if spd else f"{int(d['sb'])} SB"))
        kp = d["k"] / max(1, d["pa"])
        if h["pull"] < 0.37 and kp < 0.20:
            c.append(("Spray Hitter", (0.37 - h["pull"]) / 0.04 + (0.20 - kp) / 0.04 + 0.1, f"{h['pull']:.0%} pull, {kp:.0%} K"))
        if ratings["power"] >= 85:
            c.append(("Slugger", (ratings["power"] - 85) / 5 + 0.5, f"{int(d['hr'])} HR"))
        if (h["oaa"] or 0) >= 8:
            c.append(("Gold Glove", (h["oaa"] - 8) / 4 + 0.3, f"+{int(h['oaa'])} OAA"))
        hr600 = d["hr"] / max(1, d["pa"]) * 600
        fbp = h["mix"]["fb"]
        if h["barrel"] >= 0.12 or (fbp >= 0.45 and hr600 >= 20):
            c.append(("Launcher", max((h["barrel"] - 0.12) / 0.03, (fbp - 0.45) / 0.04) + 0.25, f"{h['barrel']:.0%} barrels"))
        if kp < 0.14 and ratings["power"] < 50:
            c.append(("Pest", (0.14 - kp) / 0.03 + 0.2, f"{kp:.0%} K"))
        if h["woba"] is not None and h["woba"] >= woba_cut and d["pa"] >= 400:
            c.append(("Franchise", 9, f".{int(round(h['woba'] * 1000)):03d} wOBA"))
        if d["ibb"] >= 6:
            c.append(("Intimidator", (d["ibb"] - 6) / 4 + 0.3, f"{int(d['ibb'])} IBB"))
        if d["g"] >= 155:
            c.append(("Workhorse", (d["g"] - 155) / 4 + 0.15, f"{int(d['g'])} games"))
        if h["woba"] is not None and h["xwoba"] is not None and h["woba"] - h["xwoba"] >= 0.030 and d["pa"] >= 300:
            c.append(("Lucky Charm", (h["woba"] - h["xwoba"] - 0.030) / 0.01 + 0.2, f"wOBA beat xwOBA by .{int(round((h['woba'] - h['xwoba']) * 1000)):03d}"))
        return top_types(c)

    def usage_of(pitches, codes):
        return sum(x["usage"] for x in pitches if x["code"] in codes)

    def pitcher_types(pid, p):
        d = p["disp"]
        c = []
        ps = p["pitches"]
        ff = max([x["velo"] for x in ps if x["code"] == "FF"] or [0])
        fastest = max([x["velo"] for x in ps] or [0])
        kp = d["k"] / max(1, d["bf"])
        if ff >= 96.5 or kp >= 0.30:
            c.append(("Fireballer", max((ff - 96.5) / 1.0, (kp - 0.30) / 0.03) + 0.3, f"{ff:.1f} mph 4-seam" if ff >= 96.5 else f"{kp:.0%} K"))
        slsw = usage_of(ps, ("SL", "ST"))
        if p["role"] == "CL" or d["sv"] >= 10 or (p["role"] != "SP" and slsw >= 0.40 and kp >= 0.28):
            c.append(("Closer", 1.0 + d["sv"] / 20, f"{int(d['sv'])} saves" if d["sv"] else f"{slsw:.0%} sliders"))
        junk = usage_of(ps, ("SV", "SC", "EP"))
        if (fastest and fastest < 91) or junk >= 0.15:
            c.append(("Junkballer", max((91 - fastest) / 2 if fastest else 0, (junk - 0.15) / 0.1) + 0.2, f"tops out at {fastest:.0f} mph" if fastest < 91 else f"{junk:.0%} junk"))
        ch = usage_of(ps, ("CH",))
        if ch >= 0.25 or (fastest and fastest < 92.5 and p["xwoba"] is not None and p["xwoba"] < lg["xwoba"] - 0.010):
            c.append(("Crafty", max((ch - 0.25) / 0.08, 0.1) + 0.2, f"{ch:.0%} changeups" if ch >= 0.25 else f"{fastest:.0f} mph, xwOBA .{int(round(p['xwoba'] * 1000)):03d}"))
        cu = usage_of(ps, ("CU", "KC", "CS"))
        if cu >= 0.25:
            c.append(("Curveballer", (cu - 0.25) / 0.08 + 0.3, f"{cu:.0%} curves"))
        kn = usage_of(ps, ("KN",))
        sp = usage_of(ps, ("FS", "FO"))
        if kn > 0 or sp >= 0.25:
            c.append(("Knuckleballer", 3 if kn else (sp - 0.25) / 0.08 + 0.3, "knuckleball" if kn else f"{sp:.0%} splitters"))
        if (p["k"] - p["bb"]) >= kbb_cut and (d["ip"] >= 60 or (d["g"] - d["gs"]) >= 40):
            c.append(("Franchise", 9, f"{p['k'] - p['bb']:.0%} K−BB"))
        if p["hbp"] >= hbp_cut and kp >= 0.25:
            c.append(("Intimidator", (p["hbp"] - hbp_cut) / 0.004 + 0.3, f"{int(d['hbp'])} HBP"))
        if (p["role"] == "SP" and p["pps"] and p["pps"] >= pps_cut) or p["mix"]["gb"] >= 0.52:
            c.append(("Workhorse", 0.3 + max((p["pps"] or 0) - pps_cut, 0) / 4 + max(p["mix"]["gb"] - 0.52, 0) / 0.03,
                      f"{p['pps']:.0f} P/GS" if p["role"] == "SP" and p["pps"] and p["pps"] >= pps_cut else f"{p['mix']['gb']:.0%} GB"))
        if p["woba"] is not None and p["xwoba"] is not None and p["xwoba"] - p["woba"] >= 0.030 and d["bf"] >= 300:
            c.append(("Lucky Charm", (p["xwoba"] - p["woba"] - 0.030) / 0.01 + 0.2, f"xwOBA beat wOBA by .{int(round((p['xwoba'] - p['woba']) * 1000)):03d}"))
        return top_types(c)

    def pitch_type(code, velo):
        if code == "FF":
            return "Fireballer" if velo >= 95 else "Grinder"
        return {"SI": "Workhorse", "FC": "Workhorse", "SL": "Closer", "ST": "Closer", "CU": "Curveballer",
                "KC": "Curveballer", "CS": "Curveballer", "CH": "Crafty", "FS": "Knuckleballer", "FO": "Knuckleballer",
                "KN": "Knuckleballer", "SV": "Junkballer", "SC": "Junkballer", "EP": "Grinder"}.get(code, "Grinder")

    # ------------------------------------------------------------ assemble players
    def positions_of(pid, primary):
        g = pos_games.get(pid, {})
        total = sum(v for k, v in g.items() if k not in ("P",))
        out = [primary] if primary and primary not in ("P", "TWP") else []
        for k, v in sorted(g.items(), key=lambda kv: -kv[1]):
            if k in ("P",) or k in out:
                continue
            if v >= 10 or (total and v / total >= 0.15):
                out.append(k)
        if not out:
            out = ["DH"]
        return out[:4]

    players = []
    def team_of(pid, stats_split):
        if pid in roster:
            return roster[pid]
        if stats_split:
            return stats_split.get("team", {}).get("id")
        return None

    def name_of(pid, fallback=""):
        p = people.get(pid, {})
        return p.get("fullName") or fallback

    def r1(x, d=4):
        return round(x, d)

    for pid in sorted(hitter_ids):
        h = hrows[pid]
        tid = team_of(pid, hit[S].get(pid) or hit[P].get(pid))
        if tid not in team_by_id:
            continue
        pe = people.get(pid, {})
        primary = pe.get("primaryPosition", {}).get("abbreviation", "DH")
        if primary in ("TWP",):
            primary = "DH"
        poss = positions_of(pid, primary)
        ratings = {}
        rawr = {}
        for k, (f, inv) in H_STATS.items():
            x = f(h)
            rawr[k] = rating_from(hvals[k], x, inv)
            ratings[k] = int(round(rawr[k]))
        if "C" in poss[:1] and h["pop"] and pops:
            rawr["fielding"] = rating_from(pops, h["pop"], True)
            ratings["fielding"] = int(round(rawr["fielding"]))
        types, reasons = hitter_types(pid, h, ratings)
        d = h["disp"]
        players.append({
            "id": pid, "name": name_of(pid), "team": team_by_id[tid]["abbr"], "kind": "H",
            "twoWay": pid + TWO_WAY_OFFSET if pid in pitcher_ids else None,
            "pos": poss, "bats": pe.get("batSide", {}).get("code", "R"), "throws": pe.get("pitchHand", {}).get("code", "R"),
            "age": pe.get("currentAge"),
            "r": {k: r1(v, 2) for k, v in rawr.items()},
            "rate": {"k": r1(h["k"]), "bb": r1(h["bb"]), "hbp": r1(h["hbp"]), "hr": r1(h["hr"]), "s1": r1(h["single"]),
                     "s2": r1(h["double"]), "s3": r1(h["triple"]), "babip": r1(h["babip"]), "sbAtt": r1(h["sbAtt"]),
                     "sbPct": r1(h["sbPct"]), "sprint": r1(sprint_default(h), 1), "oaa": h["oaa"] or 0, "pull": r1(h["pull"], 3),
                     "gb": r1(h["mix"]["gb"], 3), "fb": r1(h["mix"]["fb"], 3), "ld": r1(h["mix"]["ld"], 3), "pu": r1(h["mix"]["pu"], 3)},
            "line": {"g": int(d["g"]), "pa": int(d["pa"]), "ab": int(d["ab"]), "h": int(d["h"]), "hr": int(d["hr"]),
                     "d2": int(d["double"]), "d3": int(d["triple"]), "bb": int(d["bb"]), "k": int(d["k"]), "sb": int(d["sb"]),
                     "rbi": int(d["rbi"]), "tb": int(d["tb"]), "hbp": int(d["hbp"]), "sf": int(d["sf"])},
            "types": types, "typeWhy": reasons,
            "iv": {k: iv_for(pid, k) for k in ("contact", "power", "eye", "gap", "speed", "fielding")},
            "flag": "2025" if pid in injured_h else "",
        })

    for pid in sorted(pitcher_ids):
        p = prows[pid]
        tid = team_of(pid, pit[S].get(pid) or pit[P].get(pid))
        if tid not in team_by_id:
            continue
        pe = people.get(pid, {})
        rawr = {k: rating_from(pvals[k], f(p), inv) for k, (f, inv) in P_STATS.items()}
        ps = []
        pitches = [x for x in p["pitches"] if x["usage"] >= 0.03][:4] or [{"code": "FF", "usage": 1.0, "velo": 93.0,
                                                                         "whiff": lg["whiff"], "rv100": 0, "pitches": 0, "woba": 0.32}]
        tot_u = sum(x["usage"] for x in pitches)
        for x in pitches:
            score = pscore(x) if x["pitches"] else 0
            st = max(1.0, min(99.0, 1 + 98 * percentile_rank(pscores, score)))
            # Small samples regress the pitch's whiff toward his average.
            wreg = (x["whiff"] * x["pitches"] + lg["whiff"] * 120) / (x["pitches"] + 120) if x["pitches"] else lg["whiff"]
            ps.append({"code": x["code"], "name": PITCH_NAMES.get(x["code"], x["code"]), "fam": FAMILY.get(x["code"], "FB"),
                       "type": pitch_type(x["code"], x["velo"]), "usage": r1(x["usage"] / tot_u, 3), "velo": x["velo"],
                       "whiff": r1(wreg, 3), "rv100": x["rv100"], "stuff": r1(st, 1)})
        types, reasons = pitcher_types(pid, p)
        d = p["disp"]
        twp = pid in hitter_ids
        players.append({
            "id": pid + TWO_WAY_OFFSET if twp else pid, "name": name_of(pid), "team": team_by_id[tid]["abbr"], "kind": "P",
            "twoWay": pid if twp else None,
            "pos": ["P"], "bats": pe.get("batSide", {}).get("code", "R"), "throws": pe.get("pitchHand", {}).get("code", "R"),
            "age": pe.get("currentAge"), "role": p["role"],
            "r": {k: r1(v, 2) for k, v in rawr.items()},
            "rate": {"k": r1(p["k"]), "bb": r1(p["bb"]), "hbp": r1(p["hbp"]), "hr": r1(p["hr"]), "babip": r1(p["babip"]),
                     "wp": r1(p["wp"], 5), "gb": r1(p["mix"]["gb"], 3), "fb": r1(p["mix"]["fb"], 3), "ld": r1(p["mix"]["ld"], 3),
                     "pu": r1(p["mix"]["pu"], 3), "budget": round(p["budget"], 1), "hold": r1(p["hold"], 3)},
            "pitches": ps,
            "line": {"g": int(d["g"]), "gs": int(d["gs"]), "ip": round(d["ip"], 1), "w": int(d["w"]), "l": int(d["l"]),
                     "sv": int(d["sv"]), "hld": int(d["hld"]), "k": int(d["k"]), "bb": int(d["bb"]), "hr": int(d["hr"]),
                     "er": int(d["er"]), "h": int(d["h"]), "bf": int(d["bf"]), "np": int(d["np"])},
            "types": types, "typeWhy": reasons,
            "iv": {k: iv_for(pid, k) for k in ("stuff", "control", "movement", "stamina")},
            "flag": "2025" if pid in injured_p else "",
        })

    # Replacement-level fill so each team has 13+ hitters and 12+ pitchers.
    by_team = {}
    for pl in players:
        by_team.setdefault(pl["team"], []).append(pl)
    have = {p["id"] for p in players}
    for t in teams:
        lst = by_team.setdefault(t["abbr"], [])
        need_h = 13 - sum(1 for p in lst if p["kind"] == "H")
        need_p = 12 - sum(1 for p in lst if p["kind"] == "P")
        cands = [pid for pid, tid in roster.items() if tid == t["id"] and pid not in have]
        for pid in cands:
            pe = people.get(pid, {})
            isp = pe.get("primaryPosition", {}).get("abbreviation") == "P"
            if isp and need_p > 0:
                need_p -= 1
                players.append(repl_pitcher(pid, pe, t["abbr"], lg))
                have.add(pid)
            elif not isp and need_h > 0:
                need_h -= 1
                players.append(repl_hitter(pid, pe, t["abbr"], lg, hq))
                have.add(pid)
        n = 0
        while need_h > 0 or need_p > 0:  # still short: generic call-ups
            n += 1
            fake = -(t["id"] * 100 + n)
            if need_p > 0:
                need_p -= 1
                players.append(repl_pitcher(fake, {"fullName": f"{t['short']} Call-up P{n}"}, t["abbr"], lg))
            else:
                need_h -= 1
                players.append(repl_hitter(fake, {"fullName": f"{t['short']} Call-up {n}"}, t["abbr"], lg, hq))

    # Quantile tables for editing ratings (rating 0..100 -> rate).
    qt = {
        "contact": hq["contact"], "power": hq["power"], "eye": hq["eye"], "gap": hq["gap"], "speed": hq["speed"],
        "fielding": hq["fielding"], "stuff": pq["stuff"], "control": pq["control"], "stamina": pq["stamina"],
        "gb": pq["gb"], "hrAllowed": pq["hrAllowed"], "pitchWhiff": pq["pitchWhiff"],
    }
    end = season_info.get("regularSeasonEndDate", f"{S}-09-28")
    end_d = dt.date.fromisoformat(end)
    meta = {
        "season": S, "blend": P, "pulled": dt.date.today().isoformat(),
        "through": end_d.strftime("%b %-d, %Y"),
        "sources": "MLB Stats API, Baseball Savant",
        "players": len(players), "teams": len(teams),
    }
    lg_out = {k: (round(v, 5) if isinstance(v, float) else v) for k, v in lg.items()}
    data = {"meta": meta, "league": lg_out, "quantiles": qt, "teams": teams, "players": players,
            "typeOrder": TYPE_ORDER}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("// Generated by data/build_data.py. Do not edit by hand.\n")
        f.write("const DATA = ")
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\nif (typeof module !== 'undefined') module.exports = DATA;\n")
    nh = sum(1 for p in players if p["kind"] == "H")
    npi = len(players) - nh
    print(f"Wrote {OUT}: {nh} hitters, {npi} pitchers, {len(teams)} teams, stats through {meta['through']}")
    print("League: K {k:.3f}  BB {bb:.3f}  HR/PA {hr:.4f}  BABIP {babip:.3f}  AVG/OBP/SLG {avg:.3f}/{obp:.3f}/{slg:.3f}  "
          "R/G {runsPerGame:.2f}  P/PA {pitchesPerPA:.2f}  SB% {sbPct:.3f}".format(**lg))


def repl_hitter(pid, pe, abbr, lg, hq):
    pos = pe.get("primaryPosition", {}).get("abbreviation", "DH")
    if pos in ("P", "TWP", None):
        pos = "DH"
    return {
        "id": pid, "name": pe.get("fullName", "Call-up"), "team": abbr, "kind": "H", "pos": [pos],
        "bats": pe.get("batSide", {}).get("code", "R"), "throws": pe.get("pitchHand", {}).get("code", "R"),
        "age": pe.get("currentAge"),
        "r": {"contact": 25, "power": 20, "eye": 25, "gap": 25, "speed": 45, "fielding": 45},
        "rate": {"k": round(lg["k"] * 1.18, 4), "bb": round(lg["bb"] * 0.85, 4), "hbp": round(lg["hbp"], 4),
                 "hr": round(lg["hr"] * 0.6, 4), "s1": round(lg["single"] * 0.95, 4), "s2": round(lg["double"] * 0.85, 4),
                 "s3": round(lg["triple"], 4), "babip": round(lg["babip"] - 0.012, 4), "sbAtt": round(lg["sbAtt"], 4),
                 "sbPct": round(lg["sbPct"], 4), "sprint": round(lg["sprint"], 1), "oaa": 0, "pull": round(lg["pull"], 3),
                 "gb": round(lg["gb"], 3), "fb": round(lg["fb"], 3), "ld": round(lg["ld"], 3), "pu": round(lg["pu"], 3)},
        "line": {"g": 0, "pa": 0, "ab": 0, "h": 0, "hr": 0, "d2": 0, "d3": 0, "bb": 0, "k": 0, "sb": 0, "rbi": 0, "tb": 0, "hbp": 0, "sf": 0},
        "types": ["Grinder"], "typeWhy": ["Grinder · replacement level"],
        "iv": {k: iv_for(pid, k) for k in ("contact", "power", "eye", "gap", "speed", "fielding")},
        "flag": "repl",
    }


def repl_pitcher(pid, pe, abbr, lg):
    return {
        "id": pid, "name": pe.get("fullName", "Call-up"), "team": abbr, "kind": "P", "pos": ["P"],
        "bats": pe.get("batSide", {}).get("code", "R"), "throws": pe.get("pitchHand", {}).get("code", "R"),
        "age": pe.get("currentAge"), "role": "RP",
        "r": {"stuff": 22, "control": 25, "movement": 30, "stamina": 30},
        "rate": {"k": round(lg["k"] * 0.85, 4), "bb": round(lg["bb"] * 1.2, 4), "hbp": round(lg["hbp"] * 1.1, 4),
                 "hr": round(lg["hr"] * 1.15, 4), "babip": round(lg["babip"] + 0.008, 4), "wp": round(lg["wp"] * 1.2, 5),
                 "gb": round(lg["gb"], 3), "fb": round(lg["fb"], 3), "ld": round(lg["ld"], 3), "pu": round(lg["pu"], 3),
                 "budget": 25.0, "hold": round(lg["sbPct"], 3)},
        "pitches": [
            {"code": "FF", "name": "4-Seam", "fam": "FB", "type": "Grinder", "usage": 0.55, "velo": 93.0, "whiff": 0.18, "rv100": -0.5, "stuff": 25},
            {"code": "SL", "name": "Slider", "fam": "BR", "type": "Closer", "usage": 0.30, "velo": 84.0, "whiff": 0.28, "rv100": -0.5, "stuff": 25},
            {"code": "CH", "name": "Changeup", "fam": "OS", "type": "Crafty", "usage": 0.15, "velo": 85.0, "whiff": 0.25, "rv100": -0.5, "stuff": 25},
        ],
        "line": {"g": 0, "gs": 0, "ip": 0, "w": 0, "l": 0, "sv": 0, "hld": 0, "k": 0, "bb": 0, "hr": 0, "er": 0, "h": 0, "bf": 0, "np": 0},
        "types": ["Grinder"], "typeWhy": ["Grinder · replacement level"],
        "iv": {k: iv_for(pid, k) for k in ("stuff", "control", "movement", "stamina")},
        "flag": "repl",
    }


if __name__ == "__main__":
    main()
