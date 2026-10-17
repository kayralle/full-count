import random, math, statistics as st, sys

# Rough sanity sim for the Health/Fatigue constants (not the real engine).
# League PA mix (per PA): K .22, BB .075, HBP .01, HR .03, 3B .004, 2B .043, 1B .145, out rest
BASE = dict(K=.22, BB=.075, HBP=.010, HR=.030, T=.004, D=.043, S=.145)

DMG = dict(BB=4, HBP=4, S=6, D=10, T=12, HR=16)
import os
RUN_DMG = int(os.environ.get('RUN_DMG', 6))
REL_BUF = int(os.environ.get('REL_BUF', 0))
SPB_SD = float(os.environ.get('SPB_SD', 0))
NEWINN = float(os.environ.get('NEWINN', 0.30))
HOOK = float(os.environ.get('HOOK', 0.22))
HP_ENV = int(os.environ.get('HP', 100))
VHEAL = int(os.environ.get('VHEAL', 10))
VISITS = int(os.environ.get('VISITS', 0))
VISIT_HP = int(os.environ.get('VISIT_HP', 30))
HEAL_SCORELESS = int(os.environ.get('HEAL', 8))
HP_MAX = HP_ENV

def pitches_for(res, r):
    if res == 'K':  return min(12, 3 + poisson(1.75, r))
    if res == 'BB': return min(13, 4 + poisson(1.7, r))
    if res == 'HBP': return 1 + poisson(2.3, r)
    return min(12, 1 + poisson(2.4, r))

def poisson(lam, r):
    L = math.exp(-lam); k = 0; p = 1.0
    while True:
        p *= r.random()
        if p <= L: return k
        k += 1

def pa_result(q, pF, pH, r, effects):
    # q: pitcher quality multiplier on "good-for-batter" events (>1 worse pitcher)
    m_on = q; m_hr = q
    m_k = 1/q
    if effects:
        m_on *= (1 + 0.10*pF + 0.05*pH) / (1 + EFF_BAR)
        m_hr *= (1 + 0.40*pF + 0.10*pH) / (1 + 4*EFF_BAR)
        m_k  *= (1 - 0.20*pF) / (1 - 2*EFF_BAR)
        bbm = (1 + 0.30*pF + 0.15*pH) / (1 + 3*EFF_BAR)
    else:
        bbm = 1
    p = dict(K=BASE['K']*m_k, BB=BASE['BB']*q*bbm, HBP=BASE['HBP'], HR=BASE['HR']*m_hr,
             T=BASE['T']*m_on, D=BASE['D']*m_on, S=BASE['S']*m_on)
    x = r.random(); acc = 0
    for k, v in p.items():
        acc += v
        if x < acc: return k
    return 'OUT'

EFF_BAR = 0.0

def advance(bases, res, outs, r):
    # bases: [1b,2b,3b] booleans; returns new bases, runs, outs_added
    b1, b2, b3 = bases; runs = 0
    if res in ('BB', 'HBP'):
        if b1 and b2 and b3: runs += 1
        if b1 and b2: b3 = True
        if b1: b2 = True
        b1 = True
        return [b1, b2, b3], runs, 0
    if res == 'HR':
        return [False]*3, 1 + b1 + b2 + b3, 0
    if res == 'T':
        return [False, False, True], b1 + b2 + b3, 0
    if res == 'D':
        runs = b2 + b3
        n3 = False
        if b1:
            if r.random() < 0.40: runs += 1
            else: n3 = True
        return [False, True, n3], runs, 0
    if res == 'S':
        runs = b3
        n1, n2, n3 = True, False, False
        if b2:
            if r.random() < 0.60: runs += 1
            else: n3 = True
        if b1:
            if not n3 and r.random() < 0.28: n3 = True
            else: n2 = True
        return [n1, n2, n3], runs, 0
    if res == 'K':
        return [b1, b2, b3], 0, 1
    # ball in play out
    if outs < 2 and b1 and r.random() < 0.13:
        # double play
        if outs == 1: return [False, b2, b3], 0, 2
        runs = 0
        n3 = b3; n2 = b2
        return [False, n2, n3], 0, 2
    if outs < 2 and b3 and r.random() < 0.45:
        return [b1, b2, False], 1, 1
    # productive out sometimes moves runner from 2nd to 3rd
    if outs < 2 and b2 and not b3 and r.random() < 0.3:
        return [b1, False, True], 0, 1
    return [b1, b2, b3], 0, 1

