import random, math, statistics as st, sys, os
RUN3 = int(os.environ.get('RUN3', 10))
# Critic sanity sim: PA-level, reuses barsim's base mix + advancement. Not the engine.
BASE = dict(K=.22, BB=.078, HBP=.010, HR=.031, T=.004, D=.045, S=.150)

def poisson(lam, r):
    L = math.exp(-lam); k = 0; p = 1.0
    while True:
        p *= r.random()
        if p <= L: return k
        k += 1

def pitches_for(res, r):
    if res == 'K':  return min(12, 3 + poisson(1.75, r))
    if res == 'BB': return min(13, 4 + poisson(1.7, r))
    if res == 'HBP': return 1 + poisson(2.3, r)
    return min(12, 1 + poisson(2.4, r))

def pa_result(q, r, bbm=1.0, onm=1.0):
    p = dict(K=BASE['K']/q, BB=BASE['BB']*q*bbm, HBP=BASE['HBP'], HR=BASE['HR']*q*onm,
             T=BASE['T']*q*onm, D=BASE['D']*q*onm, S=BASE['S']*q*onm)
    x = r.random(); acc = 0
    for k, v in p.items():
        acc += v
        if x < acc: return k
    return 'OUT'

def advance(bases, res, outs, r):
    b1, b2, b3 = bases; runs = 0
    if res in ('BB', 'HBP'):
        if b1 and b2 and b3: runs += 1
        if b1 and b2: b3 = True
        if b1: b2 = True
        b1 = True
        return [b1, b2, b3], runs, 0, False
    if res == 'HR': return [False]*3, 1 + b1 + b2 + b3, 0, False
    if res == 'T': return [False, False, True], b1 + b2 + b3, 0, False
    if res == 'D':
        runs = b2 + b3; n3 = False
        if b1:
            if r.random() < 0.40: runs += 1
            else: n3 = True
        return [False, True, n3], runs, 0, False
    if res == 'S':
        runs = b3; n1, n2, n3 = True, False, False
        if b2:
            if r.random() < 0.60: runs += 1
            else: n3 = True
        if b1:
            if not n3 and r.random() < 0.28: n3 = True
            else: n2 = True
        return [n1, n2, n3], runs, 0, False
    if res == 'K': return [b1, b2, b3], 0, 1, False
    if outs < 2 and b1 and r.random() < 0.13:
        return [False, b2, b3], 0, 2, True
    if outs < 2 and b3 and r.random() < 0.45:
        return [b1, b2, False], 1, 1, False
    if outs < 2 and b2 and not b3 and r.random() < 0.3:
        return [b1, False, True], 0, 1, False
    return [b1, b2, b3], 0, 1, False

D1_DMG = dict(BB=4, HBP=4, S=5, D=7, T=8, HR=10)
D2_DMG = dict(BB=4, HBP=4, S=6, D=9, T=11, HR=14)
D3_DMG = dict(BB=4, HBP=4, S=6, D=10, T=12, HR=16)

class Pit:
    def __init__(s, sp, B, q):
        s.sp = sp; s.B = B; s.q = q; s.U = 0.0; s.hp = 100.0; s.pitches = 0; s.bf = 0
        s.outs = 0; s.runs = 0; s.exit = None; s.innp = 0; s.visited = False
        s.minhp = 100
        if DESIGN == 1:
            s.T = B + max(8, round(0.30*B)); s.hpmax = 100
        elif DESIGN == 3:
            s.T = round(4/3*B) if sp else max(30, round(4/3*B)); s.hpmax = 100
        else:
            s.T = max(70, min(120, round(1.15*B))) if sp else max(25, min(50, round(2.0*B)))
            s.hpmax = (85 + round(0.3*random.gauss(50, 25))) if sp else (50 + round(0.2*50))
            s.hp = s.hpmax

def new_team(r, spB):
    q = r.gauss(1.0, 0.10) * r.gauss(1.0, 0.08)
    sp = Pit(True, max(65, min(105, round(r.gauss(spB, 8)))), q)
    pen = [Pit(False, 17 if DESIGN == 1 else (24 if DESIGN == 3 else 16.5), r.gauss(1.0, 0.10)) for _ in range(5)]
    return dict(cur=sp, sp=sp, pen=pen, used=[], visits=2, log=[])

def change(tm, why):
    tm['cur'].exit = tm['cur'].exit or why
    tm['used'].append(tm['cur'])
    if tm['pen']: tm['cur'] = tm['pen'].pop(0)
    else:
        STATS['empty'] += 1; tm['cur'] = Pit(False, 25, 1.5)

