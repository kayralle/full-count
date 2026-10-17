# Full Count: build brief for Claude Code

A Pokémon-style baseball game. Every plate appearance is a one-on-one battle between pitcher and batter. You pitch when the other team bats and hit when your team bats, over a 6-inning game. Players are real MLB players rated from their 2026 stats, and everything about them can be edited.

"Full Count" is a working title. Rename it if you like.

---

## 1. Paste this into Claude Code

> Build "Full Count", a browser baseball game, following `full-count-build-brief.md` in this folder. Read the whole brief first. Work in this order: (1) the data script, (2) the engine with headless simulations until the calibration targets in section 6 pass, (3) the UI, (4) the player editor, (5) Playwright tests at 390px width. Use `pick-and-roll-offline.html` in this folder as the reference for the battle screen, menus, text box, playback queue, sprites and save system; reuse its patterns rather than inventing new ones. Show me the simulation results before you build the UI.

Put these files in the project folder before you start:
- `full-count-build-brief.md` (this file)
- `pick-and-roll-offline.html` (the basketball game; it has the UI patterns to copy)

---

## 2. What to build

| Item | Decision |
|---|---|
| Format | One self-contained HTML file that runs offline by double-clicking. No frameworks. Google Fonts only. |
| Source layout | `data/build_data.py` → `src/data.js`, `src/engine.js` (no DOM), `src/ui.js`, `src/head.html`; `build.js` concatenates into `dist/full-count.html` |
| Screen | Phone first (390px wide), works on desktop. Dark, handheld-game look, like Pick & Roll |
| Game length | 6 innings. Extra innings with a runner on second (the MLB rule) if tied |
| Your role | Both sides. On defense you call every pitch. On offense you pick every swing approach |
| Modes | **Exhibition** (any two teams, either one can be yours) and **Season** (short schedule plus playoffs, as in Pick & Roll) |
| Saving | `localStorage`, wrapped in try/catch. Game state saves after every pitch, so a reload resumes mid-at-bat |
| Art | Original pixel sprites drawn in code: pitcher and batter, in team colors. No MLB logos, uniform marks or photos. Keep Pick & Roll's sprite-folder loader (`sprites/<player-name>.png`) |

---

## 3. Data pipeline (`data/build_data.py`)

Pull the 2026 regular season. Claude Code runs on your computer, so these sources should be reachable. Check each URL format before relying on it, because parameters change.

**Sources**
1. **MLB Stats API** (free, no key): `https://statsapi.mlb.com/api/v1/`
   - Season hitting: `stats?stats=season&group=hitting&season=2026&sportId=1&playerPool=all&limit=3000`
   - Season pitching: `stats?stats=season&group=pitching&season=2026&sportId=1&playerPool=all&limit=3000`
   - Teams: `teams?sportId=1&season=2026`
   - Active rosters: `teams/{teamId}/roster?rosterType=active` (40-man roster as a fallback in the offseason)
   - Handedness and position: `people/{id}` (`batSide`, `pitchHand`, `primaryPosition`)
2. **Baseball Savant** CSV leaderboards (add `&csv=true`):
   - Pitch arsenals (usage and velocity by pitch type): `leaderboard/pitch-arsenals`
   - Pitch arsenal stats (whiff%, run value by pitch): `leaderboard/pitch-arsenal-stats`
   - Sprint speed: `leaderboard/sprint_speed`
   - Outs above average (fielding): `leaderboard/outs_above_average`
3. **Fallback:** the `pybaseball` package (`batting_stats`, `pitching_stats`, `statcast_*` helpers) if a URL breaks.

**Who to include**
- Hitters with 150+ PA in 2026. Pitchers with 30+ IP, or 20+ relief appearances.
- Players who missed most of 2026 to injury get their 2025 numbers, flagged in the data.
- Blend the two seasons for rate stats (2026 weight 1, 2025 weight 0.5) so small samples don't swing ratings.
- Each team needs at least 13 hitters and 12 pitchers. Fill gaps from the 40-man roster with replacement-level ratings.
- Save the date the data was pulled and show it on the title screen ("Stats through Sept 28, 2026").

**Fields per hitter:** id, name, team, positions (primary plus others played), bats (L/R/S), PA, K%, BB%, HBP rate, 1B/2B/3B/HR per PA, BABIP, GB%/FB%/LD%, pull%, SB and CS, sprint speed, OAA by position, plus AVG/OBP/SLG/OPS for display.

