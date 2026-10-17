export const meta = {
  name: 'full-count-faint-mechanic',
  description: 'Design a baseball-consistent pitcher fainting mechanic (health + fatigue bars) for the Full Count brief',
  phases: [
    { title: 'Design', detail: '3 independent designs from different angles' },
    { title: 'Critique', detail: 'baseball-rules purist + engine/calibration critic' },
    { title: 'Synthesize', detail: 'merge into brief-ready markdown edits' },
    { title: 'Verify', detail: 'adversarial check of the final edits' },
  ],
}

const BRIEF = '/root/.claude/uploads/25041982-ed1b-52c3-a1a9-d5a354d2bd12/160bcced-full-count-build-brief.md'

const USER_ASK = `The user's request, verbatim: "Also add a gameplay mechanic note that it still works like a baseball game but pitchers can faint if their health bar or fatigue bar is destroyed. But a hit is essentially still a hit in terms of the games objective staying true to baseball while having some features of pokemon battles but it's gotta makes sense as a baseball game with logic"`

const CONTEXT = `Read the full build brief at ${BRIEF} first. It specs "Full Count", a Pokemon-style browser baseball game where each plate appearance is a pitcher-vs-batter battle, built from real 2026 MLB stats, 6-inning games, calibrated against league averages (section 6). Currently section 4 says the pitcher's HP bar is stamina (drains by pitch count) and the batter's bar is the count. Section 5 covers fatigue/bullpen/AI manager. ${USER_ASK}

Hard constraints for any design:
- Baseball outcomes are untouched: a hit is a hit, an out is an out, runs/outs/innings/win condition are pure baseball. Bars never change the result of a play that already happened; they are a side layer that affects pitcher performance and when he must leave.
- Pitchers get TWO bars: Health and Fatigue. Either one hitting zero = the pitcher "faints" (Pokemon flavor) = he is forced out of the game.
- Everything must have a baseball reason that a fan would accept (e.g. fainting maps to being knocked out of the game / chased / out of gas). Respect real MLB rules where they apply: removed pitchers cannot re-enter, relievers inherit the count, inherited runners stay charged to the previous pitcher, the 3-batter minimum has an injury/illness exemption, a position player can pitch if the bullpen is empty.
- Must not break the section 6 calibration targets; add any new targets needed (e.g. how often starters get knocked out early, average starter innings).
- Batters do not faint; their bar stays the count.
- Must be implementable in a DOM-free engine.js and testable headlessly and with Playwright.`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    health_bar: { type: 'string', description: 'what it represents in baseball terms, size/formula, what drains it with numbers, what restores it' },
    fatigue_bar: { type: 'string', description: 'formula, drain, how it relates to the existing pitch budget and section 5 fatigue' },
    performance_effects: { type: 'string', description: 'how low health / low fatigue change pitch resolution, with thresholds' },
    faint_rules: { type: 'string', description: 'exact timing (when checked), what happens mid at-bat, inherited count/runners, scoring, re-entry, empty bullpen, 3-batter rule' },
    ai_and_player: { type: 'string', description: 'AI manager behaviour, what the human sees/can do (visit, bullpen), difficulty differences' },
    ui_and_text: { type: 'string', description: 'bars on screen, colors, text box lines, effects, box score notation' },
    editor_and_data: { type: 'string', description: 'which ratings/stats drive the bars, any new rating, editor fields' },
    calibration_and_tests: { type: 'string', description: 'new calibration targets and tests' },
    risks: { type: 'string' },
  },
  required: ['angle', 'health_bar', 'fatigue_bar', 'performance_effects', 'faint_rules', 'ai_and_player', 'ui_and_text', 'editor_and_data', 'calibration_and_tests', 'risks'],
}

const ANGLES = [
  { key: 'baseball-realism', text: 'BASEBALL REALISM FIRST: every rule should map to something that happens in a real MLB game (getting shelled and chased, running out of gas, mound visits calming a pitcher, inherited runners). Pokemon flavor is a coat of paint over real baseball.' },
  { key: 'pokemon-feel', text: 'POKEMON FEEL FIRST: make the two bars read and feel like a Pokemon battle (HP colors, damage numbers per event, "It\'s super effective!", faint animation, switch-in), while still respecting the hard constraints. Find the most satisfying moment-to-moment loop.' },
  { key: 'engine-calibration', text: 'ENGINE AND CALIBRATION FIRST: design the simplest numeric model that drops into the brief\'s pitch-by-pitch engine and log5 rates, keeps section 6 targets intact, is deterministic given a seed, and is easy to test. Give concrete formulas and starting constants.' },
]

phase('Design')
const designs = (await parallel(ANGLES.map(a => () =>
  agent(`${CONTEXT}\n\nDesign the pitcher Health + Fatigue + fainting mechanic from this angle: ${a.text}\n\nBe concrete: numbers, formulas, thresholds, exact rules. Do not write code.`,
    { label: `design:${a.key}`, phase: 'Design', schema: DESIGN_SCHEMA })
))).filter(Boolean)
log(`${designs.length}/3 designs returned`)

