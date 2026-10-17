# Canonical Pokemon Gen 6+ type chart (attacking -> defending). Used to check the brief.
T = ["Normal","Fire","Water","Electric","Grass","Ice","Fighting","Poison","Ground",
     "Flying","Psychic","Bug","Rock","Ghost","Dragon","Dark","Steel","Fairy"]
SE = {"Normal":[], "Fire":["Grass","Ice","Bug","Steel"], "Water":["Fire","Ground","Rock"],
 "Electric":["Water","Flying"], "Grass":["Water","Ground","Rock"],
 "Ice":["Grass","Ground","Flying","Dragon"], "Fighting":["Normal","Ice","Rock","Dark","Steel"],
 "Poison":["Grass","Fairy"], "Ground":["Fire","Electric","Poison","Rock","Steel"],
 "Flying":["Grass","Fighting","Bug"], "Psychic":["Fighting","Poison"],
 "Bug":["Grass","Psychic","Dark"], "Rock":["Fire","Ice","Flying","Bug"],
 "Ghost":["Psychic","Ghost"], "Dragon":["Dragon"], "Dark":["Psychic","Ghost"],
 "Steel":["Ice","Rock","Fairy"], "Fairy":["Fighting","Dragon","Dark"]}
NVE = {"Normal":["Rock","Steel"], "Fire":["Fire","Water","Rock","Dragon"],
 "Water":["Water","Grass","Dragon"], "Electric":["Electric","Grass","Dragon"],
 "Grass":["Fire","Grass","Poison","Flying","Bug","Dragon","Steel"],
 "Ice":["Fire","Water","Ice","Steel"], "Fighting":["Poison","Flying","Psychic","Bug","Fairy"],
 "Poison":["Poison","Ground","Rock","Ghost"], "Ground":["Grass","Bug"],
 "Flying":["Electric","Rock","Steel"], "Psychic":["Psychic","Steel"],
 "Bug":["Fire","Fighting","Poison","Flying","Ghost","Steel","Fairy"],
 "Rock":["Fighting","Ground","Steel"], "Ghost":["Dark"], "Dragon":["Steel"],
 "Dark":["Fighting","Dark","Fairy"], "Steel":["Fire","Water","Electric","Steel"],
 "Fairy":["Fire","Poison","Steel"]}
IMM = {"Normal":["Ghost"],"Electric":["Ground"],"Fighting":["Ghost"],"Poison":["Steel"],
 "Ground":["Flying"],"Psychic":["Dark"],"Ghost":["Normal"],"Dragon":["Fairy"]}
def mult(a, d):
    if d in IMM.get(a, []): return 0.0
    if d in SE[a]: return 2.0
    if d in NVE[a]: return 0.5
    return 1.0
assert sum(len(v) for v in SE.values()) == 51
assert sum(len(v) for v in NVE.values()) == 61
assert sum(len(v) for v in IMM.values()) == 8
if __name__ == "__main__":
    print("chart ok: 51 x2, 61 x0.5, 8 x0")
