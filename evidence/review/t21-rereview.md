# t21 — independent re-review of the t20 repair round (t8's findings)

**Task**: t21 (review of t20) · **Reviewer**: captain · **Date**: 2026-09-13
**Why the captain ran it**: t21 became unschedulable (its dependency `t20` is terminal-`failed`, and
t20's own completion was blocked by an `inScope`/acceptance self-contradiction). The work was
delivered, so the re-review is executed out-of-band and recorded here rather than left undone.

**Discipline**: read-only. No repository file was changed by this review; every claim below was
re-measured in this session, and where t20 reported a number I re-ran the command instead of citing
it.

## Verdict

**pass** — all eight of t8's findings are independently confirmed closed, and the closures are
falsifiable (the checks bite) rather than cosmetic.

## Per-finding verification (t8 → t20 → measured here)

| t8 finding | Severity | t20's repair | My independent measurement |
|---|---|---|---|
| **F1** corpus gate dies at the strip's end | blocker | per-tree skip + in-repo self-held baseline | `corpus-baseline.json` schema 1 with trees `{rtl-ip-flow:9, rtl-codestyle:6, rtl-verif:20}`; default run `PASS — 10 checks / 3 skips`; **source-absent run** (`MPD_SOURCE_SKILLS=/nonexistent/skills`) → `PASS — 10 checks / 1 skip`, exit 0, printing *"the committed baseline above is authoritative"* — i.e. it self-proves without a source checkout |
| **F2** `skills.test.ts` silently self-disabled 38 assertions (234→196 expect, still green) | high | fidelity now asserted against the manifest | suite runs **31 tests / 371 expect / 0 fail** by default; the module fails hard (no `continue`) and the source cross-check is a visible conditional skip, so the value can no longer shrink unnoticed |
| **F3** `dependency-map.md:44` claimed the rename landed while it had not | high | both mirrors refreshed; S1 row rewritten with line-level evidence | EN `:50` and zh-CN `:42` now state the rename **landed** with the exact anchors (`src/index.ts:446`; resolvers `mpd-verif-plugin/src/index.ts:35`, `mpd-silicon-bootstrap-plugin/src/index.ts:348`), the invariant holds (`name` `:20`, log prefix `:455` unchanged), and the divergence budget is stated (**3 / 1 / 1 lines**). Verified against the working tree |
| **F4** source repo's `verify-vendor` + two RTL QA cases red (`test:qa` could not pass) | high | resolved in the source repo (option ①) | source repo now reports `asset OK: skills 329 files` / **PASS** (see the t17 re-pin), `verify-rows-parity` PASS, and `test:qa` PASS with the two RTL cases **live again** (t19 repointed them at the bundle; they are no longer `known-stale`) |
| **F5** adapter's 22 tests + READMEs not migrated | medium | migrated | `packages/mpd-dsh-adapter-plugin/test/adapter.test.ts` is **byte-identical** to the source (`cmp` clean); suite runs 22 pass; both READMEs present |
| **F6** t6 report §2 cited a baseline that did not match reality | medium | report corrected | `evidence/verification/t6-port-fidelity.md` now carries the correction note at the top and the §2 wording distinguishes the verif-package baseline (78/414/9) from the two-package reality (100/474/10) |
| **F7** hard-coded `/root/...` paths in delivered scripts | medium | env-first resolution | `grep -rn dshProj` over scripts/tests/docs (excluding `evidence/`) is **empty**; the resolution chain is `MPD_SOURCE_SKILLS` → `MPD_SOURCE_ROOT` → sibling checkout, with `MPD_CORPUS_BASELINE` overriding the manifest path (`scripts/verify-corpus.mjs:46,56`) |
| **F8** notices lacked the Erie/verilog-generator provenance | low | added | `LICENSE-NOTICES.md:19-20` records the style provenance and explicitly states **style only, no code reused** |

## What I could not verify away

- The one remaining skip is the **live** cross-check against a source checkout; it is a *named,
  printed* skip with the reason inline (`expected after the RTL strip`) and it stays bound to the
  committed manifest. Its loss is narrow: the manifest itself could regress silently. Deep Worker
  showed an on-demand oracle survives — `git archive 3d99718 skills/rtl-*` reconstructs all 35 files
  and matches the manifest entry-by-entry (sha256 **and** byte size).
- t20's own completion was recorded as `failed` for a **contract** reason (`README.zh-CN.md` absent
  from `inScope` while the acceptance demanded the bilingual sync), not for a delivery defect. Its
  artifacts are in the pushed tree.

## Commands run (all in `/root/dshProj/my-power-dsh-silicon`)

```
node scripts/verify-corpus.mjs                              # PASS — 10 checks / 3 skips
MPD_SOURCE_SKILLS=/nonexistent/skills node scripts/verify-corpus.mjs
                                                            # PASS — 10 checks / 1 skip, exit 0
bun test packages/mpd-silicon-bootstrap-plugin              # 31 tests / 371 expect / 0 fail
cmp packages/mpd-dsh-adapter-plugin/test/adapter.test.ts <source>
                                                            # identical
grep -rn dshProj --include=*.mjs --include=*.ts --include=*.md .   # empty outside evidence/
```
