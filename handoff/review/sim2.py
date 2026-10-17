import random, statistics as st, sys

R = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
N = int(sys.argv[2]) if len(sys.argv) > 2 else 40000
RUN_DMG = int(sys.argv[3]) if len(sys.argv) > 3 else 10
HEAL = int(sys.argv[4]) if len(sys.argv) > 4 else 8
QSD = float(sys.argv[5]) if len(sys.argv) > 5 else 0.12

BASE = dict(K=.222, BB=.079, IBB=.003, HBP=.011, HR=.031, S=.146, D=.045, T=.0035, E=.009)

def pa_outcome(q):
    # q scales "bad" outcomes for pitcher (hits/walks); K scaled inversely
    r = dict(BASE)
    for k in ("BB", "HR", "S", "D", "T"):
        r[k] *= q
    r["K"] /= q
    tot = sum(r.values())
    x = R.random()
    acc = 0
    for k, v in r.items():
        acc += v
        if x < acc:
            return k
    return "OUT"

def pitches_in_pa(o):
    # mean ~3.9
    if o == "IBB":
        return 0
    n = 1 + sum(1 for _ in range(12) if R.random() < 0.245)
    if o in ("K",):
        n = max(n, 3)
    if o == "BB" or o == "HBP" and False:
        n = max(n, 4)
    return n

def play_start(B):
    T = max(round(1.3 * B), 30)
    q = max(0.6, R.gauss(1.0, QSD))  # pitcher quality x lineup
    hp = 100
    used = 0
    ip_outs = 0
    runs = 0
    hits = 0
    pitches_hp_pen = 0
    pitches_total = 0
    hp_hist = []
    ko = False
    visited = False
    for inning in range(1, 7):
        if inning > 1 and used >= B - 8:
            break
        outs = 0
        bases = [None, None, None]  # 'c' clean, 't' tainted
        inn_runs = 0
        inn_p = 0
        while outs < 3:
            # mid-inning hook (between batters)
            if used >= T - 12 or (used > B and (bases[1] or bases[2])):
                return dict(ip=ip_outs / 3, runs=runs, hp=hp, ko=False, used=used, pen=pitches_hp_pen, tot=pitches_total, hook="mid", hits=hits)
            o = pa_outcome(q)
            n = pitches_in_pa(o)
            for _ in range(n):
                if hp < 40:
                    pitches_hp_pen += 1
                pitches_total += 1
            used += n
            inn_p += n
            dmg = 0
            scored = []
            def adv_force(tag):
                nonlocal bases
                b = bases
                if b[0]:
                    if b[1]:
                        if b[2]:
                            scored.append(b[2])
                        b[2] = b[1]
                    b[1] = b[0]
                b[0] = tag
            if o in ("BB", "HBP"):
                dmg += 4
                adv_force("c")
            elif o == "IBB":
                adv_force("c")
            elif o == "E":
                # batter reaches on error, runners +1
                if bases[2]: scored.append("t")
                bases = [ "t", bases[0], bases[1]]
            elif o == "S":
                dmg += 6; hits += 1
                nb = [None, None, None]
                if bases[2]: scored.append(bases[2])
                if bases[1]:
                    if R.random() < 0.6: scored.append(bases[1])
                    else: nb[2] = bases[1]
                if bases[0]:
                    if nb[2] is None and R.random() < 0.28: nb[2] = bases[0]
                    else: nb[1] = bases[0]
                nb[0] = "c"
                bases = nb
            elif o == "D":
                dmg += 10; hits += 1
                nb = [None, None, None]
                for b in (bases[2], bases[1]):
                    if b: scored.append(b)
                if bases[0]:
                    if R.random() < 0.42: scored.append(bases[0])
                    else: nb[2] = bases[0]
                nb[1] = "c"; bases = nb
            elif o == "T":
                dmg += 12; hits += 1
                for b in bases:
                    if b: scored.append(b)
                bases = [None, None, "c"]
            elif o == "HR":
                dmg += 16; hits += 1
                for b in bases:
                    if b: scored.append(b)
                scored.append("c")
                bases = [None, None, None]
            else:  # K or OUT
                outs += 1
                if o == "OUT" and outs < 3:
                    x = R.random()
                    if bases[0] and x < 0.12 and outs < 3:
                        outs += 1; bases[0] = None
                        if outs >= 3: break
                    if bases[2] and R.random() < 0.40:
                        scored.append(bases[2]); bases[2] = None
                    if bases[1] and not bases[2] and R.random() < 0.30:
                        bases[2] = bases[1]; bases[1] = None
            for s in scored:
                dmg += RUN_DMG if s == "c" else RUN_DMG // 2
            runs += len(scored)
            inn_runs += len(scored)
            hp -= dmg
            if 0 < hp <= 30 and not visited:
                visited = True; hp = min(100, hp + 10)
            if hp <= 0:
                ip_outs += outs
                return dict(ip=ip_outs / 3, runs=runs, hp=0, ko=True, used=used, pen=pitches_hp_pen, tot=pitches_total, hook="ko", hits=hits)
        ip_outs += 3
        if inn_runs == 0:
            hp = min(100, hp + HEAL)
    return dict(ip=ip_outs / 3, runs=runs, hp=hp, ko=False, used=used, pen=pitches_hp_pen, tot=pitches_total, hook="start" if ip_outs < 18 else "cg", hits=hits)

res = []
for i in range(N):
    B = min(105, max(60, round(R.gauss(86, 7))))
    res.append(play_start(B))

ko = [r for r in res if r["ko"]]
nonko = [r for r in res if not r["ko"]]
print("KO rate %.3f" % (len(ko) / N))
if ko:
    print("KO IP mean %.2f runs mean %.2f hits %.2f" % (st.mean(r["ip"] for r in ko), st.mean(r["runs"] for r in ko), st.mean(r["hits"] for r in ko)))
print("starts <3.0 IP %.3f" % (sum(1 for r in res if r["ip"] < 3) / N))
print("starter IP mean %.2f" % st.mean(r["ip"] for r in res))
ps = sorted(r["used"] for r in res)
print("starter pitches mean %.1f sd %.1f p90 %d" % (st.mean(ps), st.pstdev(ps), ps[int(.9 * N)]))
print("ending HP non-KO mean %.1f median %.1f" % (st.mean(r["hp"] for r in nonko), st.median(r["hp"] for r in nonko)))
print("pitches with HP<40 %.3f" % (sum(r["pen"] for r in res) / sum(r["tot"] for r in res)))
print("CG share %.3f" % (sum(1 for r in res if r["hook"] == "cg") / N))
print("runs per 6 (starter part) %.2f" % (st.mean(r["runs"] for r in res)))
