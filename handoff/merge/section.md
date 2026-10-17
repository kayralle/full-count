
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