def cost(p, on, risp, pa_pitch):
    if DESIGN == 1:
        return 0.9 + (0.2 if on else 0) + (0.4 if p.innp >= 21 else 0)
    if DESIGN == 3:
        return 0.85 + (0.25 if on else 0) + (0.35 if p.innp >= 21 else 0)
    m = 1.0
    if risp: m *= 1.30
    elif on: m *= 1.15
    if pa_pitch >= 7: m *= 1.20
    if p.innp >= 21: m *= 1.25
    return min(2.0, m)

def half(tm, r, extra):
    outs = 0; bases = [False, True, False] if extra else [False]*3; runs = 0
    p = tm['cur']; p.innp = 0; p.visited = False; scored_on = {id(p): 0}
    while outs < 3:
        p = tm['cur']
        # AI hook at PA boundary (after 3 BF)
        on = any(bases); risp = bases[1] or bases[2]
        if p.bf >= 3 and DESIGN == 1:
            if (p.hp <= 20) or (p.hp <= 35 and on):
                STATS['hp_hook'] += p.sp; change(tm, 'HPHOOK'); p = tm['cur']; p.innp = 0
            elif (p.U >= p.B and risp) or p.U >= p.B + 0.35*(p.T - p.B):
                change(tm, 'PULL'); p = tm['cur']; p.innp = 0
        if p.bf >= 3 and DESIGN == 3:
            if (p.T - p.U) <= 0.12*p.T or (p.T - p.U) <= 10:
                change(tm, 'PULL'); p = tm['cur']; p.innp = 0
        if DESIGN == 3 and not p.visited and tm['visits'] > 0 and p.hp <= 30:
            p.hp = min(100, p.hp + 10); p.visited = True; tm['visits'] -= 1; STATS['visits'] += 1
        if p.bf >= 3 and DESIGN == 2:
            if p.hp <= 0.20*p.hpmax and on:
                STATS['hp_hook'] += p.sp; change(tm, 'HPHOOK'); p = tm['cur']; p.innp = 0
        # visit
        if DESIGN == 1 and not p.visited and tm['visits'] > 0 and p.hp <= 50 and risp:
            p.hp = min(100, p.hp + 15); p.visited = True; tm['visits'] -= 1; STATS['visits'] += 1
        if DESIGN == 2 and not p.visited and tm['visits'] > 0 and p.hp <= 0.35*p.hpmax and on:
            p.hp = min(p.hpmax, p.hp + 15); p.visited = True; tm['visits'] -= 1; STATS['visits'] += 1
        res = pa_result(p.q, r)
        n = pitches_for(res, r)
        on = any(bases); risp = bases[1] or bases[2]
        for i in range(n):
            p.pitches += 1; p.innp += 1
            c = cost(p, on, risp, i+1); p.U += c; STATS['cost'] += c; STATS['pitches'] += 1
            if DESIGN == 1 and p.U >= p.T: STATS['midpa_gas'] += 1; break  # crude: faint mid-PA (counted only)
        p.bf += 1; STATS['PA'] += 1
        outs_before = outs
        bases, rr, oo, dp = advance(bases, res, outs, r)
        outs += oo; runs += rr; p.runs += rr; p.outs += oo
        scored_on[id(p)] = scored_on.get(id(p), 0) + rr
        if DESIGN == 3:
            p.hp = p.hp - D3_DMG.get(res, 0) - RUN3*rr
        elif DESIGN == 1:
            dmg = D1_DMG.get(res, 0) + 8*rr
            rec = (2 if res == 'K' else oo) + (2 if dp else 0)
            p.hp = min(100, p.hp - dmg + rec)
        else:
            sat = (res in ('S','D','T','HR')) and r.random() < 0.35
            ev = D2_DMG.get(res, 0)
            if sat: ev = math.ceil(ev*1.5)
            rd = 8*rr * (1.5 if (rr and outs_before == 2) else 1)
            rec = (2 if res == 'K' else oo) + (1 if dp else 0)
            p.hp = min(p.hpmax, p.hp - ev - rd + rec)
        p.minhp = min(p.minhp, p.hp)
        faint = None
        if p.hp <= 0: faint = 'KO'
        elif p.U >= p.T: faint = 'GAS'
        if faint:
            if p.bf >= 3 or outs >= 3:
                STATS[faint] += 1; STATS[faint+'_sp'] += p.sp
                if outs < 3: change(tm, faint)
                else: p.exit = faint; tm['needs'] = True
            else:
                p.hp = max(p.hp, 1); p.U = min(p.U, p.T - 0.01)
    cur = tm['cur']
    if not tm.get('needs'):
        if DESIGN == 1:
            cur.hp = min(100, cur.hp + 4 + (6 if scored_on.get(id(cur), 0) == 0 else 0))
        elif DESIGN == 3 and scored_on.get(id(cur), 0) == 0:
            cur.hp = min(100, cur.hp + 8)
    if tm.get('needs'):
        tm['needs'] = False; change(tm, cur.exit)
    return runs

