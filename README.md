# Full Count

A Pokémon-style baseball game for the browser. Every plate appearance is a battle between a real MLB pitcher and batter, rated from 2026 stats, over a 6-inning game.

- Spec: [`docs/full-count-build-brief.md`](docs/full-count-build-brief.md)
- UI reference: [`reference/pick-and-roll-offline.html`](reference/pick-and-roll-offline.html)

## Build

```sh
python3 data/build_data.py   # pull 2026 stats → src/data.js
node build.js                # → dist/full-count.html
```

Open `dist/full-count.html` in a browser. It runs offline.