class P:
    def __init__(self, B, q, sp):
        self.B = B; self.S = round(B*4/3); self.fmax = self.S*10; self.f = self.fmax
        self.hp = HP_MAX; self.q = q; self.sp = sp; self.pitches = 0; self.bf = 0; self.outs = 0
        self.runs = 0; self.ko = False; self.gas = False; self.inn_p = 0

def pen(p):
    fF = p.f / p.fmax; fH = p.hp / HP_MAX
    pF = max(0.0, min(1.0, (0.25 - fF)/0.25))
    pH = max(0.0, min(1.0, (0.40 - fH)/0.40))
    return pF, pH

def half_inning(team, r, effects, stats, ai_hook_f, extra=False):
    outs = 0; bases = [False, True, False] if extra else [False]*3; runs = 0
    p = team['cur']; p.inn_p = 0; inning_runs_by = {id(p): 0}
    for x in [p] + team['pen']: x.visited = False
    while outs < 3:
        # AI hook at PA boundary
        p = team['cur']
        if p.bf_inning_start_ok(): pass
        fF = p.f / p.fmax
        if (fF <= ai_hook_f or p.f <= REL_BUF) and p.bf >= 3 and team['pen']:
            switch(team, stats, 'hook')
            p = team['cur']; p.inn_p = 0; inning_runs_by[id(p)] = 0
        if VISITS and p.hp <= VISIT_HP and team.get('visits', 2) > 0 and not getattr(p, 'visited', False):
            p.hp = min(HP_MAX, p.hp + VHEAL); team['visits'] = team.get('visits', 2) - 1; p.visited = True; stats['visits'] = stats.get('visits',0)+1
        pF, pH = pen(p)
        stats['pH_sum'] = stats.get('pH_sum',0) + pH*0

        res = pa_result(p.q, pF, pH, r, effects)
        n = pitches_for(res, r)
        on = any(bases)
        for i in range(n):
            p.pitches += 1; p.inn_p += 1
            d = 10 + (4 if on else 0) + (4 if p.inn_p > 20 else 0)
            p.f -= d
            stats['pitch_count'] += 1
            if pF > 0: stats['pitch_pen'] += 1
            stats['pF_sum'] += pF
            stats['pH_pos'] = stats.get('pH_pos',0) + (pH>0)
            stats['pHs'] = stats.get('pHs',0) + pH
        p.bf += 1
        bases, r_, o_ = advance(bases, res, outs, r)
        outs += o_; runs += r_; p.runs += r_; p.outs += o_
        inning_runs_by[id(p)] = inning_runs_by.get(id(p), 0) + r_
        if res in DMG: p.hp -= DMG[res]
        p.hp -= RUN_DMG * r_
        stats['PA'] += 1; stats[res] = stats.get(res, 0) + 1
        if p.hp <= 0 or p.f <= 0:
            if p.bf >= 3 or outs >= 3:
                if p.hp <= 0:
                    p.ko = True; stats.setdefault('ko_ip',[]).append(p.outs/3); stats.setdefault('ko_r',[]).append(p.runs); stats.setdefault('ko_p',[]).append(p.pitches)
                else:
                    p.gas = True; stats.setdefault('gas_p',[]).append(p.pitches)
                    if p.sp: stats.setdefault('sp_gas_p',[]).append(p.pitches)
                if outs < 3:
                    switch(team, stats, 'faint')
                    p = team['cur']; p.inn_p = 0; inning_runs_by[id(p)] = 0
                else:
                    team['needs_change'] = True
            else:
                p.hp = max(p.hp, 1); p.f = max(p.f, 1)
        if extra is False and False: pass
    # end of half: heal
    cur = team['cur']
    if not team.get('needs_change') and inning_runs_by.get(id(cur), 0) == 0:
        cur.hp = min(HP_MAX, cur.hp + HEAL_SCORELESS)
    if team.get('needs_change'):
        team['needs_change'] = False
        switch(team, stats, 'faint_end')
    return runs

def switch(team, stats, why):
    if team['pen']:
        team['used'].append(team['cur'])
        team['cur'] = team['pen'].pop(0)
    else:
        stats['empty_pen'] += 1
        team['used'].append(team['cur'])
        team['cur'] = P(20, 1.6, False)

P.bf_inning_start_ok = lambda self: True

