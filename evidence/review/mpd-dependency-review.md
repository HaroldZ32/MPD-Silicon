# Independent review — hard `@mpd-dsh/mpd` dependency (0.4.0)

**Contract**: [`mpd-dependency-contract.md`](./mpd-dependency-contract.md) (R1-R8 on the release
candidate; R9 executed after the verdict, per its addendum).
**Reviewer**: Reviewer role, a different agent from the author; read-only.
**Reviewed state**: the uncommitted 0.4.0 working tree at base `2111339`.
**Evidence**: `evidence/verification/mpd-dependency/20261022T112500Z/`.

## Round 1 — FAIL

R1-R7 passed by black box. R8 passed on substance but the frozen contract carried a stale byte
count. R9 was not executable as planned:

| id | severity | finding |
|---|---|---|
| F1 | high | The functional `silicon-require-mpd` patch row was assigned to the docs commit; atomicity required the whole patch in the code commit. |
| F2 | high | Version bump + CHANGELOG were in a feature/docs commit before `release/v0.4.0`; the release branch carried no bump. |
| F3 | high | `package.json` was claimed by two commits without stating how it was staged. |
| F4 | medium | The guard package's READMEs were split from the rest of the new package. |
| F5 | medium | `LICENSE-NOTICES.md` was assigned to no commit. |
| F6 | medium | `.codegraph/` was untracked with no root ignore rule; a broad add would ship tool state. |
| F7 | medium | No `dev` branch existed and the plan did not map commits to branches. |
| F8 | medium | The contract R3/R8 said 682,451 B / −25.8 %; the delivered bundle and docs said 690,030 B / −24.9 %. |
| F9 | medium | README/zh claimed `ci.yml` runs `--fix`/`--check`; CI runs `--self-test`/`--check` only. |
| F10 | nit | The shipped patch comment said "eight" `mpd_verif_*` tools; the bundle ships ten. |
| F11 | nit | The guard-package size claim (28.9 KB) used no stated metric. |
| F12 | nit | CONTRIBUTING said `ci.yml` runs "every gate"; the boot harness runs in `boot-e2e.yml`. |
| F13 | nit | Planned `!` breaking markers and a scopeless `evidence:` message were outside the stated format. |
| F14 | nit | Evidence-last ordering needed an explicit rationale. |

## Round 2 — FAIL

R1-R8 re-ran green, but two evidence/plan gaps remained:

| id | severity | finding |
|---|---|---|
| F15 | high | The explicit file list omitted the four modified package READMEs (verif/bootstrap, both languages) and the patch file's header-comment hunk. |
| F16 | medium | `output.log` and the pack-gate row still recorded 690,030 as final while the size block said 690,185. |
| F17 | nit | `package.json` was described as hunk-staged; version and description share a hunk. |
| F18 | nit | The comment-only `verify-rows-disjoint.mjs` header sat in the docs commit. |

## Round 3 — PASS

The Reviewer verified the repairs and returned **PASS** (risk Low-Medium):

- F1/F2/F3/F7 — plan: `dev` created at `master`; feature commits 1-2 (code+guard+whole patch+
  LICENSE+deps/description at 0.3.0; CI+CONTRIBUTING+templates+`.gitignore`); `--no-ff` into dev;
  `release/v0.4.0` commits 3-4 (docs + version 0.4.0 + CHANGELOG; evidence after PASS);
  `--no-ff` into master; annotated `v0.4.0`.
- F4/F5/F6 — guard READMEs and LICENSE-NOTICES in commit 1; `.codegraph/` ignored and never staged.
- F8 — contract R3/R8 now 690,185 B / −24.9 %, with the 682,451 (pre-docs) and 690,030
  (pre-final claims) intermediates explained.
- F9/F10/F11/F12/F13/F14 — CI wording, patch "ten", guard metric (≈18 KB files / 1,420 B dist),
  CONTRIBUTING boot scope, scoped commit messages, evidence-last rationale.
- F15/F16/F17/F18 — the plan names the four package READMEs and the whole patch; `output.log` ends
  with an authoritative 690,185 section (dists 157,612 / 11,734 / 1,420; status 11/19/39) and the
  pack-gate row says 690,185; `package.json` is staged whole twice (0.3.0 → 0.4.0); the rows
  header moved to commit 1.
- Final: `du -sb` 690,185; `pack --check` PASS; `sha256sum -c` 9/9; tests 212/21 (211 pass / 1 skip);
  typecheck `--require`; corpus loadability PASS; rows 4∩35=∅; LSP; Gitee 3 PASS / 11-11 self-test;
  ci-boot coexist 124 / no-mpd 1; live 2/2 (toolchain show, librelane status 3.0.16). No `dev`
  branch and no tag existed before this verdict; the execution follows the accepted plan.

## Bounds of this review

- Gitee Go live runners were unavailable: triggers, `${GITEE_TAG}` interpolation and artifact
  publishing are structurally validated only (PyYAML + workflow gate + 11/11 self-test).
- No HDL language-server live call under 0.4.0; the older adaptation measurement stands.
- No real EDA/FUSE/AppImage/Verible; no full RTL-to-GDS flow.
- `dsh plugin add` is unverified in the read-only-`$HOME` sandbox; the profile `package.json` +
  `bun install` path is the proven one.
- No model call was run; the recorded `live-tools.jsonl` was inspected.
- The Reviewer did not read every source line; the review is the black-box gate procedure + docs +
  evidence + the diffs needed for R9. No credentials were encountered.
