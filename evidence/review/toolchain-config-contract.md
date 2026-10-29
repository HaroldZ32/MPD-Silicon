# Frozen contract — silicon toolchain configuration + LibreLane runner (0.3.0)

**Status**: frozen for independent verification, 2026-10-21.
**Verifier rule**: verify from THIS contract + the documentation (`README.md`, `README.zh-CN.md`,
`AGENTS.md`, `docs/**`, `packages/*/README*.md`) + black-box commands. Do not read the implementation
to decide whether a claim is true; run the command and compare with the documented outcome. A finding
must cite the document that promises the behaviour and the measured fact.

## Objective

Give the bundle a **two-layer toolchain configuration** (`silicon.jsonc`) for oss-cad-suite,
verible and librelane, a **conversational tool** to show/set/unset/init/detect it (comment-preserving
writes), make the verif backends and the HDL LSP honor it, and add a **LibreLane runner** that
supports binary, AppImage and devshell-AppImage deployments.

## Required outcomes

| # | Outcome | Acceptance evidence (black box) |
|---|---|---|
| R1 | Two config layers: user `${MPD_SILICON_CONFIG}` or `${DSH_HOME:-~/.dsh}/silicon.jsonc`, project `<workspace>/.mpd/silicon.jsonc`; project deep-merges over user; missing is normal; malformed is reported, never fatal. | Docs state the paths and precedence; `mpd_verif_toolchain action=show` prints both paths and the per-key source layer; the real sandbox session shows `user … (missing)` and `project … (exists)`. |
| R2 | Schema `ossCadSuite{home,bin}`, `verible{home,bin}`, `librelane{appimage,mode(auto|binary|appimage|devshell),appimageExtract,bin,home}`; `.bin` = executable or bin dir, `.home` = install root. | `docs/toolchain.md` schema table matches; `show` reports configured paths and unknown/invalid keys. |
| R3 | `set`/`unset` edit surgically (comments/key order preserved), write atomically (temp+rename, 0644), refuse ambiguous/malformed documents; `init` writes a commented template and refuses an existing file unless `force`; `set`/`unset` target the defining layer, else user. | The recorded before/after JSONC keeps both original comments and gains `librelane.bin`; a second `set` reports `unchanged`; tests cover update/insert/delete/refusal/atomic write; packer modes pass. |
| R4 | `mpd_verif_toolchain` exposes show/set/unset/init/path/detect and is usable in a real harness session. | The recorded real session has 4/4 tool_call+tool_result: show, set (`written`), show key (`[workspace]`), and a completed status; the file on disk matches `after-2.jsonc`. |
| R5 | Verif backends resolve env `MPD_DSH_VERIF_*` (still wins) → config `ossCadSuite.bin`/`home/bin` → PATH; `mpd_verif_backends` reports `source: config`; no config behaves exactly as before; VCS/urg untouched. | Backend tests pass; `docs/toolchain.md` states the order; `show` lists resolved backends and their source. |
| R6 | The HDL LSP row uses `launch.mjs` to read the same two layers and prepend the configured oss-cad-suite/verible bin dirs to PATH; the pinned `dist/cli.js`/`BUILD.lock` is untouched; MCP traffic passes through. | Row args `[launch.mjs, cli.js, mcp]`; `build-lsp --check` passes; the MCP handshake through the launcher negotiates 2025-06-18 with 8 tools; a black-box probe with a config verible dir shows that dir first on the child PATH and argv forwarded; malformed config produces one stderr warning and an unchanged PATH (test). |
| R7 | `mpd_verif_librelane status|run`: resolves binary/AppImage/devshell (auto devshell for a `devshell` filename), auto `APPIMAGE_EXTRACT_AND_RUN=1` when /dev/fuse is absent, runs workspace-confined with the log, returns exitCode/duration/logPath/tails; the real LibreLane 3.0.16 is used. | The recorded status returns `mode binary`, `version LibreLane v3.0.16`, command preview; the recorded `run --version` exits 0 in 623 ms with a log path and the version in the stdout tail; the schema-level suite validates all shapes; the installed harness validator reports 0 violations. |
| R8 | Documentation is bilingual and matches the measured state: 10 tools, 0.3.0, the config paths/schema/actions, LibreLane AppImage/devshell semantics, the LSP launcher, the one recorded user-scope write exception, and the honest bounds. | `docs/toolchain.md` + `.zh-CN.md` exist with switch links and mirrored sections; README/AGENTS/package READMEs say ten tools and 0.3.0; `grep 0.2.0` has no stale hit; twin/switch audit passes (three declared exemptions only). |
| R9 | Every gate is green and the evidence is on disk, including the first real-call schema defect and its fix. | typecheck `--self-test` + `--require`; `bun test packages/` 375 pass / 1 skip / 0 fail (376/31, per the addendum); corpus 10/3; rows 4∩35=∅; rows self-test; `build-lsp --check`; packer self-test/check; `evidence/verification/toolchain-config/20261021T112000Z/{result.json,output.log,…}` present and consistent. |

