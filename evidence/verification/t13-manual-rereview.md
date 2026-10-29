# t13 re-review — verification of the revised manual's commands

- Reviewer: Senior Engineer (same reviewer as t13; did not author the manual revisions)
- Reviewed revision: **`07b92ce`** ("docs+gate: close t12's ten findings and t13's two, add the type
  gate"), `master`, worktree clean at review time
- Scope: (1) re-run every command the revised `AGENTS.md` §4 declares (10 rows, including the
  parenthesised `--self-test` variants); (2) check that the three behaviours I measured in
  `t13-manual-commands.md` are stated as I measured them; (3) align every number the docs declare
  with a measurement; (4) any command that cannot run or whose claim does not hold becomes a finding
- Independence: every number below is my own run in a throwaway env (`/tmp/t13r-qa`). No result is
  copied from the captain or from my earlier report. Real `~/.dsh` untouched; the provider key was
  read from `~/.bashrc` at runtime only.
- Discipline: this is the only file written by this task.

## Verdict

**pass** — all ten gate rows exist, run, and yield the conclusion the manual attributes to them;
every declared number I could measure matches; the three behaviour statements match my measurements
verbatim in substance; one statement is **imprecise** (§5 F1) and one observation is worth an
explicit sentence (§6). No gate is unrunnable and none is misstated.

## 1. Gate table, row by row (own exit codes and key output)

| # | Row | Command(s) run | exit | Key output | Verdict |
|---|---|---|---|---|---|
| 1 | Types | `node scripts/typecheck.mjs` ; `--require` | 0 ; 0 | `[typecheck] PASS — no diagnostics (local tsgo)` (both invocations) | **pass** |
| 2 | Tests | `bun test packages/` | 0 | `Ran 131 tests across 12 files` — **130 pass / 1 skip / 0 fail** | **pass** (matches README's count exactly) |
| 3 | Corpus | `verify-corpus.mjs` ; `--self-test` | 0 ; 0 | `PASS — 10 check(s) passed, 3 skipped` ; `self-test: PASS (8 negative controls caught, 2 healthy controls clean)` | **pass** |
| 4 | Row ids | `verify-rows-disjoint.mjs` ; `--self-test` | 0 ; 0 | `PASS: silicon ∩ mpd = ∅` (silicon 4 ids / id-target 0; mpd 22 ids / id-target 1) ; `self-test PASSED (6 parser fixtures + 2 gate fixtures)` | **pass** |
| 5 | LSP assets | `build-lsp.mjs --check` ; `--self-test` | 0 ; 0 | `check PASS: dist/cli.js sha256 04b49f8c… (235271 bytes) matches BUILD.lock, both HDL registry entries present, overlay anchor present, 2 reference docs and 4 fixtures in place` ; `self-test ok: registry controls (complete text passes, a missing server is caught) + live --check` | **pass** |
| 6 | Modes | `pack-silicon.mjs --fix` then `--check` | 0 ; 0 | `fix: 160 files …` then `check PASS: every committed file is readable by a non-root consumer` | **pass** |
| 7 | Packer guards | `pack-silicon.mjs --self-test` | 0 | 16 `self-test PASS` lines incl. 10 `control group:` entries; `self-test PASSED: package-set guards are falsifiable and mode normalization is proven (600 -> 644, 755 preserved)` | **pass** |
| 8 | Pack | `pack-silicon.mjs` | 0 | `package set guard PASS: exactly 3 listed package(s), no extras`; `modes normalized: 53 files`; `staged package -> dist/silicon-package` | **pass** |
| 9 | Boot check (MOUNT) | the manual's minimal recipe, verbatim: `DSH_HOME=$(mktemp -d) dsh plugin --profile qa add <repo>` then `dsh --profile qa --no-open --port 0` | add 0 ; boot ran (killed by my 25 s timeout) | `[mpd-dsh-adapter] siliconDsh provided …` + `[mpd-silicon-bootstrap] skill corpus served from …/skills (provider silicon-bundle, bundle 0.1.0)`; **0** fatal signatures | **pass** — the recipe is executable as printed |
| 10 | QA real cases | `MPD_SILICON_ROOT=<silicon> node skills/dsh-qa/scripts/rtl-ip-profile.mjs --self-test` ; same for `rtl-verif.mjs` | 0 ; 0 | `rtl-ip-profile: ok: silicon preset (7 members + taskPlanning + STAGE 0/IP01/STAGE 4) + 4 additive rows / id-target-free patch + skill + 8 templates + bilingual guide` ; `rtl-verif: ok: golden fixture + silicon patch (4 additive rows, no id-target, no absolute path) + eight-tool dist surface + iron-rule strings + three corpus trees + preset profile` | **pass** |

Both probes genuinely consume the variable (`rtl-verif.mjs:32`, `rtl-ip-profile.mjs:23`:
`process.env.MPD_SILICON_ROOT || join(dirname(repoRoot), "my-power-dsh-silicon")`), and each prints
its own instructive skip when the bundle is absent — so the manual's usage text is accurate.

**Row 1's documented skip semantics, measured independently** (clone with `node_modules` removed):
```
$ node scripts/typecheck.mjs            → exit 0
  [typecheck] SKIP — missing type roots: bun-types, @types/node.
  [typecheck] This is an environment gap, not a defect: run `bun install` (devDependencies carry bun-types + @types/node).
  [typecheck] Pass --require to turn this skip into a failure.
$ node scripts/typecheck.mjs --require  → exit 1
  [typecheck] FAIL (--require): missing type roots: bun-types, @types/node
```
"Skips loudly, prints its enabling command, `--require` forbids the skip" is reproduced exactly.

## 2. The three re-measured behaviours, as stated in the revised docs

1. **Cross-package entry-resolution failure is silent** — §9 final bullet (`AGENTS.md:255-258`) now
   says exactly this and prescribes the right remedy ("Verify a new or changed row's tools by
   **calling one**, not by reading the composition"), citing my report. **Matches my measurement.**
2. **`--dump-config` proves composition only** — §4 cites the measured pair (dump `exit 0` with zero
   fatal keywords vs real boot `exit 1` with `plugin tree failed to load … Cannot find module`).
   **Matches.**
3. **Script modes** — README now lists the five directly-runnable scripts (`build.mjs`,
   `pack-silicon.mjs`, `typecheck.mjs`, `verify-corpus.mjs`, `verify-rows-disjoint.mjs`) and states
   `build-lsp.mjs` "is invoked via `node` and stays 644". Measured: exactly **5** scripts carry the
   executable bit, `build-lsp.mjs` is **644**. **Matches.**
4. **`--help`** — the section is rewritten from assertion to measurement: "it exited 1 on a provably
   broken profile and hung past 40 s on a valid one — it neither confirms nor denies a mount", with
   the conclusion preserved. **Matches my measurement** (I recorded the same two outcomes and
   deliberately did not claim falsification).

## 3. Declared numbers vs measurements

| Declared | Where | Measured |
| --- | --- | --- |
| `131 tests / 130 pass / 1 declared skip` | README:79 | 131 / 130 / 1 — exact |
| eight `mpd_verif_*` tools | AGENTS:32 | 8 (venv, backends, compile, lint, sim, coverage, uvm, regress) |
| exactly three RTL skill trees | AGENTS:32, 70, 85 | 3 (`rtl-codestyle`, `rtl-ip-flow`, `rtl-verif`) |
| five directly-runnable scripts; `build-lsp.mjs` 644 | README:96-98 | 5 with `x`; `build-lsp.mjs` = 644 |
| `packages/mpd-mcp-lsp/{dist/cli.js, BUILD.lock, references/, templates/}` | AGENTS:69 | all present; `--check` verifies the sha256 against `BUILD.lock` |
| "four [guards] carry negative controls today (packer, corpus, rows, LSP)" | AGENTS:108 | packer 10 `control group:` lines; corpus 8 negative + 2 healthy controls; rows 6 parser + 2 gate fixtures; LSP registry controls — **four guards, each with negative controls** |
| commit types `feat\|fix\|docs\|test\|evidence\|chore\|refactor` | AGENTS:5 | repository history uses a subset (`docs`, `evidence`, …) — the listed vocabulary covers it |

## 4. Findings

**F1 (low) — the §4 symptom table can be read as a live hazard, but two of its three classes are
structurally unreachable between these two bundles.** `AGENTS.md:134-136` lists
`service "mpdDsh" has been registered`, `tool "mpd_verif_venv" is already registered`, and
`serverName "lsp" is already in use` as the classes that "bite when two bundles mount together".
The row-id-gate warning around it stays correct, but measured today: the service class is closed by
the `siliconDsh` split, the tool class by mpd's strip of its `mpd-verif` row, and the serverName
class by `silicon_lsp`. I re-tested the sharpest case directly — disabling the whole
`silicon-dsh-adapter` row while both bundles are installed: **boot exit 124 (healthy run), only
`mpdDsh` registered, 0 fatal signatures** — i.e. even that no longer collides.
*Required fix*: add one sentence to that section — "all three classes are closed between the
current two bundles (measured); the table is the taxonomy to check when a **third** plugin or an
older mpd is added, and the row-id gate still cannot see any of them." This keeps the warning
useful without implying the repository is currently in a colliding state.

**F2 (info, no doc change strictly required) — one number I reported last round was in the wrong
unit.** My t13 report wrote "6 gate fixtures + 2 parser fixtures are mentioned while …" for the rows
guard; the tested artifact is the reverse (**6 parser + 2 gate**). I verified the revised manual
does not repeat my error — it only says "four carry negative controls", which is accurate. Noting
it here so the ledger does not inherit my mistake.

## 5. Corrections carried into this re-review

- My earlier statement that "disabling `silicon-dsh-adapter` no longer collides" is **re-confirmed**
  here by direct boot, not inferred.
- `typecheck` now runs `local tsgo` when `node_modules` is present and skips loudly otherwise; both
  branches measured (§1).
- The corpus guard's negative-control count is **8** (not the 7 of the original harness), and the
  packer's is **10** sub-checks/4 headline groups — the manual's qualitative claim holds either way.

## 6. Scope statement

Read-only re-verification: ten gate rows, two QA probes (which boot real apps in their own temp
homes), and three behaviour re-tests — all run with throwaway state under `/tmp/t13r-qa`. The only
file written is this report (mode-normalized to 644 by the packager's own `--fix`, which I ran as
the manual's own Modes row prescribes). No repository content, gate, or guard was modified; the
real `~/.dsh` was not touched; no credential was written anywhere.
