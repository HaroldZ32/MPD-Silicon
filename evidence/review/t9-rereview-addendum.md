# t9 re-review addendum — R1–R3 fix verification

- Reviewer: Senior Engineer (same independent reviewer as t9; did not author the fixes)
- Reviewed fix commit: **`37b93cf`** ("docs: correct the coexistence status and the user-facing
  facts (t9 R1-R3)"), on `master`, remote `origin` = `https://gitee.com/nop_chip/my-power-dsh-silicon.git`
- Subject of re-check: my own t9 findings **R1 (high) / R2 (medium) / R3 (low)**, plus a
  side-effect check of **R4**
- Discipline: read-only re-verification. This addendum is the only file written; no repository
  file was edited, no source-repo file was touched. The original review
  (`evidence/review/t9-install-review.md`) is left byte-intact and is not superseded — this file
  records what changed after it.

## Verdict

**pass (R1–R3 resolved; R4 also closed as a side effect).** Each finding was re-checked by
re-measurement, not by reading the diff. Three residuals are recorded below; none of them is a
defect in the reviewed work.

## 1. R1 (high) — coexistence statement — RESOLVED

**Re-check method**: re-ran the *same* configuration my original review used (fresh sandbox
`/tmp/t9-recheck`, three-layer isolation), following the README's own install instructions.

**The README now claims** (`README.md` 42-50, `README.zh-CN.md` 36-46): a real mounting boot with
both bundles registers **two services** (`mpdDsh` + `siliconDsh`) and **two skill providers**
(`mpd-bundle` + `silicon-bundle`), with zero `failed to apply loader entry`, zero
`already registered`, zero `plugin tree failed to load`.

**Measured** (this re-review):

| Signal | README claim | Measured |
| --- | --- | --- |
| service providers | 2 | **2** (`mpdDsh`, `siliconDsh`) |
| skill providers | 2 | **2** (`mpd-bundle`, `silicon-bundle`) |
| `failed to apply loader entry` | 0 | **0** |
| `already registered` | 0 | **0** |
| `plugin tree failed to load` | 0 | **0** |

Names actually observed in the boot log: `mpd-bundle`, `mpdDsh`, `silicon-bundle`, `siliconDsh`.
Every element of the new paragraph is therefore a measured fact, and the previously misleading
"mounting both fails" text is gone. The Status section was likewise rewritten to list the closed
items and to keep the open ones (t15 carrier, t16 assets) — including the caveat I asked for:
"it has never been really activated, so judge it by a real boot, not by row presence".

The replacement text keeps the correct boundary reminders (the duplicate `mpd_verif_*` overlap
returns next to a pre-strip mpd; the row-id gate cannot see service/tool/serverName collisions),
so the fix corrects the error without overclaiming.

## 2. R2 (medium) — stale test count — RESOLVED

README now states: `bun test packages   # 131 tests / 130 pass / 1 declared skip (three plugin packages)`.

Measured: `Ran 131 tests across 12 files` — **130 pass / 0 fail / 1 skip**.

The declaration matches the measurement exactly, and the misleading "(verif plugin suite)"
parenthetical is gone. **RESOLVED.**

## 3. R3 (low) — undocumented uninstall residue — RESOLVED

Both language versions now document the leftover symlink with the command to remove it
(`README.md` 70-73, `README.zh-CN.md` 62-63: `rm <profile>/node_modules/@mpd-dsh/silicon`).
The functional behaviour I measured in the original review (rows 4 → 0, `dsh.profile.bundles`
reset) is unchanged and unchanged-in-documentation, so the text and the behaviour agree now.

## 4. R4 (low) — no bundled smoke script — CLOSED as a side effect

I had recorded R4 as a hard limitation (the verif smoke harness lived in the source repo and was
deleted by the t5 strip). The fix commit carries a new in-repo script,
`packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` (5682 B), and `README` now reaches it from
the gates table (`README.md:94`). I ran it in an isolated cwd:

```
$ PYTHONDONTWRITEBYTECODE=1 bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs
PASS mpd_verif_backends probes the toolchain — iverilog=Icarus Verilog version 14.0 …; verilator=Verilator 5.051 …; vcs=absent
PASS mpd_verif_venv status answers — verdict=missing
PASS mpd_verif_lint via verilator — exit 0, diagnostics=[]
SKIP mpd_verif_sim: no project venv carrying cocotb (verdict=missing); create one with the mpd_verif_venv tool (action=create) …
SKIP mpd_verif_uvm / vcs-coverage lane: no VCS on PATH (command -v vcs is empty) — evidenced skip, not a pass
[smoke] PASS — 3 check(s), 2 skip(s)
exit 0, 0 FAIL
```

It satisfies the requirement I stated in R4: the tool surface is now provable **without a source
checkout**. Both skips print their reason and are explicitly labelled "evidenced skip, not a
pass" — consistent with the repository's stated discipline. The script wrote its state to a
throwaway directory (`/tmp/mpd-verif-smoke-*`); the worktree was not polluted by the run.

## 5. Gates re-run on the reviewed revision

| Gate | Result |
| --- | --- |
| `bun test packages` | 131 tests — **130 pass / 0 fail / 1 declared skip** |
| `node scripts/verify-corpus.mjs` | **PASS** — 10 checks passed, 3 skipped |
| `node scripts/pack-silicon.mjs --check` | **PASS** — every committed file readable by a non-root consumer |
| `node scripts/pack-silicon.mjs --self-test` | **PASSED** — package-set guards falsifiable; mode normalization proven (600 → 644, 755 preserved) |

Language policy: both `README.md` (`[中文](./README.zh-CN.md)`) and `README.zh-CN.md`
(`[English](./README.md)`) carry the switch link and were updated in the same commit — the
bilingual requirement holds.

## 6. Residual notes (not defects)

1. **One commit is not yet on the remote.** `git status -sb` reports
   `## master...origin/master [ahead 1]`; `origin/master` is at `37b93cf`, so the follow-up
   `ddd7c9f` ("docs(readme): point the gates table at the shipped smoke and close t7 F3") exists
   only locally. It is the commit that, among other things, gives the smoke script its README
   entry — so the pushed revision documents the tool *without* its gates-table row. Recommend
   pushing `ddd7c9f`; no code change needed.
2. **The fix commit also files my review report.** `37b93cf` adds
   `evidence/review/t9-install-review.md` (179 lines) alongside the README changes, so the review
   that motivated the fix ships in the same commit as the fix. That is acceptable provenance, but
   a reader should know the verdict in that file is the *pre-fix* verdict; this addendum is the
   post-fix one.
3. **`AGENTS.md` §9 was narrowed, and I verified the narrowed claim.** It now states that what is
   lost is automation of a regression **in the baseline itself**, and that an independent oracle
   remains: `git archive 3d99718 skills/rtl-*` in the source repo reconstructs the 35 files for an
   entry-by-entry (sha256 + byte size) comparison. I did not re-run that reconstruction here
   (out of this re-review's scope, and it reads a different repository); it is a reasonable
   restatement of the loss and is honestly scoped as on-demand rather than automated.

## 7. Scope statement

This addendum re-ran read-only checks and one bundled script (which writes only to a throwaway
directory) and wrote exactly one file. It changed no repository content, softened no gate, and
carried forward no finding as resolved without a measurement: R1, R2, R3 and R4 each have a
command and an observed result above.
