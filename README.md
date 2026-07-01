# JA2 1.13 — NCTH Tuning Lab

An interactive, dependency‑free web tool for understanding and tuning **HEADROCK's New Chance‑To‑Hit (NCTH)** shooting system in the *Jagged Alliance 2 v1.13* mod — built by reading the mod's actual source (`Weapons.cpp`, `LOS.cpp`, `CTHConstants.ini`) and reproducing its math exactly.

### 🔗 Live site
- **Tuning Lab:** https://tais.github.io/ncth-tuning-lab/
- **Full analysis & tuning report:** https://tais.github.io/ncth-tuning-lab/report.html

## What it does
NCTH doesn't roll a die against the cursor's `%`. It turns that percentage into `muzzleSway = 100 − CTH`, builds a **cone of fire** whose radius grows with range, and draws the bullet uniformly inside it — so the real chance of hitting a man‑sized target falls off roughly as *1 / range²* while the cursor % barely moves. That gap is why low‑level mercs "can't hit anything".

The Lab reproduces the exact code path (including the `sqrt(uniform)` muzzle draw from `CalcMuzzleSway`) and lets you:
- set a shooter (experience, marksmanship, dexterity, wisdom), stance, sight and difficulty;
- edit every relevant `CTHConstants.ini` value with sliders — they drive a **purple "Proposed"** overlay you can compare against the **"Current"** curves;
- watch the **real hit‑chance vs range** curve, the displayed‑CTH vs real‑hit divergence, and a live picture of the aperture disk vs the target with 250 sample shots.

## The short version of the findings
- Your game folder may be running the **old** system — check `Ja2_Options.INI → NCTH = TRUE`. `CTHConstants.ini` only matters under NCTH.
- Base CTH is **experience‑dominated** (`exp×10`, weighted ×3), so unaimed shots are weak regardless of marksmanship; aimed shots then decay with range because of the widening cone.
- Highest‑leverage, low‑risk fixes: raise `IRON_SIGHT_PERFORMANCE_BONUS`, lower `DEGREES_MAXIMUM_APERTURE` a little, lower `IRON_SIGHTS_MAX_APERTURE_MODIFIER` toward 2.0, rebalance `BASE_EXP`↓ / `BASE_MARKS`↑, lower `MAX_BULLET_DEV`. **Do not** lower `NORMAL_SHOOTING_DISTANCE` (it cancels out of the iron‑sight cone and worsens bullet scatter).
- See [`report.md`](report.md) for the full source‑grounded analysis, formulas, parameter table and ready‑to‑try recipes.

## Pages
The lab is split into focused tabs (shared top nav; your merc + tuning persist across tabs via `localStorage`):

| Page | Purpose |
|---|---|
| `index.html` | **Accuracy** — one aimed shot: displayed CTH, muzzle-sway cone, real hit vs range |
| `optics.html` | **Optics** — scope effectiveness (skill-gated) and laser bonuses |
| `conditions.html` | **Conditions** — injury / fatigue / morale / suppression-shock / drink / gas |
| `autofire.html` | **Recoil & Autofire** — per-bullet muzzle-walk across a burst |
| `reference.html` | **All parameters** — searchable table of all 113 `CTHConstants` keys + `Ja2_Options` |
| `report.html` / `report.md` | Full written analysis & tuning guide |
| `assets/` | `style.css`, `ncth.js` (shared model, faithful to source), `params.js` (reference data) |

Everything is static — no build step, no dependencies. Open `index.html` in any browser.

---
*Model reproduced from the mod source and validated by simulation. It faithfully models the dominant muzzle‑sway mechanic; the secondary gun bullet‑deviation and burst recoil layers are described in the report but not added to the Monte‑Carlo (including them only makes long‑range/full‑auto slightly worse).*
