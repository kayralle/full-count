import sys
p = "/root/.claude/uploads/25041982-ed1b-52c3-a1a9-d5a354d2bd12/160bcced-full-count-build-brief.md"
t = open(p, encoding="utf-8").read()
olds = [
 "role (SP/RP/CL from games started and saves), batters faced, K%, BB%, HR per batter faced, GB%, BABIP allowed, average pitches per appearance,",
 "Stamina (pitches per appearance)",
 "**VISIT** (mound visit: steadies control for a few pitches, 2 per game)",
 "- **BENCH:** pinch hitter, pinch runner",
 "from the pitcher's Control, the location, fatigue and the count.",
 "- HP bars: the **pitcher's bar is stamina**, draining by pitch count. The **batter's bar is the count**: three strikes empties it. Show balls and strikes as dots too.",
 "- **Fatigue:** each pitcher has a pitch budget from his real pitches per appearance. Past it, velocity, control and stuff fall off. Starters go about 70–90 pitches in a 6-inning game.",
 "The AI manager pulls tired pitchers, plays lefty-righty matchups, and uses the closer in save spots.",
 "- A sharp human-like player (who guesses with real pitch usage) wins about 60–65% on the middle difficulty against an average team.",
 "6. **Season hub** (Season mode): schedule, standings vs. your opponents, next game, roster.",
 "- Pitcher ratings: Control, Movement, Stamina, plus the four pitches.",
 "- Reload mid-at-bat: the count, runners and score are restored.",
 "- Screenshots of: title, lineup card, the at-bat screen while pitching, the at-bat screen while batting, pitch menu, swing menu, editor, postgame.",
 "- The calibration table in section 6 passes, and Claude Code shows you the numbers.",
 "- **Box score sheet:** batting lines (AB, R, H, RBI, BB, K, HR), pitching lines (IP, H, R, ER, BB, K, pitches), and a play-by-play log.",
 "pitches per appearance",
 "fatigue",
 "Stamina",
 "stamina",
 "70–90",
 "VISIT",
 "2 per game",
]
for o in olds:
    print(t.count(o), repr(o[:70]))
# overlap check: does any old_str occur inside another's region
import itertools
spans=[]
for o in olds[:15]:
    i=t.find(o); spans.append((i,i+len(o),o[:40]))
spans.sort()
for a,b in zip(spans,spans[1:]):
    if a[1]>b[0]: print("OVERLAP",a,b)
