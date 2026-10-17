# Full Count

A Pokémon-style baseball game for the browser. Every plate appearance is a battle between a real MLB pitcher and batter, rated from 2026 stats, over a 6-inning game. You call every pitch on defense and every swing on offense.

**Play:** open [`dist/full-count.html`](dist/full-count.html) in any browser. It's one file and runs offline (on iPhone, save it to Files and open it from there).

- Spec: [`docs/full-count-build-brief.md`](docs/full-count-build-brief.md)
- Calibration and test results: [`docs/results.md`](docs/results.md)
- Screenshots: [`docs/screenshots/`](docs/screenshots/)
- UI reference: [`reference/pick-and-roll-offline.html`](reference/pick-and-roll-offline.html)

## What's in it

- **Modes:** Exhibition (any two teams), Season (12 games and a four-round playoff) and Pennant Run (start at level 5, beat 8 Division Leaders, the Elite Four and the Champion).
- **The at-bat:** pick one of the pitcher's real pitches and a location, or a swing approach (sit on a pitch family, protect, swing big, take). Steal, hit-and-run, bunt and squeeze.
- **Timed swings:** after you pick a swing, the pitch comes in on a plate view and you swipe the swing's shape (level, uppercut or chop) as it reaches the plate, or hold off to take. Perfect timing hits harder; early or late fouls off or misses. Space bar works on desktop, and the Bench menu has a menus-only setting.
- **Pitcher bars:** Health drops with hits, walks and runs; Fatigue drops with every pitch. A pitcher faints when either empties, and MLB substitution rules take over (the 3-batter minimum, inherited runners and counts, no re-entry).
- **Types and levels:** 18 types on the real Pokémon chart with baseball names, STAB, levels, IVs and EVs. In Pennant Run your players level up as they face stronger teams.
- **Player editor:** every player's ratings, pitches, types, level, IVs and EVs; custom players and teams; batting orders and rotations; export and import as JSON.

## Build

```sh
python3 data/build_data.py   # pull 2026 stats from the MLB Stats API and Baseball Savant → src/data.js
node build.js                # inline data, engine and UI → dist/full-count.html
```

`data/build_data.py --refresh` re-downloads instead of using the cache in `data/raw/`.

## Test

```sh
node --test tests/engine.test.js          # headless engine rules (bars, substitutions, types, levels, modes)
node tools/sim.js --games 3000            # the section 6 calibration table
node tools/checks.js all                  # Power 99, ace, sharp bot, levels, XP pace (also: bots, types, bars, pennant)
npm install && npm run test:ui            # Playwright: the built file in Chromium at 390x844 and desktop
```

## Layout

| Path | What |
|---|---|
| `data/build_data.py` | Fetches and rates players, writes `src/data.js` |
| `src/engine.js` | The game engine, no DOM. Runs in Node for the sims and tests |
| `src/ui.js`, `src/head.html` | The UI and styles |
| `build.js` | Builds the single file |
| `tools/` | Calibration sim, checks, base-rate tuner, one-game printer |
| `tests/` | Engine tests (node:test) and browser tests (Playwright) |
