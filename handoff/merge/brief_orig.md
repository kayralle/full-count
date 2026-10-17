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

**Fields per pitcher:** id, name, team, throws (L/R), role (SP/RP/CL from games started and saves), batters faced, K%, BB%, HR per batter faced, GB%, BABIP allowed, average pitches per appearance, and the **top four pitches**: type, usage %, average velocity, whiff %, and run value per 100.

**Ratings (1–99) derived from the stats** and shown in the editor:
- Hitters: Contact (inverse K%), Power (HR/PA and ISO), Eye (BB%), Gap (2B+3B rate), Speed (sprint speed, SB), Fielding (OAA)
- Pitchers: Stuff per pitch (whiff% and run value), Control (inverse BB%), Movement (GB%, low HR rate), Stamina (pitches per appearance)

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
- Other commands: **BULLPEN** (pitching change), **VISIT** (mound visit: steadies control for a few pitches, 2 per game), **AUTO** (the pitching coach calls the rest of the inning).

### Batter (you on offense)
- **SWING** opens the approaches:
  - **Sit fastball** / **Sit breaking** / **Sit offspeed:** guess the family. A right guess is "super effective": better contact and harder hits. A wrong guess raises whiffs.
  - **Protect:** two-strike contact; fewer strikeouts, weaker hits
  - **Swing big:** more power, more whiffs
  - **Take:** don't swing; good when the pitcher is wild
- **RUN:** steal (speed vs. pitcher's hold and catcher arm), hit-and-run, bunt / squeeze
- **BENCH:** pinch hitter, pinch runner
- **AUTO:** the hitting coach takes over for the inning

### The read chart (the Pokémon type chart)
- A grid of pitch family × batter guess, plus location × approach, shown in a **Chart** tab like Pick & Roll's.
- Show the result in the text box: "He sat on the slider. It's super effective!" or "Fooled him!"

### How one pitch resolves
1. **Ball or strike in the zone:** from the pitcher's Control, the location, fatigue and the count.
2. **Swing or not:** from the batter's approach (you or the AI), his Eye, and whether the pitch is in the zone.
3. **Contact or whiff:** batter Contact vs. that pitch's whiff rate, adjusted by the guess and location.
4. **Foul, or ball in play.**
5. **For balls in play:** batted-ball type (grounder, liner, fly, popup) from the hitter's and pitcher's GB/FB tendencies. Then the outcome (out, 1B, 2B, 3B, HR) from the hitter's power and BABIP vs. the pitcher's HR rate and BABIP allowed, nudged by the defense's fielding.
6. **Combine hitter and pitcher rates with the log5 method** against league averages, so a great hitter vs. a great pitcher lands where it should.

### Narration and effects
- Every event becomes a line in the text box with a snapshot for playback (the Pick & Roll event bus): pitch thrown, swing, contact, result, runners moving.
- Effects: strikeout ring, home-run screen flash, "super effective" shake.
- HP bars: the **pitcher's bar is stamina**, draining by pitch count. The **batter's bar is the count**: three strikes empties it. Show balls and strikes as dots too.

---

## 5. The game around the at-bat

- **Baserunning:** an advancement table by hit type and runner speed (singles score a runner from second about 60% of the time, adjusted by speed). Include double plays on grounders with a runner on first and fewer than two outs, sac flies, tag-ups, wild pitches (from Control), and errors (rare, from fielding).
- **Fatigue:** each pitcher has a pitch budget from his real pitches per appearance. Past it, velocity, control and stuff fall off. Starters go about 70–90 pitches in a 6-inning game.
- **Bullpen:** about 5 relievers with a closer. The AI manager pulls tired pitchers, plays lefty-righty matchups, and uses the closer in save spots.
- **Lineups:** 9-man batting order with a DH, positions from real data, and platoon splits applied by handedness.
- **AI on both sides:**
  - AI pitchers follow the pitcher's real usage, adjusted by count: more breaking balls when ahead, more fastballs in the zone when behind.
  - AI hitters pick approaches by count and profile.
  - The AI adapts to you. If you throw a first-pitch fastball three times in a row, it starts sitting on it. Show a hint: "They're sitting on your fastball."
- **Scorebug:** line score by inning, outs, a base diamond with runners, the count, and pitch count.
- **Box score sheet:** batting lines (AB, R, H, RBI, BB, K, HR), pitching lines (IP, H, R, ER, BB, K, pitches), and a play-by-play log.

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

---

## 7. Screens

1. **Title:** new game, continue, data date, difficulty (Rookie / Pro / All-Star), sound.
2. **Pick teams:** Exhibition (your team, opponent, home/away) or Season. Show team ratings: lineup, rotation, bullpen.
3. **Lineup card:** batting order, positions, starting pitcher, bullpen. Edit before first pitch.
4. **Game:** the battle screen.
   - Near sprite (back view) is always your player: your batter on offense, your pitcher on defense. Far sprite (front view) is the opponent.
   - Below it, the text box and command menus, as in Pick & Roll.
5. **Postgame:** line score, box score, player of the game.
6. **Season hub** (Season mode): schedule, standings vs. your opponents, next game, roster.
7. **Player editor** (section 8): reachable from the title, team picker, lineup card and season hub.

---

## 8. Player editor

**Browse:** search, filter by team and position, sort by any rating.

**Edit a player** (one sheet):
- Name, team, positions, bats/throws, role (SP/RP/CL)
- Hitter ratings: Contact, Power, Eye, Gap, Speed, Fielding, each a slider (1–99) beside the real stat it came from (for example "Power 88 · 34 HR, .260 ISO")
- Pitcher ratings: Control, Movement, Stamina, plus the four pitches. For each pitch: change its type, velocity, usage and Stuff, or add/remove a pitch (max 4)
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
- Reload mid-at-bat: the count, runners and score are restored.
- Editor: change a hitter's Power to 99, play 50 simulated games, and confirm his HR rate rose. Then reset him and confirm the original numbers return.
- Create a custom player, put him in the lineup, play a game, export the JSON, clear storage, import it, and confirm he's back.
- Extra innings start with a runner on second. A walk-off ends the game immediately.
- Screenshots of: title, lineup card, the at-bat screen while pitching, the at-bat screen while batting, pitch menu, swing menu, editor, postgame.

---

## 10. Done means

- `dist/full-count.html` opens offline and plays a full game on a phone-width screen.
- The calibration table in section 6 passes, and Claude Code shows you the numbers.
- Every player can be edited, created, reset, exported and imported.
- `python data/build_data.py && node build.js` refreshes the stats any time.