**Fields per pitcher:** id, name, team, throws (L/R), role (SP if at least half his games are starts and he averages 60+ pitches per start, so openers count as RP; CL from saves), batters faced, K%, BB%, HR per batter faced, GB%, BABIP allowed, average pitches per start and per relief appearance (Stats API `statSplits` with `sitCodes=sp,rp`, or game logs; fallback: total pitches ÷ appearances), and the **top four pitches**: type, usage %, average velocity, whiff %, and run value per 100.

**Ratings (1–99) derived from the stats** and shown in the editor:
- Hitters: Contact (inverse K%), Power (HR/PA and ISO), Eye (BB%), Gap (2B+3B rate), Speed (sprint speed, SB), Fielding (OAA)
- Pitchers: Stuff per pitch (whiff% and run value), Control (inverse BB%), Movement (GB%, low HR rate), Stamina (pitches per start or per relief appearance; it sets his Fatigue budget, section 5)

The engine runs on **the underlying rates**. Ratings are a readable layer, and editing a rating shifts the rates behind it (section 8).

---

## 4. The at-bat

Resolve **pitch by pitch**, so the count drives the back-and-forth.

### Pitcher (you on defense)
- **PITCH** opens his four real pitches in a 2×2 grid, Pokémon-move style. Each shows its type, velocity, usage and how it plays against this batter.
- Pitch families act like Pokémon types: **Fastball** (4-seam, sinker, cutter), **Breaking** (slider, sweeper, curve), **Offspeed** (changeup, splitter).
- After the pitch, pick a **location**:
  - **Attack the zone:** likely strike, more contact
  - **Paint the edge:** fewer good swings, more balls
  - **Elevate:** fastballs gain whiffs, mistakes go deep
  - **Bury it low:** breaking balls gain chases and grounders
  - **Chase:** out of the zone on purpose, for when you're ahead in the count
- Other commands: **BULLPEN** (pitching change), **VISIT** (mound visit: +10 Health and steadies his control, with no Health penalty for 3 pitches; 2 per game, see section 5), **AUTO** (the pitching coach calls the rest of the inning).

### Batter (you on offense)
- **SWING** opens the approaches:
  - **Sit fastball** / **Sit breaking** / **Sit offspeed:** guess the family. A right guess is "super effective": better contact and harder hits. A wrong guess raises whiffs.
  - **Protect:** two-strike contact; fewer strikeouts, weaker hits
  - **Swing big:** more power, more whiffs
  - **Take:** don't swing; good when the pitcher is wild
- **RUN:** steal (speed vs. pitcher's hold and catcher arm), hit-and-run, bunt / squeeze
- **BENCH:** pinch hitter (between plate appearances), pinch runner
- **AUTO:** the hitting coach takes over for the inning

### The read chart (the Pokémon type chart)
- A grid of pitch family × batter guess, plus location × approach, shown in a **Chart** tab like Pick & Roll's.
- Show the result in the text box: "He sat on the slider. It's super effective!" or "Fooled him!"

### How one pitch resolves
1. **Ball or strike in the zone:** from the pitcher's Control, the location, his Health and Fatigue bars (section 5) and the count.
2. **Swing or not:** from the batter's approach (you or the AI), his Eye, and whether the pitch is in the zone.
3. **Contact or whiff:** batter Contact vs. that pitch's whiff rate, adjusted by the guess and location.
4. **Foul, or ball in play.**
5. **For balls in play:** batted-ball type (grounder, liner, fly, popup) from the hitter's and pitcher's GB/FB tendencies. Then the outcome (out, 1B, 2B, 3B, HR) from the hitter's power and BABIP vs. the pitcher's HR rate and BABIP allowed, nudged by the defense's fielding.
6. **Combine hitter and pitcher rates with the log5 method** against league averages, so a great hitter vs. a great pitcher lands where it should.

### Narration and effects
- Every event becomes a line in the text box with a snapshot for playback (the Pick & Roll event bus): pitch thrown, swing, contact, result, runners moving.
- Effects: strikeout ring, home-run screen flash, "super effective" shake.
- **HP bars and fainting.** It's still baseball. Every pitch and play resolves by baseball rules first. A hit is a hit, an out is an out, and runs, outs, innings and the win are pure baseball. On top of that, each pitcher has two Pokémon-style bars: **Health** (how hard he's been hit today) and **Fatigue** (his pitch budget). If either bar is destroyed, the pitcher **faints**. He's knocked out of the game, out of gas or hurt, and must be replaced under MLB rules: no re-entry, the reliever inherits the count and runners, inherited runners stay charged to the pitcher who put them on, and the 3-batter minimum applies unless he's hurt. The bars never change a play that already happened. They only change how well he pitches from then on and when he has to leave. Batters don't faint: the **batter's bar is the count**, and three strikes empties it. Show balls and strikes as dots too. Full rules: "Pitcher health, fatigue and fainting" in section 5.

