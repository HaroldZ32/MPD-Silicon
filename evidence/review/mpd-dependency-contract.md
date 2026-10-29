# Frozen contract — hard @mpd-dsh/mpd dependency, guard and Gitee Go CI (0.4.0)

**Status**: frozen for independent verification, 2026-10-22.
**Verifier rule**: verify from THIS contract + the documentation (`README.md`, `README.zh-CN.md`,
`AGENTS.md`, `CONTRIBUTING*.md`, `docs/**`, `packages/*/README*.md`, `CHANGELOG.md`) + black-box
commands. Do not decide a claim from the implementation. A finding cites the document that promises
the behaviour and the measured fact.

## Objective

Remove the local adapter port, make `@mpd-dsh/mpd` 0.15.1 a hard runtime dependency with **no
fallback**, refuse to boot without its `mpdDsh` service, shrink the delivered bundle, and add a
Gitee Go CI/CD + mpd-style git flow.

## Required outcomes

| # | Outcome | Acceptance evidence (black box) |
|---|---|---|
| R1 | `packages/mpd-dsh-adapter-plugin` is gone; `@mpd-dsh/mpd` is pinned exactly `0.15.1`; sources import `@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js` (types from `.../src/index.ts`); no local copy or relative adapter import. | `test ! -d packages/mpd-dsh-adapter-plugin`; `package.json` dependencies; `bun install --frozen-lockfile` clean; no `mpd-dsh-adapter-plugin` directory in tree or packed bundle; the external specifier present in the consumer dists. |
| R2 | The verif/bootstrap rows declare `inject: [..., "mpdDsh"]` and read `ctx.mpdDsh`; **no fallback**; the inject-free `silicon-require-mpd` guard polls `ctx.get("mpdDsh", true)` 100 ms up to 15 s and then throws → CLI exit 1. | Coexist boot (mpd + silicon) stays alive to timeout with `[mpd-silicon-bootstrap] skill corpus served … bundle 0.4.0`; no-mpd boot exits 1 with `silicon requires @mpd-dsh/mpd: the mpdDsh service is absent` and both consumer rows `pending (waiting for service: mpdDsh)`; `scripts/ci-boot.mjs --require` exit 0. |
| R3 | Dists do not inline mpd: build uses `--external @mpd-dsh/mpd/*`; the staged manifest carries `dependencies`; the packed bundle ships no `scripts/verify-rows-disjoint.mjs`; the packer fails on a resurrected adapter row/inlined `SERVICE_NAME`/missing import. | Dists contain the external specifier and zero `SERVICE_NAME = "mpdDsh"` definitions; packed bundle 690,185 B with no `scripts/`; `pack --self-test` includes the adapter-wiring controls; `--check` PASS. |
| R4 | Every gate is green: tests 212/21 (211 pass / 1 skip), typecheck `--require`, corpus (the loadability probe PASSES, not a silent skip), rows 4∩35=∅, LSP `--check`, packer self-test/check, Gitee workflow gate + YAML parse, boot harness self-test. | The recorded outputs; `verify-corpus --self-test` exit 0 (a broken adapter control must FAIL, not SKIP); `verify-gitee-workflows --self-test` 11/11; `ci-boot --self-test` 9/9. |
| R5 | Gitee Go is the CI (no GitHub workflows): `.workflow/ci.yml` (push+PR master/dev, gates, pack artifact), `.workflow/release.yml` (tag `v*`, tag==version assertion, general + release artifact publish), `.workflow/boot-e2e.yml` (dev path-filtered, real boot); bilingual CONTRIBUTING + Gitee PR/issue templates; branch model master release-only / dev integration / feature|fix / release-vX.Y.Z, one git writer, `--no-ff`, annotated tags. | Files exist; PyYAML parses all three; workflow gate PASS; `CONTRIBUTING` states the pin/no-fallback/gates/branch model; AGENTS §5 matches; no `.github/`. |
| R6 | Human docs are bilingual and current: v0.4.0; 4 rows (guard/bootstrap/verif/mcp); hard dependency/no fallback/guard; size deltas; 212 tests; Gitee Go; docs stop claiming standalone/`siliconDsh`/D1-D6. | Twin/switch audit passes (declared exemptions only); stale-token grep (`siliconDsh|silicon-dsh-adapter|D1-D6|self-contained|376|375|363`) is empty over README/AGENTS/docs/package READMEs; CHANGELOG 0.4.0; package.json description no longer says standalone. |
| R7 | The 0.4.0 profile is live-proven: two real tool calls complete (`mpd_verif_toolchain show`, `mpd_verif_librelane status` → LibreLane 3.0.16), in addition to the boots. | `evidence/verification/mpd-dependency/20261022T112500Z/live-tools.jsonl` = 2 tool_calls / 2 completed tool_results; the status line shows mode binary/config and 3.0.16. |
| R8 | The size reduction is measured and the bounds are stated: packed 919,281 → 690,185 B (−24.9%); dists 384,819 → 170,766 B (−55.6%); adapter package 646,769 B removed; no shipped dev script. | `stat`/`du` outputs in the evidence; the bounds (Gitee Go live run not exercised; `dsh plugin add` unverified in the read-only-HOME sandbox; the profile `package.json` + bun path is proven; no LSP live call; no real EDA/FUSE). |
| R9 | The change follows the chosen git model: feature branch → dev `--no-ff` → release/v0.4.0 → master `--no-ff` + annotated `v0.4.0`; atomic commits with evidence; independent review PASS. | `git log --graph`, branch list, tag; the review record and verdict. |

