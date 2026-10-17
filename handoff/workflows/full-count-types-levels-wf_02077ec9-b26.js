export const meta = {
  name: 'full-count-types-levels',
  description: 'Design an 18-type Pokemon type chart with baseball archetype names, plus levels/XP/IVs/EVs progression, for the Full Count brief',
  phases: [
    { title: 'Design', detail: '3 independent full designs' },
    { title: 'Critique', detail: 'baseball-logic purist + engine/calibration critic' },
    { title: 'Synthesize', detail: 'brief-ready section + edits' },
    { title: 'Verify', detail: 'adversarial check incl. type chart accuracy' },
  ],
}

const BRIEF = '/root/.claude/uploads/25041982-ed1b-52c3-a1a9-d5a354d2bd12/160bcced-full-count-build-brief.md'

const ASK = `The user's new request, verbatim: "Can you add a typing system identical to pokemon except for the names of types being fun baseball archetypes instead of the pokemon type names. Also factor in EVs and IVs and leveling up as you face higher level opponents like how pokemon games progress"

Their earlier request (being designed in parallel, assume it exists): "it still works like a baseball game but pitchers can faint if their health bar or fatigue bar is destroyed. But a hit is essentially still a hit in terms of the games objective staying true to baseball while having some features of pokemon battles but it's gotta make sense as a baseball game with logic". So pitchers will have a Health bar (drained mainly by hits / hard contact / runs allowed) and a Fatigue bar (pitch count); either at zero = pitcher faints = forced out of the game under normal MLB substitution rules. Batters do not faint; their bar is the count.`

const CONTEXT = `Read the full build brief at ${BRIEF} first. It specs "Full Count", a Pokemon-style browser baseball game: each plate appearance is a pitcher-vs-batter battle, players are real MLB players rated from 2026 stats, pitch-by-pitch engine using log5 vs league average, 6-inning games, calibration targets in section 6, Exhibition and Season modes, a full player editor (section 8). Section 4 currently calls pitch families (Fastball/Breaking/Offspeed) "types" and has a guess-based "read chart"; that read game stays, but the new 18-type system must be clearly separate from it and the wording reconciled.

${ASK}

Hard constraints:
- TYPE CHART: exactly the Pokemon Gen 6+ chart: 18 types, every attacking-vs-defending multiplier identical (2x, 0.5x, 0x, dual-type multiplication to 4x/0.25x), STAB 1.5x. Only the names change, to fun baseball archetypes. Each name must be a recognizable baseball archetype and should, where possible, make the chart's famous matchups read sensibly in baseball terms (e.g. whatever replaces Fairy beating Dragon and being immune to it; whatever replaces Ghost being immune to Normal and Fighting; Dark immune to Psychic; Ground immune to Electric; Flying immune to Ground; Steel immune to Poison; Normal and Fighting not affecting Ghost). Give the full 18-name mapping with a one-line baseball justification each.
- Baseball first: a hit is still a hit, an out is an out, scoring and the win condition are pure baseball. Types, levels, IVs and EVs only shift the PROBABILITIES the engine already uses (bounded, in log-odds or log5 terms) and the pitcher Health damage. A 0x immunity must have a baseball-sensible meaning that never makes a hit, walk or strikeout literally impossible.
- Define: how players get 1-2 types (derived from real stat profiles, editable), how pitches (the pitcher's "moves") get a type, what the batter's "move" type is when he swings, where STAB applies, and exactly how the multiplier enters pitch resolution and Health damage. Text-box lines: "It's super effective!", "It's not very effective...", "It doesn't affect <name>...".
- LEVELS 1-100, XP, IVs, EVs modeled on Pokemon (stat formula with base stats, IV 0-31, EV max 252 per stat / 510 total, XP curve, XP scaled by opponent level, Exp Share for bench). Base stats come from the real-stat ratings. Use the 6 hitter ratings (Contact, Power, Eye, Gap, Speed, Fielding) and a sensible 6-stat pitcher set (the brief has Stuff, Control, Movement, Stamina; the parallel design adds Health). EVs should be earned by who you face, in a way that makes baseball sense (facing flamethrowers trains your Contact, etc.).
- Progression like a Pokemon game: opponents get higher level as you advance (gym-leader-like milestones, Elite Four / Champion as the playoffs). Decide whether this replaces Season mode or is a new mode, and say how Exhibition works.
- CALIBRATION MUST HOLD: two teams at equal level with neutral IVs/EVs must reproduce the real 2026 rates and the section 6 table. Prefer a model where the level DIFFERENCE and relative stats drive the matchup so equal-level baseball is real baseball. Type effects must net to ~zero across the league (centering). Add calibration targets and tests (e.g. level gap win rates, type modifier caps).
- Must be implementable in a DOM-free engine.js, saved in localStorage, editable in the player editor (types, level, IVs, EVs), and testable.`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    type_names: { type: 'string', description: 'all 18 Pokemon type -> baseball archetype name, with one-line justification each, and a note on how the famous matchups read' },
    type_assignment: { type: 'string', description: 'how hitters, pitchers, pitches and swings get types; STAB' },
    type_in_engine: { type: 'string', description: 'exact math of how multipliers change pitch resolution and Health damage, caps, centering, what 0x means' },
    stats_levels: { type: 'string', description: 'stat formula, base stats from ratings, how level enters matchups, level range, equal-level calibration' },
    ivs_evs: { type: 'string', description: 'IV and EV rules, EV yields by opponent type/profile, how real players get IVs, training' },
    xp_progression: { type: 'string', description: 'XP formula, curve, exp share, opponent level schedule, milestones, modes' },
    ui_text_editor: { type: 'string', description: 'screens, chart tab, text lines, editor fields, save data' },
    calibration_tests: { type: 'string' },
    risks: { type: 'string' },
  },
  required: ['angle', 'type_names', 'type_assignment', 'type_in_engine', 'stats_levels', 'ivs_evs', 'xp_progression', 'ui_text_editor', 'calibration_tests', 'risks'],
}