---

## 5. The game around the at-bat

- **Baserunning:** an advancement table by hit type and runner speed (singles score a runner from second about 60% of the time, adjusted by speed). Include double plays on grounders with a runner on first and fewer than two outs, sac flies, tag-ups, wild pitches (from Control), and errors (rare, from fielding).
- **Fatigue:** each pitcher has a pitch budget from his real pitches per start or relief appearance. It is his Fatigue bar and the only fatigue system (see "Pitcher health, fatigue and fainting" below). Past the budget, velocity, control and stuff fall off. Starters average about 76–88 pitches in a 6-inning game.
- **Bullpen:** about 5 relievers with a closer. The AI manager pulls tired pitchers (hooks below), plays lefty-righty matchups, and uses the closer in save spots. Every change follows MLB rules (below).
- **Lineups:** 9-man batting order with a DH, positions from real data, and platoon splits applied by handedness.
- **AI on both sides:**
  - AI pitchers follow the pitcher's real usage, adjusted by count: more breaking balls when ahead, more fastballs in the zone when behind.
  - AI hitters pick approaches by count and profile.
  - The AI adapts to you. If you throw a first-pitch fastball three times in a row, it starts sitting on it. Show a hint: "They're sitting on your fastball."
- **Scorebug:** line score by inning, outs, a base diamond with runners, the count, and pitch count.
- **Box score sheet:** batting lines (AB, R, H, RBI, BB, K, HR), pitching lines (IP, H, R, ER, BB, K, pitches), and a play-by-play log.

### Pitcher health, fatigue and fainting

It's still baseball. Every pitch and play resolves and is recorded first, by the rules above. A hit is a hit, an out is an out, and runs, outs, innings and the win are pure baseball. The bars only decide how well a pitcher throws from the next pitch on, and when he has to leave. Batters have no bars and never faint. Their bar is the count.

**Health (HP): how hard he's been hit today.** At 0 he's knocked out of the game. It is not a medical bar.
- 100 for every pitcher, every game. No new rating: better pitchers take less damage because they allow less.
- Damage, after the play is final: walk or HBP 4, single 6, double 10, triple 12, home run 16, wild pitch or balk 2.
- Plus 10 for each run that scores while he's on the mound, inherited runners included. A tainted run costs 5: the runner reached on an error or is the extra-inning runner, or he scored on an error or passed ball. Never use official ER here; it can change later in the inning.
- No damage for outs, intentional walks, errors, passed balls or steals. The same scorebook event always costs the same.
- Restores: +8 when a half-inning ends with no run scored while he pitched ("settled in"), +10 for a mound visit. Never above 100.
- Rough math at league rates: an average starter ends around 60–70. About 5 runs on 8 hits in 3 innings knocks him out.

**Fatigue (FTG): his pitch budget.** At 0 he's out of gas. This is section 5's pitch budget made visible, and it is the only fatigue system.
- Budget B: his real pitches per start (SP) or per relief appearance (RP/CL), blended as in section 3, clamped 12–105, set through Stamina. Tank T = max(round(1.3 × B), 30). B 88 gives T 114. B 17 gives T 30.
- Cost per pitch, kept as integer hundredths: 90, +20 with any runner on base, +40 from his 21st pitch of the inning. Tune the base so the league average is 100 ± 2, so B, T and "used" (hundredths ÷ 100) all read as real pitch counts. Intentional walks cost 0.
- Nothing restores it during a game. Dugout time and mound visits don't rest an arm.

