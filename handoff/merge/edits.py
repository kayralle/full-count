import json
E = []
def e(old, new, why): E.append({"old_str": old, "new_str": new, "why": why})

e("role (SP/RP/CL from games started and saves), batters faced, K%, BB%, HR per batter faced, GB%, BABIP allowed, average pitches per appearance,",
  "role (SP if at least half his games are starts and he averages 60+ pitches per start, so openers count as RP; CL from saves), batters faced, K%, BB%, HR per batter faced, GB%, BABIP allowed, average pitches per start and per relief appearance (Stats API `statSplits` with `sitCodes=sp,rp`, or game logs; fallback: total pitches ÷ appearances),",
  "The Fatigue budget needs pitches per start and per relief appearance separately. Season totals mix both for swingmen. The tighter SP rule keeps openers from getting starter-sized tanks.")

e("Stamina (pitches per appearance)",
  "Stamina (pitches per start or per relief appearance; it sets his Fatigue budget, section 5)",
  "Ties the existing Stamina rating to the Fatigue bar, so no new rating is needed.")

e("**VISIT** (mound visit: steadies control for a few pitches, 2 per game)",
  "**VISIT** (mound visit: +10 Health and steadies his control, with no Health penalty for 3 pitches; 2 per game, see section 5)",
  "Defines what a visit does now that Health exists. It stays a command fix, not a fatigue reset.")

e("- **BENCH:** pinch hitter, pinch runner",
  "- **BENCH:** pinch hitter (between plate appearances), pinch runner",
  "Pinch hitters only between PAs means the 9.15(b) two-strike rule never comes up after a mid at-bat pitching change.")

e("from the pitcher's Control, the location, fatigue and the count.",
  "from the pitcher's Control, the location, his Health and Fatigue bars (section 5) and the count.",
  "Points step 1 at the single pre-pitch read point for bar effects.")

e("- HP bars: the **pitcher's bar is stamina**, draining by pitch count. The **batter's bar is the count**: three strikes empties it. Show balls and strikes as dots too.",
  "- **HP bars and fainting.** It's still baseball. Every pitch and play resolves by baseball rules first. A hit is a hit, an out is an out, and runs, outs, innings and the win are pure baseball. On top of that, each pitcher has two Pokémon-style bars: **Health** (how hard he's been hit today) and **Fatigue** (his pitch budget). If either bar is destroyed, the pitcher **faints**. He's knocked out of the game, out of gas or hurt, and must be replaced under MLB rules: no re-entry, the reliever inherits the count and runners, inherited runners stay charged to the pitcher who put them on, and the 3-batter minimum applies unless he's hurt. The bars never change a play that already happened. They only change how well he pitches from then on and when he has to leave. Batters don't faint: the **batter's bar is the count**, and three strikes empties it. Show balls and strikes as dots too. Full rules: \"Pitcher health, fatigue and fainting\" in section 5.",
  "This is the user's gameplay note. It replaces the old single stamina bar with Health plus Fatigue and states plainly that baseball outcomes are untouched.")

e("- **Fatigue:** each pitcher has a pitch budget from his real pitches per appearance. Past it, velocity, control and stuff fall off. Starters go about 70–90 pitches in a 6-inning game.",
  "- **Fatigue:** each pitcher has a pitch budget from his real pitches per start or relief appearance. It is his Fatigue bar and the only fatigue system (see \"Pitcher health, fatigue and fainting\" below). Past the budget, velocity, control and stuff fall off. Starters average about 76–88 pitches in a 6-inning game.",
  "One fatigue system, not two. The pitch range now matches the new section 6 target.")

e("The AI manager pulls tired pitchers, plays lefty-righty matchups, and uses the closer in save spots.",
  "The AI manager pulls tired pitchers (hooks below), plays lefty-righty matchups, and uses the closer in save spots. Every change follows MLB rules (below).",
  "Points the bullpen line to the hooks and substitution rules in the new subsection.")

