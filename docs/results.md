# Full Count: calibration and test results

Data: 2026 regular season through Sep 27, 2026 (MLB Stats API and Baseball Savant), 1,044 players on 30 teams. The league targets below come from that pull.

Reproduce everything with the commands in the [README](../README.md#test).

## Section 6: the league table

`node tools/sim.js --games 3000` (Pro AI on both sides, types and bar effects on, everyone at level 50).

| Stat | Sim | 2026 target |
|---|---|---|
| K% | 22.1% | 22.1% |
| BB% | 8.8% | 8.9% |
| HR per PA | 3.1% | 3.0% |
| BABIP | .292 | .290 |
| AVG / OBP / SLG | .246 / .319 / .408 | .244 / .318 / .400 |
| Runs per team per 6 innings | 2.99 | 2.99 |
| Pitches per PA | 3.89 | 3.89 |
| Stolen base success | 77.4% | 77.0% |
| Steal attempts per team per 6 innings | 0.57 | 0.59 |

Per-hitter fidelity over 3,000 games (270 hitters with 300+ PA): simulated rates track each player's real rates with slopes of 0.90 for HR/PA, 0.95 for K% and 0.97 for BB% (1.00 would be perfect).

## Section 6: pitcher bars

Same 3,000-game run; injury faints from a separate 10,000-game run because they're rare.

| Check | Sim | Target |
|---|---|---|
| Starter pitches: mean / SD / 90th percentile | 82.1 / 10.6 / 94 | 76–88 / 10–16 / ≤102 |
| Starter innings, mean | 4.96 | 4.6–5.3 |
| Relief share of innings | 16.8% | 12–25% |
| Pitchers per team per game | 2.15 | 2.0–3.0 |
| Starts under 3.0 IP, not injury | 4.1% | 4–8% |
| Starters knocked out | 8.6% of starts, 3.2 IP, 6.1 runs | 6–10%, 2.3–3.7 IP, 5–7 runs |
| Relievers knocked out | 0.06% of appearances | ≤3% |
| Out of gas | 0.06% of appearances | ≤1% |
| Games with a faint | 16.7% | 12–25% |
| Injury faints (10,000 games) | 1 per 417 games | 1 per 250–500 |
| AI pitching changes mid at-bat | 0 | 0 |
| Pitches past budget | 1.6% | 1–6% |
| Pitches with a Health penalty | 8.1% | 3–10% |
| Runs per PA with a Health penalty ÷ league | 0.99 | ≤1.15 |
| AI mound visits per team per game | 0.29 | 0.2–0.8 |
| Position player pitching per team-game | 0.0007 (1 per 1,400) | ≤1 per 300 |
| Fatigue cost per pitch (hundredths) | 100.5 | 100 ± 2 |

A/B over 10,000 games, same seeds (`node tools/checks.js bars`): bar effects on vs off, runs 3.017 vs 3.008 (Δ 0.009, target ±0.05); K 22.3% vs 22.3%, BB 8.8% vs 8.7%, HR 3.1% vs 3.1% (target ±0.3 points).

Bullpen bots on Pro, mirror team (`node tools/checks.js bots`, 900 games each; the never-pull row also over 3,000):

| Bot | Result | Target |
|---|---|---|
| Standard (sharp bot, coach's bullpen calls) | 61.3% | 60–65% |
| Pull early (at 0.8 × budget) | 60.6% (−0.7 points) | within ±2 points of standard |
| Grinder (always Take or Protect) | 41.7% | no more than the sharp bot |
| Never pull (starter leaves only by fainting) | opponents score +0.07 runs per game over 3,000 games (+0.02 over 900) | +0.10 to +0.50 |

**Never pull is just under its band.** Leaving a tired starter in costs about 0.07 runs a game, with a standard error near 0.06, against a floor of 0.10. The two levers are the fatigue penalty sizes, which the brief fixes in section 5 (zone −10%, whiffs −20%, HR +40%, BABIP +.020 at an empty tank), and the AI hooks, which also set the starter pitch-count rows that pass now. Raising the penalties by about half would likely clear it, at the cost of changing a spec constant.

## Section 6: other checks

`node tools/checks.js all`

| Check | Result | Target |
|---|---|---|
| Power 99 (Freddie Freeman, real Power 51), 600 games | 2.8% → 5.2% HR/PA; reset gives 2.8% again | clearly more |
| A real ace (top-10 K% starters) | opponents strike out 29.9% and reach base at .294 (league 22.1% and .318) | well below average |
| Sharp bot on Pro vs. a mirror team, 400 games | 63.5% (the coach's own picks 53.3%, random menu choices 45.0%) | 60–65% |

## Section 11: types and levels

| Check | Result | Target |
|---|---|---|
| Section 6 table with types on | passes (above) | passes |
| Types off vs on, 10,000 games | runs 2.974 vs 2.973 (Δ 0.002); K 22.3% vs 22.3%, BB 8.8% vs 8.7%, HR 3.1% vs 3.0% | ±0.05 runs, ±0.3 points |
| League mean of centered pitch and swing edges | 0.0000 and 0.0000 | ±0.02 |
| Largest change to one player's line, types on vs off | .0013 wOBA (Christian Walker) | ±.006 |
| Largest type shift on any probability | 0.30 log-odds (the cap) | ≤0.30 |
| "Super effective" text on strikeouts and whiffs | 8% | 3–12% |
| Level gap +5 / +10 / +20 (1,500 games each) | 59.1% / 65.3% / 80.3% (equal levels 51.1%) | 56–62% / 63–72% / 78–90% |
| XP pace, everyday hitter at equal levels | 1.27 levels per game | 1.0–1.4 |
| EVs to 510, everyday hitter | game 48 | 35–60 |
| Pennant Run, sharp bot | Champion in 69 games; at most 3 retries for any leader | 45–70 games, ≤3 retries each |

## Tests

- **Engine** (`node --test tests/engine.test.js`): 27 of 27 pass. They cover the section 9 headless list: the type chart in all 324 cells, centered edges, exact Health and Fatigue arithmetic, faints and the 3-batter minimum, mid at-bat changes and the 9.16(h) walk rule, inherited runners, no re-entry, faints on the third out and on a walk-off, empty bullpens and 1,000 chaos games, visits, comebackers on the aux RNG, "a faint never changes a play" (damage ×0, ×1, ×10), extra innings and walk-offs, save and restore at every pitch, Season rest and injuries, Pennant Run stages, and editor overrides.
- **Browser** (`npm run test:ui`): 12 of 12 pass, at 390×844 and at 1280×860. A full random game through the menus (opened from the file itself) with a box-score audit: runs equal the line score and the batting lines, hits match, pitchers' runs add up, every pitcher who left has an exit tag or was a voluntary change, and each "pitched to N batters" note matches the play-by-play. Reloads mid at-bat, on the forced picker and after a mid at-bat change restore the count, runners, score and both pitchers' bars. Also: a forced faint (the result plays first, the picker can't be dismissed, FNT pitchers can't be picked), Bullpen's 3-batter reason, extra innings and a walk-off, the bar color classes, the editor (Power 99 over 50 games and reset, a custom player through a game and export/import, types and level through reload and export/import, team batting orders and rotations), "Super effective" pitch cards, the Chart tab and the Pennant Run level-up screen. Screenshots are in [`screenshots/`](screenshots/).

## Bugs the tests found

- **Pitching change before the first pitch.** When you went to the bullpen at the start of an at-bat, the departing pitcher still threw that at-bat and was charged with the batter. The random-game audit caught it: a box-score note said a pitcher faced a batter the play-by-play gave to his reliever. Now the new pitcher takes the at-bat, and only a change after the first pitch inherits the count.
- **Reloads in the test browser.** Chromium's test contexts sometimes drop a `file://` page's localStorage on reload: every key, including one the test wrote itself. That's the test browser, not the game. Tests that reload serve the same file over a local http server; the full random game still runs from `file://`.

## Sample sizes

Some checks need more games than their first versions used. A win rate over 400 games has a standard error of about 2.5 points, as wide as the +5 level band, and a rate over 150 games was too noisy for the Power 99 test. The defaults in `tools/checks.js` are now 1,500 games for the level gaps, 600 for Power 99 and 900 per bullpen bot. Injury faints are only judged on 10,000+ games.