const designsText = designs.map((d, i) => `### Design ${i + 1} (${d.angle})\n` + Object.entries(d).filter(([k]) => k !== 'angle').map(([k, v]) => `**${k}**: ${v}`).join('\n')).join('\n\n')

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    per_design: { type: 'array', items: { type: 'object', properties: { design: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } }, best_ideas: { type: 'array', items: { type: 'string' } } }, required: ['design', 'problems', 'best_ideas'] } },
    must_haves: { type: 'array', items: { type: 'string' }, description: 'rules the final version must contain' },
    must_avoid: { type: 'array', items: { type: 'string' } },
  },
  required: ['per_design', 'must_haves', 'must_avoid'],
}

const CRITICS = [
  { key: 'rules-purist', text: 'You are a strict baseball rules purist and official scorer. Hunt for anything that contradicts MLB rules or scoring (Rule 5.10 substitutions, 9.16 earned runs and relief-pitcher walk charging, inherited runners, re-entry, 3-batter minimum and its injury/illness exemption, extra-innings runner), anything that lets the bars alter a play outcome, and anything a baseball fan would find illogical. Also check the batter side stays pure baseball.' },
  { key: 'engine-critic', text: 'You are a game-engine and simulation critic. Hunt for designs that would wreck the section 6 calibration (runs, K%, pitches per PA, starter length), double-count fatigue with the existing pitch-budget falloff, create degenerate strategies for a human (e.g. farming health back, exploiting faint timing, never pulling pitchers), cause save/resume ambiguity, or are untestable. Propose concrete calibration targets for faint frequency and starter length.' },
]

phase('Critique')
const critiques = (await parallel(CRITICS.map(c => () =>
  agent(`${CONTEXT}\n\n${c.text}\n\nCritique these three candidate designs:\n\n${designsText}`,
    { label: `critique:${c.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA })
))).filter(Boolean)

const critText = critiques.map((c, i) => `### Critic ${i + 1} (${CRITICS[i].key})\n` + JSON.stringify(c, null, 1)).join('\n\n')

const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    new_section_markdown: { type: 'string', description: 'the complete new subsection, ready to paste' },
    insert_after_exact_line: { type: 'string', description: 'an exact existing line of the brief after which the new subsection goes' },
    edits: { type: 'array', items: { type: 'object', properties: { old_str: { type: 'string', description: 'exact text copied from the brief, unique' }, new_str: { type: 'string' }, why: { type: 'string' } }, required: ['old_str', 'new_str', 'why'] } },
    design_notes: { type: 'string', description: 'short summary of key choices for the user' },
  },
  required: ['new_section_markdown', 'insert_after_exact_line', 'edits', 'design_notes'],
}

phase('Synthesize')
const final = await agent(`${CONTEXT}\n\nYou are writing the final version into the brief. Merge the best of the three designs, obeying every must_have and must_avoid from the critics, resolving disagreements toward baseball logic first, then simplicity.\n\nDESIGNS:\n${designsText}\n\nCRITIQUES:\n${critText}\n\nOutput:\n1. A new subsection titled "### Pitcher health, fatigue and fainting" placed inside an existing section (do NOT renumber sections; other parts of the brief reference sections by number). Open it with a short plain statement of the core principle: it is still baseball, a hit is a hit, the bars only decide how well a pitcher throws and when he has to leave. Then the two bars (what each means in baseball terms, size, what drains/restores with starting numbers), effects on pitching, faint rules (timing, mid at-bat handling, inherited count and runners, scoring, no re-entry, 3-batter exemption, empty bullpen), AI and player controls, UI/text lines. Match the brief's voice exactly: short plain sentences, bullets and small tables, no hype, no em-dash-heavy prose. Keep it tight (roughly 40-80 lines).\n2. Exact old_str/new_str edits to the rest of the brief so it stays consistent: the section 4 HP-bars line, section 5 fatigue/bullpen lines if needed, section 6 new calibration rows, section 7/8 editor or screen mentions if a rating is added, section 9 tests (faint forces change, reliever inherits count, fainted pitcher cannot return, faint never changes a play result, reload restores both bars), section 10 if needed. old_str must be copied exactly from the file and be unique.`,
  { label: 'synthesize', phase: 'Synthesize', schema: EDIT_SCHEMA })

phase('Verify')
const verdict = await agent(`${CONTEXT}\n\nAdversarially review this proposed addition to the brief. Default to flagging problems. Check: (a) every old_str appears exactly once in ${BRIEF}; (b) nothing lets the bars change a play outcome or the win condition; (c) MLB substitution/scoring rules are right; (d) numbers are internally consistent (bar sizes vs drain rates vs the 70-90 pitch starter target and the new calibration targets — do the arithmetic for a typical start); (e) no contradiction with any other line of the brief; (f) voice matches the brief. Return a list of concrete fixes (exact replacement text) or an empty list.\n\nPROPOSAL:\n${JSON.stringify(final, null, 1)}`,
  { label: 'verify', phase: 'Verify', schema: { type: 'object', properties: { fixes: { type: 'array', items: { type: 'object', properties: { problem: { type: 'string' }, fix: { type: 'string' } }, required: ['problem', 'fix'] } } }, required: ['fixes'] } })

return { final, verdict, designs, critiques }
