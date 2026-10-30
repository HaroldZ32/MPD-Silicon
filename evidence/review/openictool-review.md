# Independent review — release 0.5.0

**Contract**: [`openictool-contract.md`](./openictool-contract.md) (R1-R8).
**Candidate**: `release/v0.5.0` at `71fcc11` = `dev` (`c84270c`) + one release-docs commit.
**Reviewer**: independent, read-only; not the author.
**Verdict**: **PASS, low risk**. No Blocker/High/Medium findings; five non-blocking nits.
**Tag**: `v0.5.0` on `master` after this PASS (the merge/tag were post-PASS).

## R1 — Version and changelog: PASS

`package.json` is `0.5.0`; `CHANGELOG.md` has `## 0.5.0 — 2026-10-22` with the full
`/opt/openictool` content; the `## 0.4.0` section is untouched. Current-version references read
`0.5.0`; the remaining `0.4.0` mentions are historical (standalone-install removal, the 0.4.0
dependency profile, the released-0.4.0 devshell bug) or the unrelated `pino`/`@pinojs/redact`
lockfile versions.

## R2 — Release-candidate gates: PASS

| Gate | Result |
|---|---|
| `bun test packages/` | 220 tests / 21 files, 219 pass / 1 skip / 0 fail |
| `node scripts/typecheck.mjs --require` | PASS |
| `node scripts/verify-corpus.mjs` | PASS, 10 checks / 3 skipped |
| `node scripts/verify-rows-disjoint.mjs` | silicon 4 ∩ mpd 35 = ∅ |
| `node scripts/build-lsp.mjs --check` | PASS (BUILD.lock, 235,271 B) |
| `node scripts/pack-silicon.mjs --check` | PASS on a clean `git archive HEAD` export |
| `node scripts/verify-gitee-workflows.mjs` | 3 workflows PASS |
| `node scripts/ci-boot.mjs --require` | coexist 124 + serve line; no-mpd 1 + guard line |

## R3 — Real `/opt/openictool` evidence: PASS

`evidence/verification/openictool/20261022T145500Z/` shows LSP 44 configured / **2 installed**
(verible `.v/.vh`, slang-server `.sv/.svh`), clean `No diagnostics found` for both, broken
`error[verible]` 3:2/4:0 and `error` 2:22/3:12 + `warning (unused-port)`; sim PASS (1 case) on
iverilog and verilator; regress 1/1 PASS on both; coverage merged 4 files into `merged.dat`
(4,260 B) and an annotated report; UVM the expected `VERIF_E_NO_BACKEND`; LibreLane 3.0.16
devshell status/run with `APPIMAGE_EXTRACT_AND_RUN=1`; the four config keys recorded.

## R4 — Docs and sizes: PASS

The five release docs carry **700,120 B** packed and **173,363 B** dist and no `700,158`;
`result.json` keeps `700,158` as the frozen pre-release measurement. Twins and switches are in
place; no current-version `0.4.0` outside history.

## R5 — Git model: PASS (pre-merge state)

`release/v0.5.0` is exactly `dev` + one docs commit; the reflog shows no rebase/reset/force-move;
`master` is still `e6dee00` (0.4.0); `dev` is kept. The merge and tag are correctly post-PASS.

## R6 — Artifact and dependency: PASS

Packed **700,120 B**, 50 files, 4 active silicon rows, no adapter package, `@mpd-dsh/mpd` pinned
exactly `0.15.1`, dists externalized; verif 160,209 / bootstrap 11,734 / guard 1,420 = 173,363 B.

## R7 — Evidence record: PASS

The required evidence files exist and are unchanged since the feature commit `9863326`; this
review record and the contract are committed after the verdict.

## R8 — Tag after PASS: PASS

No `v0.5.0` tag and no `master` 0.5.0 merge existed before this PASS. The merge and annotated tag
follow this record.

## Non-blocking nits (follow-ups)

1. **N1** — the raw `mpd_verif_librelane run` log lives under the gitignored `.mpd/...librelane/`
   and predates the evidence session; `result.json` carries the summary. Copy or re-run it into
   the evidence dir.
2. **N2** — README/README.zh "profile-install path is the one verified for 0.5.0" refers to the
   `ci-boot` `file:<repo>` profile install; the packed 0.5.0 artifact itself was not booted.
   Narrow the wording (or add one packed-artifact boot).
3. **N3** — `gates.log` records the `== gitee ==` tail only (`release.yml`); the re-run shows all
   three workflows PASS. Record all three lines.
4. **N4** — the contract/review files are 0600; run `pack-silicon.mjs --fix` before committing
   them (done in this commit).
5. **N5** — the `/opt` session's `live-tools.jsonl` banner says `bundle 0.4.0` (it ran before the
   version bump; the code is byte-identical to the candidate). Note the pre-bump revision in
   `result.json`.

## Bounds

The Reviewer did not re-run the `/opt` tool surface (sim/regress/coverage/LSP/LibreLane),
VCS/UVM (no license), or a PDK/RTL-to-GDS flow; it reviewed the committed evidence and
corroborated `merged.dat` 4,260 B, the annotated `adder.v`, and the LibreLane log. No remote push
state was verified; locally `master` was unmerged and `v0.5.0` untagged at verdict time.