const ANGLES = [
  { key: 'baseball-logic', text: 'BASEBALL LOGIC FIRST: every type name, matchup and progression rule should make a baseball fan nod. Types are scouting archetypes; levels are a player developing over a season; EVs are what you learn from who you face.' },
  { key: 'pokemon-faithful', text: 'POKEMON FAITHFUL FIRST: reproduce the Pokemon game loop as closely as possible (type chart, STAB, stat formula, IV/EV numbers, XP formula, gyms/Elite Four/Champion progression, level-up screens) while obeying the baseball constraints.' },
  { key: 'engine-calibration', text: 'ENGINE AND CALIBRATION FIRST: the simplest exact math that drops into a pitch-by-pitch log5 engine, keeps the section 6 targets at equal level, bounds every modifier, is deterministic given a seed, and is easy to test headlessly. Give formulas and starting constants.' },
]

phase('Design')
const designs = (await parallel(ANGLES.map(a => () =>
  agent(`${CONTEXT}\n\nProduce a complete design from this angle: ${a.text}\n\nBe concrete: names, numbers, formulas, constants. Do not write code.`,
    { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA })
))).filter(Boolean)
log(`${designs.length}/3 designs returned`)

const designsText = designs.map((d, i) => `### Design ${i + 1} (${d.angle})\n` + Object.entries(d).filter(([k]) => k !== 'angle').map(([k, v]) => `**${k}**: ${v}`).join('\n')).join('\n\n')

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    per_design: { type: 'array', items: { type: 'object', properties: { design: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } }, best_ideas: { type: 'array', items: { type: 'string' } } }, required: ['design', 'problems', 'best_ideas'] } },
    best_type_names: { type: 'string', description: 'your recommended final 18-name mapping, picking the best name per type across designs' },
    must_haves: { type: 'array', items: { type: 'string' } },
    must_avoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['per_design', 'best_type_names', 'must_haves', 'must_avoid'],
}