**Size reconciliation**: intermediate packs measured 682,451 B (before the shipped docs and the
0.4.0 description) and 690,030 B (before the final CI/guard-size claims and the patch "ten" fix);
the final shipped bundle is **690,185 B**, the before/after pair used above.

## Explicit non-goals / bounds (do not inflate into findings)

- Gitee Go's live trigger evaluation, `${GITEE_TAG}` interpolation and artifact publishing were not
  executed against a real Gitee runner; the YAML is structurally validated and the boot harness runs
  the real `dsh`. Treat live Gitee behavior as unproven.
- `dsh plugin add` is blocked in this sandbox (pnpm against a read-only `$HOME`); the proven install
  path is the profile `package.json` + `bun install`. This is a measured environment bound, not a
  product claim.
- No HDL language-server live call under 0.4.0; the older adaptation measurement stands. The 0.4.0
  live calls are `mpd_verif_*` only.
- No real EDA/FUSE/AppImage/Verible; the 0.3.0 fake-covered bounds still apply.
- mpd is pinned to 0.15.1; upgrade behavior is documented, not executed.
- The mpd-internal `preset-mpd … pending (agentPresets)` warning in the minimal profile is
  unrelated and not a failure.

## Procedure (run it yourself)

1. `node scripts/typecheck.mjs --self-test` + `--require`
2. `bun test packages/` — expect 212/21, 211 pass / 1 skip
3. `node scripts/verify-corpus.mjs` and `--self-test` — the loadability check must PASS; the
   self-test must be green (a broken adapter must fail)
4. `node scripts/verify-rows-disjoint.mjs` (+ `--self-test`)
5. `node scripts/build-lsp.mjs --check`
6. `node scripts/pack-silicon.mjs --self-test` and `--check` (no `--fix`)
7. `node scripts/verify-gitee-workflows.mjs` + `--self-test`; PyYAML parse `.workflow/*.yml`
8. `node scripts/ci-boot.mjs --self-test` and `--require` (coexist 124 + bootstrap line; no-mpd
   exit 1 + guard line)
9. `node scripts/ci-boot.mjs` logs / evidence audit; `stat` the three dists and `du` the packed
   bundle; compare with `result.json`
10. Docs audit: twins/switch links, stale-token grep, AGENTS §5, CONTRIBUTING, CHANGELOG,
    package.json description
11. Inspect `evidence/verification/mpd-dependency/20261022T112500Z/` (result.json, output.log,
    live-tools.jsonl, boot logs) and the review record

## Verdict

One token — **PASS** | **FAIL** | **INCONCLUSIVE** — plus findings (`id`, `severity`, `symptom`,
`expected`, `doc_source`). A PASS requires R1-R9 demonstrated; a FAIL needs at least one
evidence-backed finding. Do not fix anything.

## Addendum — R9 execution order (2026-10-22)

This review covers the working tree that will become the 0.4.0 release: **R1-R8 are verified on it**.
**R9 is executed after the verdict**, so a PASS is not coupled to a tag that would have to be
rewritten on a finding. The Reviewer verifies the planned atomic commit split, the file scoping and
the branch model (master release-only / dev integration / feature|fix / release-vX.Y.Z, `--no-ff`,
one writer, annotated tag). The captain executes the branches, commits and tag, and records the
graph and tag hash in the final report. A FAIL must be repaired before any branch or tag is cut.