**Effects on pitching.** Read once before each pitch, from the bars after the last pitch. They change only the pitcher's inputs, before log5. They never touch a play already made.
- Fatigue: pF = clamp((used − B) / (T − B), 0, 1), so 0 until he passes his budget. In-zone rate × (1 − 0.10 pF), whiff rate × (1 − 0.20 pF), HR allowed × (1 + 0.40 pF), BABIP allowed + .020 pF, wild pitches × (1 + pF). Shown velocity drops 3 mph × pF.
- Health: pH = clamp((40 − HP) / 40, 0, 1), so 0 at 40 or more. In-zone rate × (1 − 0.05 pH), mistake chance (the pitch catches the heart of the plate) + 4 points × pH, wild pitches × (1 + 0.5 pH). Command only: no effect on stuff or velocity.
- Real rates already include tired innings, so center each effect: use (pF − PF_MEAN) and (pH − PH_MEAN), measured in calibration and then frozen. Clamp every probability to 0.02–0.95.

**Fainting.** Either bar at 0 means he faints and is forced out: KO (Health), GAS (Fatigue) or INJ (injury). A destroyed bar always ends in a faint.
- After every pitch, in this order: resolve and record the play; count a finished PA toward his 3-batter total; apply the Fatigue cost and Health damage; roll for a comebacker; check for a faint; if the half ended and he's still in, apply the settled-in heal.
- He leaves at the first legal moment: the end of the current PA or of the half-inning, once the 3-batter minimum is met. Until then the bar holds at 1, he's flagged faintDeferred and he pitches at full penalties ("running on fumes", "hanging on"). No heal cancels it.
- So the AI never changes pitchers mid at-bat. A faint on the 3rd out means he doesn't come back out. A faint on the final out or a walk-off is logged, with no replacement.
- Comebacker: only on a grounder or liner whose result is a single or an infield out. Roll on the aux RNG: 0.07% of those balls strike him, and 20% of those are injuries (INJ), whatever his bars. A pitcher struck but not hurt takes no damage. An injury is immediate and exempt from the 3-batter minimum. Never rolled for a position player.