const CRITICS = [
  { key: 'baseball-purist', text: 'You are a baseball purist and Pokemon expert. Check that the type chart claims match the real Gen 6+ chart exactly (flag any wrong multiplier or immunity), that names are fun and recognizable baseball archetypes with no duplicates or clumsy ones, that famous matchups read sensibly, and that nothing lets types/levels change what a hit, out, run or win is, or makes an outcome impossible.' },
  { key: 'engine-critic', text: 'You are a simulation and game-economy critic. Hunt for: calibration breakage at equal level, type effects that do not net to zero, modifier stacking (type x STAB x level x read guess x fatigue) that blows past sane bounds, XP/EV grinding exploits, level gaps that make games unwinnable or trivial, save-data bloat, and anything untestable. Propose caps and concrete calibration targets.' },
]

phase('Critique')
const critiques = (await parallel(CRITICS.map(c => () =>
  agent(`${CONTEXT}\n\n${c.text}\n\nCritique these designs:\n\n${designsText}`,
    { label: `critique:${c.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA })
))).filter(Boolean)

const critText = critiques.map((c, i) => `### Critic ${i + 1} (${CRITICS[i].key})\n` + JSON.stringify(c, null, 1)).join('\n\n')

const SYN_SCHEMA = {
  type: 'object',
  properties: {
    new_section_markdown: { type: 'string', description: 'complete new top-level section, heading "## X. Types, levels, IVs and EVs", ready to paste' },
    edits: { type: 'array', items: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' }, why: { type: 'string' } }, required: ['old_str', 'new_str', 'why'] } },
    design_notes: { type: 'string', description: 'short summary of key choices for the user' },
  },
  required: ['new_section_markdown', 'edits', 'design_notes'],
}

phase('Synthesize')
const final = await agent(`${CONTEXT}\n\nWrite the final version for the brief. Merge the best of the designs, obey every must_have and must_avoid from the critics, use the critics' best type names (resolve any disagreement toward clarity and baseball sense).\n\nDESIGNS:\n${designsText}\n\nCRITIQUES:\n${critText}\n\nOutput:\n1. One new top-level section with heading "## X. Types, levels, IVs and EVs" (literally X; the section will be numbered later). Include: a one-line principle (still baseball; these only shift odds and Health damage); a table of all 18 types (Pokemon type | baseball name | who gets it); the full 18x18 effectiveness chart written as a compact table or as per-attacking-type lists of 2x / 0.5x / 0x targets, exactly matching Gen 6+; type assignment rules; engine math with caps; stats/levels; IVs; EVs; XP and progression; modes; editor/save notes. Match the brief's voice: short plain sentences, bullets, small tables, no hype.\n2. Exact old_str/new_str edits elsewhere in the brief for consistency: section 1 build order, section 2 Modes row, section 3 ratings (base stats), section 4 pitch-family "types" wording and the read chart / Chart tab, section 6 new calibration rows, section 7 screens (level-up, chart, progression hub), section 8 editor fields, section 9 tests, section 10 done-means. old_str must be copied exactly from the brief file and be unique. Refer to the new section as "section X".`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYN_SCHEMA })

phase('Verify')
const verdict = await agent(`${CONTEXT}\n\nAdversarially review this proposed addition. Default to flagging problems. Check: (a) the effectiveness chart against the real Pokemon Gen 6+ chart cell by cell for all 18 attacking types (list every wrong or missing 2x/0.5x/0x); (b) every old_str appears exactly once in ${BRIEF}; (c) nothing changes what a hit/out/run/win is or makes an outcome impossible; (d) equal-level neutral-IV/EV play reproduces real rates (do the arithmetic); (e) modifier stacking stays within the stated caps; (f) no contradictions with other lines of the brief; (g) voice matches. Return concrete fixes with exact replacement text, or an empty list.\n\nPROPOSAL:\n${JSON.stringify(final, null, 1)}`,
  { label: 'verify', phase: 'Verify', schema: { type: 'object', properties: { fixes: { type: 'array', items: { type: 'object', properties: { problem: { type: 'string' }, fix: { type: 'string' } }, required: ['problem', 'fix'] } } }, required: ['fixes'] } })

return { final, verdict, designs, critiques }