def game(r, spB):
    t = [new_team(r, spB), new_team(r, spB)]; score = [0, 0]; inn = 0
    while True:
        inn += 1
        for side in (0, 1):
            if side == 1 and inn >= 6 and score[1] > score[0]: break
            d = t[1-side]; c = d['cur']
            if DESIGN == 3:
                rem = c.T - c.U
                if c.sp and rem <= 0.25*c.T and d['pen']: change(d, 'PULL')
                elif (not c.sp) and c.outs >= 3 and not (c.B >= 35 and rem > 0.5*c.T) and d['pen']: change(d, 'PULL')
            elif DESIGN == 1:
                if c.sp and c.U >= c.B - 6 and d['pen']: change(d, 'PULL')
                elif (not c.sp) and c.outs >= 3 and c.U >= c.B - 6 and d['pen']: change(d, 'PULL')
            else:
                rem = c.T - c.U
                if c.sp and rem < 10 and d['pen']: change(d, 'PULL')
                elif c.sp and c.hp <= 0.25*c.hpmax and d['pen']: STATS['hp_hook'] += 1; change(d, 'HPHOOK')
                elif (not c.sp) and (rem < 10 or c.outs >= 3) and d['pen']: change(d, 'PULL')
            score[side] += half(d, r, inn > 6)
        if inn >= 6 and score[0] != score[1]: break
        if inn > 15: break
    return t, score

def run(n, spB=86, seed=7):
    global STATS
    STATS = dict(PA=0, pitches=0, cost=0.0, KO=0, GAS=0, KO_sp=0, GAS_sp=0, hp_hook=0, visits=0, empty=0, midpa_gas=0)
    r = random.Random(seed); random.seed(seed+1)
    spp, spip, runs, nsp, early, used, relapps, relko, relgas, sp_minhp = [], [], 0, 0, 0, 0, 0, 0, 0, []
    for g in range(n):
        k0 = STATS['KO'] + STATS['GAS']
        t, sc = game(r, spB); runs += sum(sc)
        STATS['gfaint'] = STATS.get('gfaint', 0) + ((STATS['KO'] + STATS['GAS']) > k0)
        for tm in t:
            sp = tm['sp']; nsp += 1; spp.append(sp.pitches); spip.append(sp.outs/3)
            sp_minhp.append(sp.minhp / sp.hpmax)
            if sp.outs < 9: early += 1
            allp = tm['used'] + [tm['cur']]
            used += len(allp)
            for x in allp:
                if not x.sp and x.pitches: relapps += 1; relko += (x.exit == 'KO'); relgas += (x.exit == 'GAS')
    s = STATS
    print(f"DESIGN {DESIGN}: games={n} R/team/G={runs/n/2:.2f} P/PA={s['pitches']/s['PA']:.2f} meanCost/pitch={s['cost']/s['pitches']:.3f}")
    print(f"  SP pitches mean={st.mean(spp):.1f} p90={sorted(spp)[int(.9*len(spp))]}  SP IP mean={st.mean(spip):.2f}  SP <3IP={early/nsp:.3f}")
    print(f"  SP KO={s['KO_sp']/nsp:.3f} SP GAS={s['GAS_sp']/nsp:.3f} SP HP-hook={s['hp_hook']/nsp:.3f} (KO+hook={(s['KO_sp']+s['hp_hook'])/nsp:.3f})")
    print(f"  pitchers/team/G={used/n/2:.2f} relief apps={relapps/n/2:.2f}/team relief KO={relko/max(1,relapps):.3f} relief GAS={relgas/max(1,relapps):.3f}")
    print(f"  visits/team/G={s['visits']/n/2:.2f} empty pen={s['empty']}  D1 mid-PA ARM-zero events/PA={s['midpa_gas']/s['PA']:.4f}")
    print(f"  games with any faint={s.get('gfaint',0)/n:.3f}")
    print(f"  SP min-HP share <=50%: {sum(1 for x in sp_minhp if x<=0.5)/nsp:.3f}  <=20%: {sum(1 for x in sp_minhp if x<=0.2)/nsp:.3f}")

if __name__ == '__main__':
    DESIGN = int(sys.argv[1]); n = int(sys.argv[2]) if len(sys.argv) > 2 else 3000
    run(n)