S6 = """- A sharp human-like player (who guesses with real pitch usage) wins about 60–65% on the middle difficulty against an average team."""
e(S6, S6 + """

**Pitcher bars (section 5).** Calibrate with the bars and their effects on. They are part of the engine, not an add-on. Use Pro AI on both sides and single games with rested staffs.

| Stat | Target |
|---|---|
| Starter pitches | mean 76–88, SD 10–16, 90th percentile ≤ 102 |
| Starter innings | mean 4.6–5.3 |
| Relief share of innings | 12–25% |
| Pitchers per team per game | 2.0–3.0 |
| Starts under 3.0 IP (not injury) | 4–8% |
| Starters knocked out (KO) | 6–10% of starts, averaging 2.3–3.7 IP and 5–7 runs |
| Relievers knocked out (KO) | ≤ 3% of relief appearances |
| Out of gas (GAS) | ≤ 1% of starts and ≤ 1% of relief appearances |
| Games with at least one faint (either team) | 12–25% |
| Injury faints (INJ) | 1 per 250–500 games |
| AI pitching changes mid at-bat | exactly 0 |
| Pitches thrown past budget | 1–6% |
| Pitches with a Health penalty | 3–10% |
| Runs per PA while a Health penalty is on | ≤ 1.15 × league |
| AI mound visits | 0.2–0.8 per team per game |
| Position player pitching | ≤ 1 per 300 team-games, and every game finishes |
| Fatigue cost per pitch | mean 100 ± 2 hundredths |

- A/B check: 10,000 games with bar effects off and on, same seeds and hooks. Runs per team per 6 innings within ±0.05; K%, BB% and HR/PA within ±0.3 points. Freeze PF_MEAN and PH_MEAN from the "on" run.
- Bots: "Never pull" (his starter leaves only by fainting; opponents score 0.10–0.50 more runs per 6 innings than against AI management). "Pull early" (pulls at 0.8B; win rate within ±2 points of the standard bot). "Grinder" (always Take or Protect; wins no more than the sharp bot). The sharp bot still wins 60–65% on Pro.
- Tune in this order: base rates, the Fatigue base cost, the AI hooks, run damage (10), then the settled-in heal (8).""",
  "Adds the targets for faint rates, starter workload and visits, plus an effects-off/on check so the bars can't quietly move the section 6 league numbers. 10,000 games per arm is what it takes to resolve ±0.05 runs.")

e("6. **Season hub** (Season mode): schedule, standings vs. your opponents, next game, roster.",
  "6. **Season hub** (Season mode): schedule, standings vs. your opponents, next game, roster (rotation turn, tired relievers and injured pitchers marked).",
  "Season availability rules need to be visible on the roster.")

e("- Pitcher ratings: Control, Movement, Stamina, plus the four pitches.",
  "- Pitcher ratings: Control, Movement, Stamina, plus the four pitches. Stamina moves his budget along the real range of all pitchers (about 12 to 105 pitches) and shows it: \"Stamina 82 · 88 P/GS → budget 88, tank 114\". Health is read-only: \"Health 100 (all pitchers)\".",
  "The editor shows what Stamina now drives. No new rating is added for Health.")

e("- Reload mid-at-bat: the count, runners and score are restored.",
  "- Reload mid-at-bat: the count, runners, score and both pitchers' Health and Fatigue bars are restored.",
  "Reload must restore both bars.")

