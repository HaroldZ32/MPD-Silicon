# Release contract — 0.5.0

**Candidate**: `release/v0.5.0` = the code from `dev` (`c84270c`) + the release docs commit
(`71fcc11`, version/CHANGELOG/size). **Verdict owner**: an independent Reviewer, not the author.
**Tag**: cut on `master` only after a PASS (R8).

## R1 — Version and changelog

- `package.json` version is `0.5.0`.
- `CHANGELOG.md` has `## 0.5.0 — 2026-10-22` with the full `/opt` content; the
  `## 0.4.0` section is kept historical and untouched.
- Current-version references read `0.5.0`; genuine historical `0.4.0` mentions (the 0.4.0
  release, the 0.4.0 devshell `--run` bug, the 0.4.0 dependency profile, the CHANGELOG 0.4.0
  block) stay `0.4.0`.

## R2 — Release-candidate gates

Run on the candidate:

- `bun test packages/` → 220 tests / 21 files (219 pass, 1 declared skip, 0 fail).
- `node scripts/typecheck.mjs --require` → PASS.
- `node scripts/verify-corpus.mjs` → PASS (10 checks / 3 skipped).
- `node scripts/verify-rows-disjoint.mjs` → silicon 4 ∩ mpd 35 = ∅.
- `node scripts/build-lsp.mjs --check` → PASS (BUILD.lock / registry / assets).
- `node scripts/pack-silicon.mjs --check` → PASS.
- `node scripts/verify-gitee-workflows.mjs` → 3 workflows PASS.
- `node scripts/ci-boot.mjs --require` → coexist + no-mpd PASS.

## R3 — Real `/opt/openictool` evidence

`evidence/verification/openictool/20261022T145500Z/` must show:

- LSP: 44 configured / **2 installed** (verible `.v/.vh`, slang-server `.sv/.svh`), clean
  `No diagnostics found`, broken `error[verible]` 3:2/4:0 and `error` 2:22/3:12.
- sim PASS (1 case) on iverilog and verilator; regress 1/1 PASS on both.
- coverage merge (4 files → `merged.dat`) and report annotated (`--annotate-all`).
- UVM the expected `VERIF_E_NO_BACKEND` (no VCS); LibreLane 3.0.16 devshell status/run.
- The config carries `ossCadSuite.home`, `verible.bin`, `slangServer.bin`, `librelane.appimage`.

## R4 — Docs and sizes

- The release docs (`CHANGELOG.md`, `README.md`, `README.zh-CN.md`,
  `docs/dependency-map.md`, `docs/dependency-map.zh-CN.md`) carry the release packed size
  **700,120 B** and the dist total **173,363 B**; no `700,158` in those release surfaces.
- The frozen test record `result.json` keeps `700,158` as the pre-release test measurement —
  that is evidence of the test, not the release table.
- The bilingual twins exist with the language switch under the title; no current-version
  `0.4.0` outside the historical allowlist.

## R5 — Git model

- `release/v0.5.0` from `dev`; `master` receives a `--no-ff` merge; the annotated `v0.5.0`
  tag lands on `master`; `dev` is kept; no history rewrite.
- The tag is cut only after R1-R8 PASS.

## R6 — Artifact and dependency

- The packed bundle is **700,120 B**, 50 files, with the 4 silicon rows, no adapter package,
  `@mpd-dsh/mpd` pinned exactly `0.15.1`, the dists externalized.
- The verif dist is 160,209 B; bootstrap 11,734 B; guard 1,420 B; total 173,363 B.

## R7 — Evidence record

- `evidence/verification/openictool/20261022T145500Z/{result.json,output.log,gates.log,sim4.jsonl,lsp-*}`.
- The review record is `evidence/review/openictool-review.md`, committed with this contract
  after the verdict.

## R8 — Tag after PASS

No branch merge to `master` and no `v0.5.0` tag before the Reviewer's PASS. A FAIL names
findings with evidence and bounces back; the release is re-reviewed after repair.

## Bounds

- No VCS/UVM beyond the expected refusal; no PDK/full RTL-to-GDS.
- The `/opt` test used a QA project config, not the user-level `~/.dsh/silicon.jsonc`.
- The 0.4.0 tag keeps the pre-fix devshell; 0.5.0 is the fix/feature release.