def make_team(r, spB):
    q = r.gauss(1.0, 0.10) * r.gauss(1.0, 0.08)  # talent * day form
    sp = P(max(65, min(105, round(r.gauss(spB, SPB_SD)))), q, True)
    pen = [P(24, r.gauss(1.0, 0.10), False) for _ in range(7)]
    return dict(cur=sp, sp=sp, pen=pen, used=[])

def game(r, effects, ai_hook_f, spB):
    t = [make_team(r, spB), make_team(r, spB)]
    score = [0, 0]
    inn = 0
    while True:
        inn += 1
        extra = inn > 6
        # relievers: AI gives each reliever at most ~1 inning: start of inning switch if reliever already pitched an inning
        for side in (0, 1):
            if side == 1 and inn >= 6 and score[1] > score[0]: break
            dteam = t[1-side]
            c = dteam['cur']
            if not c.sp and c.outs >= 3 and dteam['pen']:
                switch(dteam, STATS, 'inning')
            if c.sp and (c.f / c.fmax) <= NEWINN and dteam['pen']:
                switch(dteam, STATS, 'hook_inning')
            runs = half_inning(dteam, r, effects, STATS, ai_hook_f, extra)
            score[side] += runs
        if inn >= 6 and score[0] != score[1]: break
        if inn > 15: break
    return t, score, inn

def run(n, effects, ai_hook_f=None, spB=88, seed=1):
    global STATS
    ai_hook_f = HOOK if ai_hook_f is None else ai_hook_f
    STATS = dict(PA=0, pitch_count=0, pitch_pen=0, pF_sum=0.0, empty_pen=0)
    r = random.Random(seed)
    sp_p, sp_ip, ko, gas, runs, games, inns = [], [], 0, 0, 0, 0, 0
    rel_gas = 0; rel_ko = 0; rel_used = 0
    for g in range(n):
        t, score, inn = game(r, effects, ai_hook_f, spB)
        games += 1; runs += sum(score); inns += inn
        for tm in t:
            sp = tm['sp']
            sp_p.append(sp.pitches); sp_ip.append(sp.outs/3)
            ko += sp.ko; gas += sp.gas
            for x in tm['used'] + [tm['cur']]:
                if not x.sp and x.pitches > 0:
                    rel_used += 1; rel_gas += x.gas; rel_ko += x.ko
    s = STATS
    print(f"effects={effects} hook={ai_hook_f} spB={spB} games={n}")
    print(f"  runs/team/game={runs/games/2:.2f}  P/PA={s['pitch_count']/s['PA']:.2f}  K%={s['K']/s['PA']:.3f} BB%={(s['BB'])/s['PA']:.3f} HR%={s['HR']/s['PA']:.3f}")
    print(f"  SP pitches mean={st.mean(sp_p):.1f} sd={st.pstdev(sp_p):.1f} p90={sorted(sp_p)[int(.9*len(sp_p))]}  SP IP mean={st.mean(sp_ip):.2f}")
    print(f"  SP KO rate={ko/len(sp_p):.3f}  SP gas faint={gas/len(sp_p):.4f}  SP <4 IP={sum(1 for x in sp_ip if x<4)/len(sp_ip):.3f}")
    print(f"  relievers/team/game={rel_used/games/2:.2f} rel KO={rel_ko/max(1,rel_used):.3f} rel gas={rel_gas/max(1,rel_used):.4f} emptypen={s['empty_pen']}")
    print(f"  KO: IP mean={st.mean(s.get('ko_ip',[0])):.2f} runs mean={st.mean(s.get('ko_r',[0])):.2f} pitches mean={st.mean(s.get('ko_p',[0])):.1f}; gas faint pitches mean={st.mean(s.get('gas_p',[0])):.1f} n={len(s.get('gas_p',[]))}; share pitches pH>0={s.get('pH_pos',0)/s['pitch_count']:.3f} mean pH={s.get('pHs',0)/s['pitch_count']:.4f} visits/game={s.get('visits',0)/n:.2f}")
    if s.get('sp_gas_p'): print(f"  SP gas faint pitch mean={st.mean(s['sp_gas_p']):.1f} min={min(s['sp_gas_p'])} max={max(s['sp_gas_p'])} p10={sorted(s['sp_gas_p'])[len(s['sp_gas_p'])//10]} p90={sorted(s['sp_gas_p'])[9*len(s['sp_gas_p'])//10]}")
    print(f"  share pitches with pF>0={s['pitch_pen']/s['pitch_count']:.3f}  mean pF={s['pF_sum']/s['pitch_count']:.4f}")
    return s['pF_sum']/s['pitch_count']

if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4000
    run(n, True)