## Explicit non-goals / bounds (do not inflate into findings)

- No real LibreLane AppImage and no `/dev/fuse` here; appimage/devshell are covered by faithful fakes and the auto-extract decision by an injected `hasFuse`.
- The real LibreLane is the 3.0.16 **Python** entry script; the sandboxed HOME hides the user site-packages, so the evidence probes set `PYTHONPATH` to the real site-packages. A normal session with the user's HOME does not need it.
- No verible/slang-server installed: launcher PATH priming is proven with a fake bin dir; the real handshake proves traffic, not a language-server start.
- LibreLane timeout kills the direct child only; the cwd guard is lexical; no full RTL-to-GDS flow was run.
- The first real harness call exposed an output-schema defect (appimageExtract/version non-null while legitimately null); it was fixed before the record, and the failing run is retained. That is a repaired defect, not an open one.

## Procedure (run it yourself)

1. `node scripts/typecheck.mjs --self-test` and `--require`
2. `bun test packages/` (bun at `.mpd/tools/bun/bin/bun`) — expect 375/1/0, 376 tests / 31 files (the addendum supersedes R9's original count)
3. `node scripts/verify-corpus.mjs`, `node scripts/verify-rows-disjoint.mjs` (+ `--self-test`)
4. `node scripts/build-lsp.mjs --check`
5. `node scripts/pack-silicon.mjs --self-test` and `--check`
6. Launcher black-box probe: a temp config with `verible.bin=<existing dir>`, a fake cli that prints PATH/argv, `node packages/mpd-mcp-lsp/launch.mjs <fake-cli> hello` — assert the dir is first and argv forwarded; malformed config → one stderr warning and unchanged PATH.
7. MCP handshake through `launch.mjs` + the real `dist/cli.js` — 2025-06-18, 8 tools.
8. LibreLane status: temp `silicon.jsonc` with `librelane.bin=/home/haroldzhao/.local/bin/librelane`, call the shipped dist (e.g. a small script) with `HOME` sandbox + `PYTHONPATH=/home/haroldzhao/.local/lib/python3.10/site-packages`; assert mode binary and version 3.0.16.
9. Evidence audit: read `result.json` and `output.log`, compare the numbers/hashes with your runs; inspect `before.jsonc`/`after-2.jsonc` (comments preserved).
10. Docs audit: the R8 greps, the twin/switch-link check, and the stated bounds.

## Verdict

One token — **PASS** | **FAIL** | **INCONCLUSIVE** — plus findings (`id`, `severity`, `symptom`,
`expected`, `doc_source`). A PASS requires R1-R9 demonstrated; a FAIL needs at least one
evidence-backed finding. Do not fix anything.

## Addendum — 2026-10-21 (after the first review)

F3's fix added 4 regression tests. The current suite is **376 tests / 31 files** (375 pass /
1 skip; `mpd-verif-plugin` 162, LSP launcher 9). This supersedes the count in R9; every other
requirement is unchanged, and the re-review verifies this tree.