SS = "- Screenshots of: title, lineup card, the at-bat screen while pitching, the at-bat screen while batting, pitch menu, swing menu, editor, postgame."
e(SS, """- Screenshots of: title, lineup card, the at-bat screen while pitching, the at-bat screen while batting, pitch menu, swing menu, editor, postgame, a faint, the forced bullpen picker, and the box-score pitching notes.
- **Pitcher bars, headless** (node, seeded; fixtures are legal base/out scripts with stated starting bars):
  - A faint never changes a play. For 20,000 random (state, seed) pairs with the same pre-pitch bars, the resolved pitch and play are identical with damage constants ×0, ×1 and ×10. Diffing state across applyBars shows only bar, status, pendingChange and log fields changing.
  - Health: from 100, bases empty, no outs: single, walk, 3-run homer, then three outs leaves 44 (no heal, since runs scored). A scoreless half heals 8, capped at 100. A visit heals 10.
  - Fatigue: 10 pitches with the bases empty cost 900; with a runner on, 1,100; pitches 21–25 of an inning with the bases empty, 650. A B 88 / T 114 starter empties on pitch 127 with the bases always empty, and on pitch 104 with a runner always on. When used reaches exactly B, pF is 0; one pitch later it's above 0. HP colors change at 40/39 and 21/20.
  - A faint forces a change: once the PA ends and the minimum is met, no pitcher stays in with a destroyed bar. A visit doesn't cancel a deferred faint.
  - 3-batter minimum: a reliever forced in at HP 30 with a runner on 1st gives up a 2-run homer (16 + 10 + 10). He holds at 1 and faints after his 3rd batter whatever happens, or at the end of the half if that comes first. BULLPEN is refused before then. An injury bypasses it.
  - Mid at-bat change: the reliever inherits batter, count, runners and outs. At 3-1 a walk is charged to the departed pitcher. At 1-2 a walk, and at any count a strikeout, go to the reliever.
  - Inherited runners: with runners on 1st and 2nd, the reliever allows a double that scores both. Both runs go to the departed pitcher, and the reliever's Health drops 30 (10 + 20). The fielder's-choice swap is checked. Each pitcher's ER ≤ R, and pitchers' R sum to team R. Don't assert that pitchers' ER sum to team ER.
  - A fainted or removed pitcher can't return: the engine throws.
  - Faint on the 3rd out: no mid-inning entry, and the reliever starts the next half. Faint on a walk-off: no replacement.
  - Empty bullpen: with every pitcher removed, a bench player, then the DH, then a fielder pitches and never faints. 1,000 "chaos" games (damage ×5) all finish and every box score adds up. Sim-only safety cap: 25 innings.
  - Visits: 2 per game, the 6th-inning bonus, +1 per extra inning, one per pitcher per inning.
  - Comebacker: only on singles and infield outs, rolled on the aux RNG. Turning it off leaves the play-by-play identical up to the first pitcher struck.
  - Season: rotation rest, tired relievers sit, an injured pitcher misses 3–6 games.
  - Save and restore at every pitch of a seeded game gives an identical continuation, including mid at-bat after a change.
- **Pitcher bars, Playwright:**
  - Bars render with labels, numbers and the budget tick at both widths. A debug hook forcing HP 30, HP 15 and Fatigue past B gives the right color classes.
  - A forced faint: the result line plays before the faint lines, the picker can't be dismissed, FNT pitchers can't be picked, and the reliever shows the inherited count and runners.
  - BULLPEN shows its 3-batter reason when disabled.
  - Reload on the forced picker reopens it. Reload after a mid at-bat change restores the reliever, count, runners, score and both bars.
  - In the full random game, every pitcher who left has an exit tag or was a voluntary change, and the "pitched to N batters" notes match the play-by-play.""",
  "Covers the required tests: a faint forces a change, the reliever inherits the count, a fainted pitcher can't return, a faint never changes a play, and a reload restores both bars. Every fixture is a legal base/out script with exact integer results.")

e("- The calibration table in section 6 passes, and Claude Code shows you the numbers.",
  "- The calibration tables in section 6 pass, pitcher-bar rows included, and Claude Code shows you the numbers.\n- Pitchers faint, are replaced and are scored under MLB rules as in section 5, and a faint never changes a play.",
  "Adds the mechanic to the definition of done.")

json.dump(E, open('/tmp/claude-0/-home-user-atom/25041982-ed1b-52c3-a1a9-d5a354d2bd12/scratchpad/merge/edits.json','w'), ensure_ascii=False, indent=1)

# apply & validate
base = '/tmp/claude-0/-home-user-atom/25041982-ed1b-52c3-a1a9-d5a354d2bd12/scratchpad/merge/'
txt = open(base+'brief_orig.md').read()
anchor = "- **Box score sheet:** batting lines (AB, R, H, RBI, BB, K, HR), pitching lines (IP, H, R, ER, BB, K, pitches), and a play-by-play log."
sec = open(base+'section.md').read().rstrip('\n')
assert txt.count(anchor+"\n") == 1, "anchor"
for x in E:
    c = txt.count(x['old_str'])
    print(c, x['old_str'][:60])
    assert c == 1
    assert anchor not in x['old_str']
# insert first, then edits (and also check edits-first order)
t1 = txt.replace(anchor+"\n", anchor+"\n"+sec+"\n", 1)
for x in E:
    assert t1.count(x['old_str']) == 1, x['old_str'][:50]
    t1 = t1.replace(x['old_str'], x['new_str'], 1)
t2 = txt
for x in E: t2 = t2.replace(x['old_str'], x['new_str'], 1)
assert t2.count(anchor+"\n") == 1
t2 = t2.replace(anchor+"\n", anchor+"\n"+sec+"\n", 1)
assert t1 == t2
open(base+'brief_new.md','w').write(t1)
print("em dashes in section:", sec.count('—'), " in edits:", sum(x['new_str'].count('—') for x in E))
print("section lines:", len(sec.strip().splitlines()))