**Pitching changes follow MLB rules.**
- The reliever enters with full bars and no warm-up penalty (a simplification). An injured pitcher's replacement may take as many warm-ups as he needs (5.07(b)).
- 3-batter minimum (5.10(g)): a pitcher may leave only after 3 finished PAs this appearance (retired or reached base, intentional walks included), at the end of a half, or when injured. Coming back out for a new inning keeps the count going (CONFIG flag; check the current rulebook). Track it separately from his BF stat.
- Mid at-bat change (your BULLPEN only, after the minimum): the reliever inherits the batter, count, runners and outs, and that batter counts toward his minimum. Pitches already thrown stay with the departed pitcher. If the count was 2-0, 2-1, 3-0, 3-1 or 3-2 and the batter walks, the walk and that runner go to the departed pitcher (9.16(h)). Anything else, a strikeout included, goes to the reliever.
- Inherited runners stay charged to the pitcher who put them on (9.16(g)). If a fielder's choice retires one, the batter-runner takes over that charge. A runner caught stealing or picked off passes nothing on. The reliever's line shows IR/IRS, but his Health still takes the 10. Relievers get no benefit of earlier errors (9.16(i)). The extra-inning runner is unearned, belongs to the pitcher who started the half, and is not a batter faced.
- No re-entry (5.10(d)): a removed pitcher can't come back or move to the field. The engine rejects it and the UI greys him out as FNT or USED. A two-way player who also hits stays in as DH (5.11(b)).
- Empty bullpen, in order: an available pitcher; a tired reliever (Season); a bench position player; the DH to the mound (the DH ends and he keeps his batting spot, 5.11); a fielder to the mound with the DH taking his position. A position player can't faint (bars hold at 1), so every game ends. If nobody is left, the pitcher stays in at 1 and it's logged.
- Position player profile: 70 mph lob fastball and 55 mph eephus; K 6%, BB 10%, HR per batter 7%, BABIP .330. Voluntary use only when trailing by 8+, leading by 10+ in the 6th or later, or in extra innings. Using one at any score when out of pitchers is a house rule.
- Pinch hitters enter only between plate appearances, so 9.15(b) never applies. A starter needs 4.0 IP for the win (house scaling of 9.17(b)'s 5.0, in CONFIG). A fainted pitcher keeps his line and can be the pitcher of record.

**AI manager.** The rules are the same at every difficulty. Only the hooks and the help change. Pro (also used by AUTO and calibration), checked between batters and at the start of each half:
- Start of a half: replace him if used ≥ B − 8.
- Mid-inning: replace him if he's past B with a runner in scoring position, or if 12 or fewer pitches are left in the tank.
- No Health hook: Health 0 is the hook. Visit once when his Health first drops to 30 or below, if a visit is left.
- Matchups and the closer as above.
- Rookie: start-of-half hook at B, mid-inning only at 6 or fewer left, no AI visits. You get coach prompts at Health under 40, at 0.8B and at B ("Smith is tiring. Bring in Jones?"). All-Star: start-of-half hook at B − 14, and AI hitters take 5 points more often on 0-0 and 1-0 against a pitcher past budget.

**Your controls.**
- Both pitchers' bars are always shown. Pitch count, hits, walks and runs are public information.
- BULLPEN lists relievers with throws, role, budget and availability. FNT and USED pitchers are greyed out. During the minimum it's disabled: "Smith must face 2 more batters (3-batter minimum)."
- VISIT: +10 Health, and no Health penalty for 3 pitches (Steadied). 2 per game, +1 in the 6th if both are used, +1 per extra inning. One per pitcher per inning: a second trip would force his removal (5.10(l)), so the menu says to use BULLPEN.
- When your pitcher faints, a bullpen picker opens with no Cancel and the coach's pick highlighted. AUTO picks for you.
- On offense you wear down the other pitcher only by playing baseball. Long at-bats drain his Fatigue; hits and runs drain his Health.

**Season.** Bars start full every game.
- Starters go in rotation order, with at least 4 team games between starts.
- A reliever who threw 30+ pitches, or pitched in each of the last 2 games, sits out the next game. He's used only if the bullpen is otherwise empty.
- An injured pitcher misses the next 3–6 team games (aux RNG), shown on the roster.

**Screen and text.**
- Pitcher info box: two stacked bars, "HP 64/100" and "FTG" with the real pitch count ("P 79") and a tick at B. The batter box is unchanged.
- Colors are the penalty tiers, as CSS tokens. HP: green 40–100, yellow 21–39, red 0–20. FTG: green until he passes B, yellow for the first half past B, red after. Bars use role=meter with aria values. Reduced motion skips the animation.
- The result line always plays first, then the bars move over 400 ms. Faint: the sprite sinks and fades, and the screen dims briefly.
- Lines: "Smith is rattled! His command is slipping." (HP under 40) · "Smith is on the ropes!" (20 or less) · "Smith is tiring. (70 pitches)" (0.8B) · "Smith is past his pitch budget." (B) · "Smith settled in." · "The pitching coach heads to the mound..." then "Smith takes a breath. He's steadied!" · "Smith is hanging on! He has to face 1 more batter." · "Smith is running on fumes! He has to finish this batter." · "It deflects off Smith! He stays in the game." · "Smith fainted!" then "He's been knocked out of the game." or "He's out of gas. 104 pitches." · "The comebacker hits Smith!" then "Smith fainted! The trainer helps him off the field." · "Choose your next pitcher." · "Go, Jones!" or "Now pitching for Seattle: Jones." then "Jones inherits a 2-1 count." / "He inherits 2 runners." · "Out of pitchers! Infielder Diaz takes the mound."
- Box score: exit tags "Smith (KO)", "Lee (GAS)", "Park (INJ)", kept even if you pull him while faintDeferred. AI and voluntary changes get none. Tags never change a stat. Notes: "Smith pitched to 2 batters in the 5th." (only if he left without an out that inning), "Inherited runners-scored: Jones 2-1.", "Pitches-strikes: Smith 94-61, Jones 17-11." Play-by-play: "B5: Smith fainted (KO). Jones replaces Smith, inherits 2 runners."

**Engine.**
- applyBars (after the play) is the only writer. barPenalties (before the next pitch) is the only reader. One BARS object in engine.js holds every number above, the EFFECTS, FAINT and COMEBACKER flags, and a test-only hook to force bar states.
- Bar randomness uses its own seeded aux RNG, never the play RNG.
- Save after every pitch: per pitcher hp, used, B, T, BF, 3-batter count, inning pitches, faintDeferred, Steadied pitches left, visited this inning, status, exit reason and inning; per team visits left; per runner the responsible pitcher; for a live PA the count at the change and the departed pitcher; any pending forced change; every RNG state; Season workloads and injuries. A reload on the forced picker reopens it.

---

## 6. Calibration targets (headless simulations)

Run at least 500 simulated games with AI on both sides. Check the results against the league averages in the 2026 data you pulled. Roughly, for recent seasons:

| Stat | Target (check against your pulled 2026 league totals) |
|---|---|
| K% | about 22% |
| BB% | about 8.5% |
| HR per PA | about 3% |
| BABIP | about .290 |
| AVG / OBP / SLG | about .245 / .315 / .405 |
| Runs per team per 6 innings | about 2.9 (a 9-inning game is about 4.4) |
| Pitches per PA | about 3.9 |
| Stolen base success | about 78% |

Also check:
- A 99-Power edited hitter hits clearly more home runs than his real self.
- A real ace (top-10 K%) holds hitters well below league average.
- A sharp human-like player (who guesses with real pitch usage) wins about 60–65% on the middle difficulty against an average team.

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
- Tune in this order: base rates, the Fatigue base cost, the AI hooks, run damage (10), then the settled-in heal (8).

---

## 7. Screens

1. **Title:** new game, continue, data date, difficulty (Rookie / Pro / All-Star), sound.
2. **Pick teams:** Exhibition (your team, opponent, home/away) or Season. Show team ratings: lineup, rotation, bullpen.
3. **Lineup card:** batting order, positions, starting pitcher, bullpen. Edit before first pitch.
4. **Game:** the battle screen.
   - Near sprite (back view) is always your player: your batter on offense, your pitcher on defense. Far sprite (front view) is the opponent.
   - Below it, the text box and command menus, as in Pick & Roll.
5. **Postgame:** line score, box score, player of the game.
6. **Season hub** (Season mode): schedule, standings vs. your opponents, next game, roster (rotation turn, tired relievers and injured pitchers marked).
7. **Player editor** (section 8): reachable from the title, team picker, lineup card and season hub.

---

## 8. Player editor

**Browse:** search, filter by team and position, sort by any rating.

**Edit a player** (one sheet):
- Name, team, positions, bats/throws, role (SP/RP/CL)
- Hitter ratings: Contact, Power, Eye, Gap, Speed, Fielding, each a slider (1–99) beside the real stat it came from (for example "Power 88 · 34 HR, .260 ISO")
- Pitcher ratings: Control, Movement, Stamina, plus the four pitches. Stamina moves his budget along the real range of all pitchers (about 12 to 105 pitches) and shows it: "Stamina 82 · 88 P/GS → budget 88, tank 114". Health is read-only: "Health 100 (all pitchers)". For each pitch: change its type, velocity, usage and Stuff, or add/remove a pitch (max 4)
- Live preview: "Projected: .280 / .350 / .510, 32 HR per 600 PA", from a quick simulation or the rate formulas

**Create a player:** blank or copy an existing one. Custom players get a "Custom" tag.

**Rosters:** move players between teams, set batting orders and rotations, and build a custom team from scratch (name, short name, colors).

**Reset:** per player ("back to real stats"), per team, or everything.

**How edits work:**
- Store edits as overrides keyed by player id. Never overwrite the source data, so a data refresh keeps your edits.
- A rating change maps to a rate change. For example, each Power point shifts HR/PA along the real league range (1st to 99th percentile), and the other rates rebalance so totals stay sensible.

**Share:** export and import all edits as JSON. Use a text box with a Copy button, because some viewers block file downloads.

---

## 9. Tests (Playwright at 390×844, plus desktop)

- Play a full 6-inning game through the menus with random choices: no console errors, the game ends, and the box score adds up (runs = sum of the line score; hits match the batting lines).
- Reload mid-at-bat: the count, runners, score and both pitchers' Health and Fatigue bars are restored.
- Editor: change a hitter's Power to 99, play 50 simulated games, and confirm his HR rate rose. Then reset him and confirm the original numbers return.
- Create a custom player, put him in the lineup, play a game, export the JSON, clear storage, import it, and confirm he's back.
- Extra innings start with a runner on second. A walk-off ends the game immediately.
- Screenshots of: title, lineup card, the at-bat screen while pitching, the at-bat screen while batting, pitch menu, swing menu, editor, postgame, a faint, the forced bullpen picker, and the box-score pitching notes.
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
  - In the full random game, every pitcher who left has an exit tag or was a voluntary change, and the "pitched to N batters" notes match the play-by-play.

---

## 10. Done means

- `dist/full-count.html` opens offline and plays a full game on a phone-width screen.
- The calibration tables in section 6 pass, pitcher-bar rows included, and Claude Code shows you the numbers.
- Pitchers faint, are replaced and are scored under MLB rules as in section 5, and a faint never changes a play.
- Every player can be edited, created, reset, exported and imported.
- `python data/build_data.py && node build.js` refreshes the stats any time.
